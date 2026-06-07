import React, { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { colors, fontSize } from '../styles/theme';
import { formatCurrencyShort } from '../utils/formatCurrencyShort';
import { pathToDisplay, type DisplayCurrency } from '../utils/displayCurrency';

// Idempotent registration. Chart.tsx registers more components for the main
// chart; we only need the bare minimum here. Registering twice is a no-op.
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface Props {
  /** Projected balances for the current plan, indexed from year 0. These are
   *  the raw `path` arrays from `runDeterministicProjection`, which the engine
   *  has already deflated to real (year-0) dollars — see SimulationService.ts
   *  `path.push(startBalance / cumulativeInflation)`. We re-inflate for the
   *  'nominal' display mode via `pathToDisplay`, mirroring the main chart. */
  currentPath: number[];
  /** Same as `currentPath` but for the proposed plan. */
  proposedPath: number[];
  /** Cumulative inflation factor per year `[1, 1+r, (1+r)^2, ...]` from the
   *  projection. Used to re-inflate real path values back to nominal when the
   *  user has the main chart in 'Future $' mode. Both paths share this since
   *  both projections run with the same scenario inflation. */
  inflationFactors: number[];
  currentAge: number;
  /** Display mode driven by the main chart's view selector (UIStateContext).
   *  'real' shows today's purchasing power; 'nominal' shows future dollars. */
  displayCurrency: DisplayCurrency;
  /** Optional dataset labels (defaults to "Current plan" / "Proposed plan"). */
  currentLabel?: string;
  proposedLabel?: string;
  /** Optional third reference line (e.g. the user's originally-saved plan).
   *  Rendered as a distinct dotted line when provided with length > 0. */
  referencePath?: number[];
  referenceLabel?: string;
}

/**
 * Side-by-side deterministic projection: current plan vs a proposed plan.
 * Matches the main chart's units exactly — when the user toggles the main chart
 * between Today's $ / Future $, this chart follows so the two are never visually
 * inconsistent. Used by the Roth Conversion wizard and the Social Security
 * claiming-age wizard.
 *
 * Stripped-down Chart.js render — no annotations, no plugins, no axes
 * cross-talk with the main chart. Just two lines.
 */
const PlanComparisonChart: React.FC<Props> = ({
  currentPath, proposedPath, inflationFactors, currentAge, displayCurrency,
  currentLabel = 'Current plan', proposedLabel = 'Proposed plan',
  referencePath, referenceLabel = 'Reference',
}) => {
  const data = useMemo(() => {
    const hasRef = !!referencePath && referencePath.length > 0;
    const n = Math.min(
      currentPath.length,
      proposedPath.length,
      inflationFactors.length,
      hasRef ? referencePath!.length : Infinity,
    );
    const labels = Array.from({ length: n }, (_, i) => String(currentAge + i));
    const display = (path: number[]) =>
      path.slice(0, n).map((v, i) => pathToDisplay(v, inflationFactors[i] ?? 1, displayCurrency));
    // Order: current → reference → proposed, so the proposed line draws on top.
    const datasets = [
      {
        label: currentLabel,
        data: display(currentPath),
        borderColor: colors.textMuted,
        backgroundColor: colors.textMuted,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.1,
      },
      ...(hasRef
        ? [{
            label: referenceLabel,
            data: display(referencePath!),
            borderColor: colors.draftOverlay,
            backgroundColor: colors.draftOverlay,
            borderWidth: 1.5,
            borderDash: [2, 2],
            pointRadius: 0,
            tension: 0.1,
          }]
        : []),
      {
        label: proposedLabel,
        data: display(proposedPath),
        borderColor: colors.primary,
        backgroundColor: colors.primary,
        borderWidth: 2,
        borderDash: [4, 3],
        pointRadius: 0,
        tension: 0.1,
      },
    ];
    return { labels, datasets };
  }, [currentPath, proposedPath, referencePath, inflationFactors, currentAge, displayCurrency, currentLabel, proposedLabel, referenceLabel]);

  const yAxisLabel = displayCurrency === 'nominal' ? 'Future $' : "Today's $";
  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: {
          position: 'top' as const,
          align: 'end' as const,
          labels: { boxWidth: 12, boxHeight: 2, font: { size: 10 }, padding: 6 },
        },
        tooltip: {
          callbacks: {
            title: (items: { label: string }[]) => `Age ${items[0]?.label ?? ''}`,
            label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
              `${ctx.dataset.label}: ${formatCurrencyShort(ctx.parsed.y, 'precise')}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, maxTicksLimit: 8, autoSkip: true },
          title: { display: true, text: 'Age', font: { size: 10 } },
        },
        y: {
          ticks: {
            font: { size: 10 },
            callback: (v: number | string) =>
              formatCurrencyShort(typeof v === 'number' ? v : Number(v)),
          },
          title: { display: true, text: yAxisLabel, font: { size: 10 } },
        },
      },
    }),
    [yAxisLabel],
  );

  return (
    <div style={{ height: '12rem', marginTop: 4, fontSize: fontSize.xs }}>
      <Line data={data} options={options} />
    </div>
  );
};

export default PlanComparisonChart;
