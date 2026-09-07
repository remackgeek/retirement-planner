import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAST_SEEN_KEY,
  getLastSeenVersion,
  setLastSeenVersion,
} from './lastSeenVersion';

afterEach(() => {
  window.localStorage.removeItem(LAST_SEEN_KEY);
  vi.restoreAllMocks();
});

describe('lastSeenVersion', () => {
  it('returns null when missing', () => {
    expect(getLastSeenVersion()).toBeNull();
  });

  it('round-trips a version string', () => {
    setLastSeenVersion('0.2.0');
    expect(getLastSeenVersion()).toBe('0.2.0');
  });

  it('treats whitespace-only as missing', () => {
    window.localStorage.setItem(LAST_SEEN_KEY, '   ');
    expect(getLastSeenVersion()).toBeNull();
  });

  it('returns null when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getLastSeenVersion()).toBeNull();
  });

  it('swallows setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setLastSeenVersion('0.2.0')).not.toThrow();
  });
});
