/** Cross-scenario UI pref: last changelog version the user has acknowledged. */
export const LAST_SEEN_KEY = 'yarp:lastSeenVersion';

export function getLastSeenVersion(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const v = window.localStorage.getItem(LAST_SEEN_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setLastSeenVersion(version: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* storage blocked — What's New will reappear next visit */
  }
}
