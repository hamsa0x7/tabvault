/**
 * Lightweight Chrome i18n helper with safe fallback for non-extension / test environments.
 */
export function t(key: string, fallback: string, substitutions?: string | string[]): string {
  try {
    const localized = chrome?.i18n?.getMessage?.(key, substitutions);
    return localized || fallback;
  } catch {
    return fallback;
  }
}
