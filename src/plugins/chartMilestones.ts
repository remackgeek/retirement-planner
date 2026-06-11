import { Chart } from 'chart.js';
import type { Plugin, ChartType } from 'chart.js';
import { colors } from '../styles/theme';

// Extend Chart.js types to include our custom plugin
declare module 'chart.js' {
  // Type param name must match chart.js's own declaration for merging (TS2428).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    milestones?: MilestonesOptions;
  }
}

export interface MilestoneMarker {
  // Calendar year the milestone occurs — converted to a chart x-index by matching
  // against `years`. Out-of-range markers are silently skipped.
  year: number;
  // Short pill label drawn at the top of the marker line (e.g. "Now filing Single").
  label: string;
}

interface MilestonesOptions {
  markers: MilestoneMarker[];
  // Calendar year per chart x-index (same array as the Line chart's labels source).
  years: number[];
}

// Draws a thin dashed vertical line + a top pill label at each milestone year.
// Used for the widow's-penalty filing-status transition. Intentionally lighter
// than blackSwanShading (a line, not a full-height shaded band) so it reads as a
// neutral plan event rather than a market stress.
const chartMilestonesPlugin: Plugin = {
  id: 'milestones',

  afterDatasetsDraw(chart: Chart) {
    const opts = chart.options.plugins?.milestones as MilestonesOptions | undefined;
    if (!opts || !opts.markers || opts.markers.length === 0) return;

    const xScale = chart.scales.x;
    const { top, bottom } = chart.chartArea;
    if (!xScale) return;

    const yearToIndex = new Map<number, number>();
    opts.years.forEach((y, i) => yearToIndex.set(y, i));

    const ctx = chart.ctx;
    ctx.save();

    // Canvas font must be px (the `rem` tokens in `fontSize` are CSS-only — the
    // canvas API can't parse them and silently keeps the default 10px). Use a
    // fixed px size matching the chart's tick font.
    const PILL_FONT = '11px sans-serif';
    const padX = 5;
    const pillH = 16;

    for (const m of opts.markers) {
      const idx = yearToIndex.get(m.year);
      if (idx === undefined) continue;
      const x = xScale.getPixelForValue(idx);

      // Pill sits at the BOTTOM, alongside the income/spending event badges
      // (chartHtmlAnnotations), just above the x-axis baseline.
      const pillTop = bottom - pillH - 2;

      // Dashed vertical line from the top of the plot down to the pill.
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.textMuted;
      ctx.moveTo(x, top);
      ctx.lineTo(x, pillTop);
      ctx.stroke();
      ctx.setLineDash([]);

      // Pill label, centered on the line but clamped within the chart area so an
      // edge-of-plot milestone stays readable.
      ctx.font = PILL_FONT;
      ctx.textBaseline = 'middle';
      const textW = ctx.measureText(m.label).width;
      const pillW = textW + padX * 2;
      let pillLeft = x - pillW / 2;
      pillLeft = Math.max(chart.chartArea.left, Math.min(pillLeft, chart.chartArea.right - pillW));

      ctx.fillStyle = colors.bgMedium;
      ctx.strokeStyle = colors.borderMedium;
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Rounded-ish pill (plain rect is fine at this size).
      ctx.rect(pillLeft, pillTop, pillW, pillH);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = colors.textSecondary;
      ctx.textAlign = 'left';
      ctx.fillText(m.label, pillLeft + padX, pillTop + pillH / 2 + 0.5);
    }

    ctx.restore();
  },
};

export default chartMilestonesPlugin;
