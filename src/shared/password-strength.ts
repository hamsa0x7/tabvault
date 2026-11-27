export type PasswordStrengthLevel = "empty" | "weak" | "fair" | "good" | "strong";

export interface PasswordStrengthResult {
  level: PasswordStrengthLevel;
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  guidance: string;
}

/**
 * Evaluates backup password strength prioritizing length and multi-word
 * passphrases over arbitrary character-mixing rules.
 */
export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const len = password.length;
  if (len === 0) {
    return {
      level: "empty",
      score: 0,
      label: "No password entered",
      guidance: "Use 12+ characters or a multi-word passphrase.",
    };
  }

  const words = password.trim().split(/\s+/).filter(Boolean).length;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^a-zA-Z0-9\s]/.test(password);
  const variety = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  if (len < 8) {
    return {
      level: "weak",
      score: 1,
      label: "Too short",
      guidance: "Use at least 12 characters—longer passphrases are much harder to guess.",
    };
  }

  if (len < 12 && words < 3) {
    return {
      level: "fair",
      score: 2,
      label: "Fair",
      guidance: "Add a few more characters (12+ recommended) or use a 3+ word passphrase.",
    };
  }

  if (len >= 16 || (words >= 4 && len >= 14) || (len >= 14 && variety >= 3)) {
    return {
      level: "strong",
      score: 4,
      label: "Strong",
      guidance: "Strong length. Save this in your password manager.",
    };
  }

  return {
    level: "good",
    score: 3,
    label: "Good",
    guidance: "Good length. A few extra characters or words makes it even stronger.",
  };
}

/**
 * Checks whether raw import text is a SmartTabber encrypted envelope.
 */
export function isEncryptedBackupText(rawText: string): boolean {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as { format?: unknown };
    return parsed?.format === "tabvault-encrypted" || parsed?.format === "smarttabber-encrypted";
  } catch {
    return false;
  }
}
