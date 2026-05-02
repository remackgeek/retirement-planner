import { Chart } from 'chart.js';
import type { Plugin, ChartType } from 'chart.js';

// Extend Chart.js types so options are type-safe at every call-site.
declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    crosshair?: CrosshairOptions;
  }
}

interface CrosshairOptions {
  // 0-based index into the chart's year array for the currently active crosshair,
  // or null when no crosshair should be shown.
  //
  // Usage: include this plugin's options in the chart's `options.plugins.crosshair`
  // object and add the React state variable to the `options` useMemo deps.
  // react-chartjs-2 detects the options change and calls chart.update() automatically.
  activeIndex: number | null;
}

// Draws a dashed vertical line at the hovered year position, on top of the
// dataset lines but below any HTML overlay elements (badges, stat box).
const chartCrosshairPlugin: Plugin = {
  id: 'crosshair',

  afterDraw(chart: Chart) {
    const idx = chart.options.plugins?.crosshair?.activeIndex ?? null;
    if (idx === null) return;

    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(idx);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.strokeStyle = 'rgba(80, 80, 80, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  },
};

export default chartCrosshairPlugin;
