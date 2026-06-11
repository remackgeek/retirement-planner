import type { Chart, Plugin, ChartType, Scale } from 'chart.js';

declare module 'chart.js' {
  // Type param name must match chart.js's own declaration for merging (TS2428).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    minYSpread?: MinYSpreadOptions;
  }
}

interface MinYSpreadOptions {
  // Minimum vertical span (in dataset units) the y-axis must cover. When the
  // natural autoscaled range is smaller, the plugin expands around the current
  // midpoint to hit this floor — keeps flat curves from looking misleadingly
  // tight and prevents large visual jumps when the percentile band toggles on.
  minSpread: number;
}

const chartMinYSpreadPlugin: Plugin = {
  id: 'minYSpread',
  afterDataLimits(chart: Chart, args: { scale: Scale }) {
    const scale = args.scale;
    if (scale.axis !== 'y') return;
    const opts = chart.options.plugins?.minYSpread;
    const minSpread = opts?.minSpread;
    if (!minSpread || minSpread <= 0) return;
    const min = typeof scale.min === 'number' ? scale.min : null;
    const max = typeof scale.max === 'number' ? scale.max : null;
    if (min === null || max === null) return;
    const spread = max - min;
    if (spread >= minSpread) return;
    // Expand around midpoint, but clamp at 0 so the y-axis never goes negative.
    // Any padding the lower edge couldn't absorb (because it hit 0) gets
    // pushed onto the upper edge instead.
    const pad = (minSpread - spread) / 2;
    const newMin = Math.max(0, min - pad);
    const lowerAbsorbed = min - newMin;
    const upperPad = pad + (pad - lowerAbsorbed);
    scale.min = newMin;
    scale.max = max + upperPad;
  },
};

export default chartMinYSpreadPlugin;
