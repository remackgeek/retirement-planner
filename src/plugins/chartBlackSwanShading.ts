import { Chart } from 'chart.js';
import type { Plugin, ChartType } from 'chart.js';
import { colors } from '../styles/theme';

// Extend Chart.js types to include our custom plugin
declare module 'chart.js' {
  // Type param name must match chart.js's own declaration for merging (TS2428).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    blackSwanShading?: BlackSwanShadingOptions;
  }
}

export interface BlackSwanShadingEvent {
  year: number;
  stockMultiplier: number;
  bondMultiplier: number;
}

interface BlackSwanShadingOptions {
  // Calendar years where events occur (1928, 2008, etc.) — converted to chart x-index
  // by matching against `years`. Out-of-range events are silently skipped.
  events: BlackSwanShadingEvent[];
  // Calendar year per chart x-index. Same array passed to the Line chart's labels
  // generation, so a year-to-index lookup matches what the user sees.
  years: number[];
}

// Render a percentage label like "-40%" from a multiplier (0.6 → "-40%", 1.2 → "+20%").
function formatMultiplierPct(multiplier: number): string {
  const pct = Math.round((multiplier - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

// afterDatasetsDraw: paints behind the legend/tooltip/HTML overlays but on top of
// gridlines and below the data lines. This puts the band "behind" the trend.
const chartBlackSwanShadingPlugin: Plugin = {
  id: 'blackSwanShading',

  afterDatasetsDraw(chart: Chart) {
    const opts = chart.options.plugins?.blackSwanShading as
      | BlackSwanShadingOptions
      | undefined;
    if (!opts || !opts.events || opts.events.length === 0) return;

    const xScale = chart.scales.x;
    const { top, bottom } = chart.chartArea;
    if (!xScale) return;

    // Pre-build a year → index map once per draw.
    const yearToIndex = new Map<number, number>();
    opts.years.forEach((y, i) => yearToIndex.set(y, i));

    const ctx = chart.ctx;
    ctx.save();

    for (const ev of opts.events) {
      const idx = yearToIndex.get(ev.year);
      if (idx === undefined) continue;

      // Width = one category slot. Use the distance to the next index when possible,
      // falling back to the previous slot for the last point so the band always has width.
      const center = xScale.getPixelForValue(idx);
      const next = idx < opts.years.length - 1
        ? xScale.getPixelForValue(idx + 1)
        : center + (center - xScale.getPixelForValue(idx - 1));
      const slotWidth = Math.max(2, next - center);
      const left = center - slotWidth / 2;

      // Shade the vertical band.
      ctx.fillStyle = colors.blackSwanShade;
      ctx.fillRect(left, top, slotWidth, bottom - top);

      // Compact label centered above the band: stock% on top, bond% below.
      const stockLabel = formatMultiplierPct(ev.stockMultiplier);
      const bondLabel = formatMultiplierPct(ev.bondMultiplier);
      // Canvas font must be px — `fontSize.xs` is a CSS `rem` token the canvas
      // API can't parse (it silently falls back to the default 10px).
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = colors.blackSwanStockLabel;
      ctx.fillText(stockLabel, center, top + 2);
      ctx.fillStyle = colors.textSecondary;
      ctx.fillText(bondLabel, center, top + 14);
    }

    ctx.restore();
  },
};

export default chartBlackSwanShadingPlugin;
