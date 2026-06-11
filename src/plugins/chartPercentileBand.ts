import { Chart } from 'chart.js';
import type { Plugin, ChartType, Scale } from 'chart.js';

declare module 'chart.js' {
  // Type param name must match chart.js's own declaration for merging (TS2428).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    percentileBand?: PercentileBandOptions;
  }
}

interface PercentileBandOptions {
  // Year-by-year 10th-percentile portfolio balances. Length must match the chart's
  // x-axis label count and the p90 array.
  p10: number[];
  // Year-by-year 90th-percentile portfolio balances.
  p90: number[];
  // When false (or arrays are missing/empty), the plugin renders nothing.
  enabled: boolean;
  // Fill style for the filled region.
  color: string;
}

// Y-axis cap factor for the band's upper edge: never let it stretch the y-axis
// beyond CAP_MULT × the primary line's max, so the Deterministic / Median line
// stays visually prominent. Downside (p10) always fits in full.
const Y_CAP_MULT = 2.0;

// beforeDatasetsDraw: paints under all data lines so the deterministic line sits on
// top of the shaded region. Gridlines remain visible behind the band.
const chartPercentileBandPlugin: Plugin = {
  id: 'percentileBand',

  // Inform Chart.js's y-scale autoscale about the band's extent: extend the
  // y-min down to the band's full lower edge (p10), and extend the y-max up
  // to min(max(p90), Y_CAP_MULT × max(line)). Without this hook the autoscale
  // sees only dataset values and the band overflows the visible area whenever
  // the line happens to sit in a narrow range.
  afterDataLimits(chart: Chart, args: { scale: Scale }) {
    const scale = args.scale;
    if (scale.axis !== 'y') return;
    const opts = chart.options.plugins?.percentileBand as
      | PercentileBandOptions
      | undefined;
    if (!opts || !opts.enabled) return;
    const { p10, p90 } = opts;
    if (!p10 || !p90 || p10.length === 0 || p10.length !== p90.length) return;

    let bandMin = Infinity;
    let bandMax = -Infinity;
    for (let i = 0; i < p10.length; i++) {
      const lo = p10[i];
      const hi = p90[i];
      if (Number.isFinite(lo) && lo < bandMin) bandMin = lo;
      if (Number.isFinite(hi) && hi > bandMax) bandMax = hi;
    }
    if (!Number.isFinite(bandMin) || !Number.isFinite(bandMax)) return;

    let lineMax = -Infinity;
    for (const ds of chart.data.datasets) {
      const data = ds.data as Array<number | null | undefined>;
      for (const v of data) {
        if (typeof v === 'number' && Number.isFinite(v) && v > lineMax) lineMax = v;
      }
    }
    const capUpper = Number.isFinite(lineMax) ? lineMax * Y_CAP_MULT : bandMax;

    const curMin = typeof scale.min === 'number' ? scale.min : Infinity;
    const curMax = typeof scale.max === 'number' ? scale.max : -Infinity;
    scale.min = Math.min(curMin, bandMin);
    scale.max = Math.max(curMax, Math.min(bandMax, capUpper));
  },

  beforeDatasetsDraw(chart: Chart) {
    const opts = chart.options.plugins?.percentileBand as
      | PercentileBandOptions
      | undefined;
    if (!opts || !opts.enabled) return;
    const { p10, p90 } = opts;
    if (!p10 || !p90 || p10.length === 0 || p10.length !== p90.length) return;

    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if (!xScale || !yScale) return;

    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    // Trace upper edge left-to-right along p90.
    for (let i = 0; i < p90.length; i++) {
      const x = xScale.getPixelForValue(i);
      const y = yScale.getPixelForValue(p90[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    // Trace lower edge right-to-left along p10 to close the region.
    for (let i = p10.length - 1; i >= 0; i--) {
      const x = xScale.getPixelForValue(i);
      const y = yScale.getPixelForValue(p10[i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = opts.color;
    ctx.fill();
    ctx.restore();
  },
};

export default chartPercentileBandPlugin;
