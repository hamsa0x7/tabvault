/**
 * Stateless proxy Worker for TabVault:
 *  - POST /                : Google OAuth2 token exchange (keeps GOOGLE_CLIENT_SECRET off bundle)
 *  - POST /feedback        : Submits in-app issues/recommendations to private GitHub repo
 *  - GET  /releases/latest : Fetches latest GitHub Release metadata for update checks
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "TabVault-Worker/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const repo = (env.GITHUB_REPO || "hamsa0x7/tabvault").trim();

    if (request.method === "GET" && url.pathname === "/releases/latest") {
      if (!env.GITHUB_TOKEN) {
        return jsonResponse({ error: "GitHub token not configured" }, 500);
      }
      const ghRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: githubHeaders(env.GITHUB_TOKEN),
      });
      if (ghRes.status === 404) {
        return jsonResponse({
          available: false,
          version: null,
          tagName: null,
          name: null,
          releaseNotes: null,
          publishedAt: null,
        });
      }
      if (!ghRes.ok) {
        return jsonResponse({ error: "Failed to check releases" }, ghRes.status);
      }
      const data = await ghRes.json();
      const tagName = String(data.tag_name || "");
      return jsonResponse({
        available: true,
        version: tagName.replace(/^v/i, ""),
        tagName,
        name: data.name || tagName,
        releaseNotes: data.body || "",
        publishedAt: data.published_at || null,
      });
    }

    if (request.method === "POST" && url.pathname === "/feedback") {
      if (!env.GITHUB_TOKEN) {
        return jsonResponse({ error: "Feedback service not configured" }, 500);
      }
      const body = await request.json().catch(() => null);
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      const issueBody = typeof body?.body === "string" ? body.body.trim() : "";
      const kind = body?.kind === "recommendation" ? "recommendation" : "issue";

      if (!title || title.length > 200) {
        return jsonResponse({ error: "Invalid title" }, 400);
      }
      if (issueBody.length > 10000) {
        return jsonResponse({ error: "Details too long" }, 400);
      }

      const ghRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: {
          ...githubHeaders(env.GITHUB_TOKEN),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          body: issueBody,
          labels: [kind === "issue" ? "bug" : "enhancement"],
        }),
      });

      if (!ghRes.ok) {
        const errText = await ghRes.text().catch(() => "");
        return jsonResponse({ error: "Failed to create issue", detail: errText.slice(0, 300) }, ghRes.status);
      }
      const created = await ghRes.json();
      return jsonResponse({ ok: true, number: created.number }, 201);
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    const body = await request.json().catch(() => null);
    if (!body || !["authorization_code", "refresh_token"].includes(body.grant_type)) {
      return new Response("Invalid grant_type", { status: 400, headers: CORS_HEADERS });
    }

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return new Response("Worker OAuth secrets not configured", { status: 500, headers: CORS_HEADERS });
    }

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: body.grant_type,
    });

    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.code_verifier || !body.redirect_uri) {
        return new Response("Missing code parameters", { status: 400, headers: CORS_HEADERS });
      }
      params.set("code", body.code);
      params.set("code_verifier", body.code_verifier);
      params.set("redirect_uri", body.redirect_uri);
    } else {
      if (!body.refresh_token) {
        return new Response("Missing refresh_token", { status: 400, headers: CORS_HEADERS });
      }
      params.set("refresh_token", body.refresh_token);
    }

    const googleRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    return new Response(await googleRes.text(), {
      status: googleRes.status,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    });
  },
};
