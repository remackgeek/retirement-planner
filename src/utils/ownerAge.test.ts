import { describe, it, expect } from 'vitest';
import { resolveOwnerAge } from './ownerAge';

describe('resolveOwnerAge', () => {
  it('returns currentAge for self owner', () => {
    expect(resolveOwnerAge('self', 65, 60)).toBe(65);
  });

  it('returns spouseAge for spouse owner when spouseAge is set', () => {
    expect(resolveOwnerAge('spouse', 65, 60)).toBe(60);
  });

  it('falls back to currentAge for spouse owner when spouseAge is null', () => {
    expect(resolveOwnerAge('spouse', 65, null)).toBe(65);
  });

  it('returns currentAge for self owner even when spouseAge is null', () => {
    expect(resolveOwnerAge('self', 70, null)).toBe(70);
  });
});
