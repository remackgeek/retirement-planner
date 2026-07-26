/**
 * Diagonal-hatch CanvasPattern for Chart.js dataset fills. Used by the Income
 * view's Roth-conversion segment: the texture (not just color) marks it as a
 * transfer into Roth rather than spendable income.
 *
 * Patterns are cached per hex — a fresh CanvasPattern object on every render
 * would defeat Chart.js's dataset diffing and force full re-parses. Falls back
 * to the solid color when a 2D context is unavailable (non-browser test envs).
 */
const patternCache = new Map<string, CanvasPattern | string>();

export function getHatchPattern(hex: string): CanvasPattern | string {
  const cached = patternCache.get(hex);
  if (cached !== undefined) return cached;

  const tile = document.createElement('canvas');
  tile.width = 8;
  tile.height = 8;
  const ctx = tile.getContext('2d');
  if (!ctx) {
    patternCache.set(hex, hex);
    return hex;
  }
  // Soft wash of the base hue so the segment still reads as "roth-colored",
  // with solid 45° hatch lines on top carrying the texture channel.
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 8, 8);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = hex;
  ctx.lineWidth = 2;
  ctx.beginPath();
  // Two parallel strokes tile seamlessly across 8×8 at 45°.
  ctx.moveTo(-2, 6);
  ctx.lineTo(6, -2);
  ctx.moveTo(2, 10);
  ctx.lineTo(10, 2);
  ctx.stroke();

  const pattern = ctx.createPattern(tile, 'repeat') ?? hex;
  patternCache.set(hex, pattern);
  return pattern;
}
