import { describe, it, expect } from 'vitest';
import { getProbabilityTier } from './probabilityTier';

describe('getProbabilityTier', () => {
  describe('tier boundaries', () => {
    it('classifies 100% as excellent', () => {
      expect(getProbabilityTier(100).tier).toBe('excellent');
    });
    it('classifies 90% as excellent (lower bound)', () => {
      expect(getProbabilityTier(90).tier).toBe('excellent');
    });
    it('classifies 89.9% as good', () => {
      expect(getProbabilityTier(89.9).tier).toBe('good');
    });
    it('classifies 75% as good (lower bound)', () => {
      expect(getProbabilityTier(75).tier).toBe('good');
    });
    it('classifies 74.9% as fair', () => {
      expect(getProbabilityTier(74.9).tier).toBe('fair');
    });
    it('classifies 50% as fair (lower bound)', () => {
      expect(getProbabilityTier(50).tier).toBe('fair');
    });
    it('classifies 49.9% as atRisk', () => {
      expect(getProbabilityTier(49.9).tier).toBe('atRisk');
    });
    it('classifies 0% as atRisk', () => {
      expect(getProbabilityTier(0).tier).toBe('atRisk');
    });
  });

  describe('labels', () => {
    it('returns expected labels for each tier', () => {
      expect(getProbabilityTier(95).label).toBe('Excellent');
      expect(getProbabilityTier(80).label).toBe('Good');
      expect(getProbabilityTier(60).label).toBe('Fair');
      expect(getProbabilityTier(30).label).toBe('At Risk');
    });
  });

  describe('tooltips', () => {
    it('includes actionable language for each tier', () => {
      expect(getProbabilityTier(95).tooltip).toMatch(/spend more|retire earlier|less investment risk/i);
      expect(getProbabilityTier(80).tooltip).toMatch(/most scenarios|tail risk/i);
      expect(getProbabilityTier(60).tooltip).toMatch(/savings|spending|working longer/i);
      expect(getProbabilityTier(30).tooltip).toMatch(/fall short|structural changes/i);
    });
  });

  describe('colors', () => {
    it('returns non-empty color and backgroundColor for every tier', () => {
      for (const p of [95, 80, 60, 30]) {
        const info = getProbabilityTier(p);
        expect(info.color).toMatch(/^#|^rgb/);
        expect(info.backgroundColor).toMatch(/^#|^rgb/);
      }
    });
  });
});
