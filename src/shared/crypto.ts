// Client-side password encryption for cloud/export backups using WebCrypto AES-GCM-256.

const PBKDF2_ITERATIONS = 150_000;

export interface EncryptedEnvelope {
  format: "tabvault-encrypted" | "smarttabber-encrypted";
  version: 1;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey("raw", enc, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptPayload(plaintext: string, password: string): Promise<EncryptedEnvelope> {
  const saltBuf = new ArrayBuffer(16);
  const salt = new Uint8Array(saltBuf);
  crypto.getRandomValues(salt);
  const ivBuf = new ArrayBuffer(12);
  const iv = new Uint8Array(ivBuf);
  crypto.getRandomValues(iv);
  const key = await deriveKey(password, salt);
  const data = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return {
    format: "tabvault-encrypted",
    version: 1,
    saltB64: toB64(salt),
    ivB64: toB64(iv),
    ciphertextB64: toB64(new Uint8Array(cipher)),
  };
}

export async function decryptPayload(envelope: EncryptedEnvelope, password: string): Promise<string> {
  if (envelope.format !== "tabvault-encrypted" && envelope.format !== "smarttabber-encrypted") {
    throw new Error("This file isn't a supported TabVault encrypted backup.");
  }
  const salt = fromB64(envelope.saltB64);
  const iv = fromB64(envelope.ivB64);
  const ciphertext = fromB64(envelope.ciphertextB64);
  const key = await deriveKey(password, salt);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}
