import { buildRecoveryState, recoveryCandidate } from "../shared/core.ts";
import {
  getAllSnapshots,
  getMetaIndex,
  getRecovery,
  getSettings,
  getSnapshot,
  setRecovery,
} from "../shared/db.ts";
import type { RecoveryState } from "../shared/types.ts";
import { autosave, getRunId } from "./autosave.ts";
import { captureWindows } from "./capture.ts";
import { restoreSnapshot } from "./restore.ts";

let checkingPromise: Promise<RecoveryState | null> | null = null;

export function startupCheck(force = false): Promise<RecoveryState | null> {
  if (!checkingPromise) {
    checkingPromise = doStartupCheck(force).finally(() => {
      checkingPromise = null;
    });
  }
  return checkingPromise;
}

export async function updateBadge(): Promise<void> {
  const settings = await getSettings();
  const rec = await getRecovery();
  if (rec && settings.showBadgeAlert) {
    await chrome.action.setBadgeBackgroundColor({ color: "#D97706" });
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setTitle({
      title: `TabVault: ${rec.missing} tabs from your last session can be restored`,
    });
    return;
  }
  if (settings.showTabCountBadge) {
    const tabs = await chrome.tabs.query({ windowType: "normal" });
    await chrome.action.setBadgeBackgroundColor({ color: "#0EA5E9" });
    await chrome.action.setBadgeText({ text: String(tabs.length) });
    await chrome.action.setTitle({ title: `TabVault (${tabs.length} open tabs)` });
    return;
  }
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: "TabVault" });
}

export async function clearRecovery(): Promise<void> {
  await setRecovery(null);
  await updateBadge();
}

async function doStartupCheck(force: boolean): Promise<RecoveryState | null> {
  const rid = await getRunId();
  const ses = await chrome.storage.session.get(["checkedRun", "prevBeat"]);
  if (!force && ses.checkedRun === rid) {
    return getRecovery();
  }
  await chrome.storage.session.set({ checkedRun: rid });

  const settings = await getSettings();
  if (!force && settings.startupBehavior === "none") {
    await clearRecovery();
    return null;
  }

  const prevBeat = (ses.prevBeat as { runId: string; t: number } | null) || null;
  const cand = recoveryCandidate(await getMetaIndex(), rid, prevBeat);

  if (!cand || cand.n < 2) {
    await clearRecovery();
    return null;
  }

  const snap = await getSnapshot(cand.id);
  if (!snap) return null;

  const open = await captureWindows(settings);
  const recovery = buildRecoveryState(cand, snap.windows, open, settings);

  if (!recovery) {
    await clearRecovery();
    return null;
  }

  // Handle configured startup behavior
  if (!force && settings.startupBehavior === "restorePrevious") {
    await restoreSnapshot(snap, { skipOpen: settings.skipAlreadyOpenOnCrashRestore });
    await clearRecovery();
    return null;
  }

  await setRecovery(recovery);
  await updateBadge();
  return recovery;
}

export async function runStartupPolicies(): Promise<void> {
  const settings = await getSettings();
  if (settings.startupBehavior === "openStartupSessions") {
    const all = await getAllSnapshots();
    const startups = all.filter((s) => s.startupRegistered);
    for (const s of startups) {
      await restoreSnapshot(s, { skipOpen: true });
    }
  } else if (settings.startupBehavior === "openDashboard") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  }
}

export async function scheduleStartupCheck(): Promise<void> {
  const settings = await getSettings();
  setTimeout(() => {
    void startupCheck(false);
    void autosave();
  }, settings.startupCheckSec * 1000);

  await chrome.alarms.create("startupCheck", {
    delayInMinutes: Math.max(0.5, settings.startupCheckSec / 60 + 0.25),
  });
}
