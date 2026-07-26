import { useEffect, useMemo, useRef } from 'react';
import type { Chart as ChartJS, ChartData } from 'chart.js';
import { Chart as ReactChart } from 'react-chartjs-2';
import styled from 'styled-components';
import { spacing, colors, border, fontSize } from '../../styles/theme';
import {
  buildSecondaryChart,
  hasConversions,
  SECONDARY_VIEW_LABELS,
  type SecondaryChartInputs,
  type SecondaryLegendEntry,
  type SecondaryView,
} from './secondaryChartData';

const VIEWS: SecondaryView[] = ['income', 'expenses', 'balances', 'taxes'];

const PanelWrap = styled.div`
  margin-top: ${spacing.xs};
  padding: ${spacing.sm};
  border: ${border.standard};
  border-radius: ${border.radius};
  background: ${colors.bgLight};
`;

const SelectorRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  flex-wrap: wrap;
  margin-bottom: ${spacing.xs};
`;

const PillGroup = styled.div`
  display: inline-flex;
  border: ${border.standard};
  border-radius: ${border.radius};
  overflow: hidden;
  flex-wrap: wrap;
`;

const PillButton = styled.button<{ $active: boolean }>`
  padding: 1px ${spacing.sm};
  font-size: ${fontSize.xs};
  font-family: inherit;
  border: none;
  cursor: pointer;
  background: ${props => props.$active ? colors.primary : 'transparent'};
  color: ${props => props.$active ? colors.onPrimary : colors.textSecondary};
  &:hover { background: ${props => props.$active ? colors.primary : colors.bgHover}; }
`;

const ConversionToggle = styled.button<{ $active: boolean }>`
  margin-left: auto;
  height: 1.5rem;
  padding: 0 ${spacing.sm};
  font-size: ${fontSize.xs};
  font-family: inherit;
  line-height: 1;
  background: ${props => props.$active ? colors.bgMedium : 'transparent'};
  color: ${props => props.$active ? colors.textPrimary : colors.textSecondary};
  border: ${border.standard};
  border-radius: ${border.radius};
  cursor: pointer;
  &:hover { background: ${colors.bgHover}; }
`;

const LegendChips = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  flex-wrap: wrap;
  margin-bottom: ${spacing.xs};
  font-size: ${fontSize.xs};
  color: ${colors.textSecondary};
`;

const Swatch = styled.span<{ $color: string; $hatched?: boolean }>`
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
  ${props => props.$hatched
    ? `background: repeating-linear-gradient(45deg, ${props.$color}, ${props.$color} 2px, transparent 2px, transparent 5px); border: 1px solid ${props.$color};`
    : `background: ${props.$color};`}
`;

const ChipLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
`;

const Note = styled.div`
  margin-top: ${spacing.xs};
  font-size: ${fontSize.xs};
  color: ${colors.textMuted};
`;

const StripLabel = styled.div`
  margin-top: ${spacing.xs};
  font-size: ${fontSize.xs};
  color: ${colors.textMuted};
`;

// The react-chartjs-2 generic component pins its dataset type to the `type`
// prop ('bar'), but Chart.js happily renders mixed bar+line datasets at
// runtime. `asBarData` is the one sanctioned boundary cast.
type PanelChart = ChartJS<'bar', (number | null)[], string>;
type BarData = ChartData<'bar', (number | null)[], string>;
const asBarData = (d: unknown) => d as BarData;

type SecondaryChartPanelProps = {
  view: SecondaryView;
  onViewChange: (v: SecondaryView) => void;
  /** Builder inputs, minus the parent-owned conversion toggle. */
  inputs: Omit<SecondaryChartInputs, 'showConversions'>;
  /** Lifted to the parent (like `secondaryView`) so it survives panel close/reopen. */
  showConversions: boolean;
  onToggleConversions: () => void;
  hoveredIndex: number | null;
  onHoverIndex: (idx: number | null) => void;
  onYearClick: (idx: number) => void;
};

const SecondaryChartPanel = ({
  view,
  onViewChange,
  inputs,
  showConversions,
  onToggleConversions,
  hoveredIndex,
  onHoverIndex,
  onYearClick,
}: SecondaryChartPanelProps) => {
  const mainRef = useRef<PanelChart | null>(null);
  const stripRef = useRef<PanelChart | null>(null);
  const hoverRafRef = useRef<number | null>(null);

  const anyConversions = hasConversions(inputs.breakdowns);

  // Chart.js 4's ResizeObserver watches the canvas element itself, which has
  // an explicit inline width and won't grow on its own — force a re-measure on
  // window resize, same workaround as the main chart in Chart.tsx.
  useEffect(() => {
    const onResize = () => {
      mainRef.current?.resize();
      stripRef.current?.resize();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const built = useMemo(
    () => buildSecondaryChart(view, { ...inputs, showConversions: showConversions && anyConversions }),
    [view, inputs, showConversions, anyConversions],
  );

  // Crosshair index is injected via shallow merge so the (heavier) built
  // options object doesn't rebuild on every hover tick.
  const optionsWithCrosshair = useMemo(
    () => ({
      ...built.options,
      plugins: { ...built.options.plugins, crosshair: { activeIndex: hoveredIndex } },
    }),
    [built.options, hoveredIndex],
  );
  const stripOptionsWithCrosshair = useMemo(
    () => built.strip
      ? {
          ...built.strip.options,
          plugins: { ...built.strip.options.plugins, crosshair: { activeIndex: hoveredIndex } },
        }
      : null,
    [built.strip, hoveredIndex],
  );

  // Same rAF-throttled pixel→index mapping as the main chart's hover handler.
  const resolveIndex = (chart: PanelChart | null, clientX: number, rectLeft: number): number | null => {
    if (!chart) return null;
    const x = clientX - rectLeft;
    const { left, right } = chart.chartArea;
    if (x < left || x > right) return null;
    const raw = chart.scales.x.getValueForPixel(x);
    if (raw == null) return null;
    return Math.max(0, Math.min(Math.round(raw), inputs.years.length - 1));
  };

  const makeHoverHandlers = (ref: React.MutableRefObject<PanelChart | null>) => ({
    onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => {
      if (hoverRafRef.current !== null) return;
      const clientX = e.clientX;
      const rectLeft = e.currentTarget.getBoundingClientRect().left;
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        onHoverIndex(resolveIndex(ref.current, clientX, rectLeft));
      });
    },
    onMouseLeave: () => {
      if (hoverRafRef.current !== null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      onHoverIndex(null);
    },
    onClick: (e: React.MouseEvent<HTMLDivElement>) => {
      const idx = resolveIndex(ref.current, e.clientX, e.currentTarget.getBoundingClientRect().left);
      if (idx != null) onYearClick(idx);
    },
  });

  return (
    <PanelWrap>
      <SelectorRow>
        <PillGroup>
          {VIEWS.map((v) => (
            <PillButton key={v} $active={view === v} onClick={() => onViewChange(v)}>
              {SECONDARY_VIEW_LABELS[v]}
            </PillButton>
          ))}
        </PillGroup>
        {view === 'income' && anyConversions && (
          <ConversionToggle
            $active={showConversions}
            onClick={onToggleConversions}
            title="Conversions move money into Roth — they are not spendable income, so they're shown hatched and off by default."
          >
            {showConversions ? 'Hide conversions' : 'Show conversions'}
          </ConversionToggle>
        )}
      </SelectorRow>
      <LegendChips>
        {built.legend.map((l: SecondaryLegendEntry) => (
          <ChipLabel key={l.key}>
            <Swatch $color={l.color} $hatched={l.hatched} />
            {l.label}
          </ChipLabel>
        ))}
      </LegendChips>
      <div style={{ position: 'relative', height: 220 }} {...makeHoverHandlers(mainRef)}>
        <ReactChart type="bar" ref={mainRef} data={asBarData(built.data)} options={optionsWithCrosshair} />
      </div>
      {built.strip && stripOptionsWithCrosshair && (
        <>
          <StripLabel>{built.strip.label}</StripLabel>
          <div style={{ position: 'relative', height: 64 }} {...makeHoverHandlers(stripRef)}>
            <ReactChart type="bar" ref={stripRef} data={asBarData(built.strip.data)} options={stripOptionsWithCrosshair} />
          </div>
        </>
      )}
      {built.note && <Note>{built.note}</Note>}
    </PanelWrap>
  );
};

export default SecondaryChartPanel;
