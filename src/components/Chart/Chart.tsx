import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Tooltip as PrimeTooltip } from 'primereact/tooltip';
import htmlAnnotationsPlugin, {
  type AnnotationConfig,
} from '../../plugins/chartHtmlAnnotations';
import chartBlackSwanShadingPlugin from '../../plugins/chartBlackSwanShading';
import chartCrosshairPlugin from '../../plugins/chartCrosshair';
import {
  type AnnualCashFlowBreakdown,
} from '../../services/SimulationService';
import React, { useState, useMemo, useEffect, useRef, useContext, useCallback } from 'react';
import styled from 'styled-components';
import { Menu } from 'primereact/menu';
import { spacing, colors, border, fontSize, mediaQuery } from '../../styles/theme';
import { useUIState } from '../../context/UIStateContext';
import { RetirementContext } from '../../context/RetirementContext';
import { toDisplay, pathToDisplay, type DisplayCurrency } from '../../utils/displayCurrency';
import { eventTypeIcons, goalTypeIcons } from '../../utils/defaultName';
import { getProbabilityTier } from '../../utils/probabilityTier';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  htmlAnnotationsPlugin,
  chartBlackSwanShadingPlugin,
  chartCrosshairPlugin
);

type ViewMode = 'median' | 'nominal' | 'downside';

const VIEW_COLORS: Record<ViewMode, string> = {
  median: colors.chartMedian,
  nominal: colors.chartNominal,
  downside: colors.chartDownside,
};

const VIEW_LABELS: Record<ViewMode, string> = {
  median: 'Median',
  nominal: 'Deterministic',
  downside: 'Downside',
};

// --- Styled components ---

const ChartHeading = styled.h2`
  margin: 0 0 ${spacing.sm};
  font-size: 1.4rem;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: ${spacing.sm};
  ${mediaQuery.mobile} { font-size: ${fontSize.xl}; }
`;

const UpdatingBadge = styled.span`
  font-size: ${fontSize.xs};
  color: ${colors.textMuted};
  font-weight: normal;
`;

const TierBadge = styled.span<{ $color: string; $bg: string }>`
  display: inline-flex;
  align-items: center;
  padding: 1px ${spacing.xs};
  background: ${props => props.$bg};
  color: ${props => props.$color};
  border-radius: ${border.radiusRound};
  font-size: ${fontSize.xs};
  font-weight: 500;
  cursor: help;
  align-self: flex-end;
  margin-bottom: 3px;
`;

const CompareWithButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  padding: 2px ${spacing.sm};
  font-size: ${fontSize.xs};
  font-family: inherit;
  font-weight: 500;
  background: transparent;
  border: 1px solid ${colors.primary};
  border-radius: ${border.radiusRound};
  color: ${colors.primary};
  cursor: pointer;
  margin-left: auto;
  &:hover { background: rgba(61, 122, 95, 0.08); }
`;

const ChartSubtitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${spacing.xs};
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
  flex-wrap: wrap;
  gap: ${spacing.xs};
`;

const CurrencyPillGroup = styled.div`
  display: inline-flex;
  border: ${border.standard};
  border-radius: ${border.radius};
  overflow: hidden;
`;

const CurrencyPillButton = styled.button<{ $active: boolean }>`
  padding: 1px ${spacing.sm};
  font-size: ${fontSize.xs};
  font-family: inherit;
  border: none;
  cursor: pointer;
  background: ${props => props.$active ? colors.primary : 'transparent'};
  color: ${props => props.$active ? '#fff' : colors.textSecondary};
  &:hover { background: ${props => props.$active ? colors.primary : colors.bgHover}; }
`;

const LegendRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.xs};
  margin-top: ${spacing.xs};
  margin-bottom: ${spacing.xs};
  flex-wrap: wrap;
`;

const LegendButton = styled.button<{ $active: boolean; $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px ${spacing.sm};
  border-radius: ${border.radius};
  font-size: ${fontSize.sm};
  font-family: inherit;
  font-weight: ${props => props.$active ? '700' : 'normal'};
  color: ${props => props.$active ? props.$color : colors.textSecondary};
  text-decoration: ${props => props.$active ? 'underline' : 'none'};
  text-underline-offset: 2px;
  &:hover { background: ${colors.bgHover}; }
`;

const LegendSwatch = styled.span<{ $color: string; $dashed?: boolean }>`
  display: inline-block;
  width: 18px;
  height: ${props => props.$dashed ? '0' : '3px'};
  background: ${props => props.$dashed ? 'transparent' : props.$color};
  border-top: ${props => props.$dashed ? `2px dashed ${props.$color}` : 'none'};
  border-radius: 2px;
  flex-shrink: 0;
`;

const DataToggle = styled.button<{ $active: boolean }>`
  margin-left: auto;
  padding: 2px ${spacing.sm};
  font-size: ${fontSize.xs};
  font-family: inherit;
  background: ${props => props.$active ? colors.primary : colors.bgMedium};
  color: ${props => props.$active ? '#fff' : colors.textPrimary};
  border: ${border.standard};
  border-radius: ${border.radius};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  &:hover { background: ${props => props.$active ? colors.primary : colors.bgHover}; }
`;

function useIsMobile(): boolean {
  const query = '(max-width: 767px)';
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

function exportCsv(
  scenarioName: string,
  years: number[],
  nominal: number[],
  median: number[],
  downside: number[],
  nominalInflation: number[],
  medianInflation: number[],
  downsideInflation: number[],
  breakdownInflation: number[],
  annualBreakdowns: AnnualCashFlowBreakdown[],
  currentAge: number,
  displayCurrency: DisplayCurrency,
  options: { nominalHidden: boolean; medianDownsideHidden: boolean },
) {
  const modeLabel = displayCurrency === 'real' ? "today's dollars" : 'nominal dollars';
  const timestamp = new Date().toISOString();
  const comment = `# scenario: ${scenarioName} | exported: ${timestamp} | values in ${modeLabel}`;
  const pathHeaders: string[] = [];
  if (!options.nominalHidden) pathHeaders.push('Deterministic Portfolio ($)');
  if (!options.medianDownsideHidden) pathHeaders.push('Median Portfolio ($)', 'Downside Portfolio ($)');
  const header = [
    'Age', 'Year',
    ...pathHeaders,
    'SS Gross', 'Other Taxable Income', 'After-Tax Income', 'Total Gross Income',
    'Base Spending', 'Goal Spending', 'Total Spending',
    'Total Tax', 'Ordinary Income Tax', 'Capital Gains Tax', 'Portfolio Withdrawal',
    'Withdrawal — Taxable', 'Withdrawal — Traditional', 'Withdrawal — Roth',
    'RMD Required', 'RMD Reinvested',
    'Roth Conversion',
    'Net Cash Flow',
  ].join(',');

  const rows = years.map((year, i) => {
    const bd = annualBreakdowns[i];
    const bdF = breakdownInflation[i] ?? 1;
    const pathCells: number[] = [];
    if (!options.nominalHidden) {
      pathCells.push(Math.round(pathToDisplay(nominal[i] ?? 0, nominalInflation[i] ?? 1, displayCurrency)));
    }
    if (!options.medianDownsideHidden) {
      pathCells.push(Math.round(pathToDisplay(median[i] ?? 0, medianInflation[i] ?? 1, displayCurrency)));
      pathCells.push(Math.round(pathToDisplay(downside[i] ?? 0, downsideInflation[i] ?? 1, displayCurrency)));
    }
    return [
      currentAge + i,
      year,
      ...pathCells,
      Math.round(toDisplay(bd.ssGross, bdF, displayCurrency)),
      Math.round(toDisplay(bd.otherTaxableGross, bdF, displayCurrency)),
      Math.round(toDisplay(bd.afterTaxIncome, bdF, displayCurrency)),
      Math.round(toDisplay(bd.totalGrossIncome, bdF, displayCurrency)),
      Math.round(toDisplay(bd.baseSpendingNet, bdF, displayCurrency)),
      Math.round(toDisplay(bd.otherSpendingGoalsNet, bdF, displayCurrency)),
      Math.round(toDisplay(bd.totalSpendingNet, bdF, displayCurrency)),
      Math.round(toDisplay(bd.totalTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.ordinaryTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.capitalGainsTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.portfolioWithdrawal, bdF, displayCurrency)),
      Math.round(toDisplay(bd.withdrawalFromTaxable, bdF, displayCurrency)),
      Math.round(toDisplay(bd.withdrawalFromTraditional, bdF, displayCurrency)),
      Math.round(toDisplay(bd.withdrawalFromRoth, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rmdRequired, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rmdExcess, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rothConversionGross, bdF, displayCurrency)),
      Math.round(toDisplay(bd.netCashFlow, bdF, displayCurrency)),
    ].join(',');
  });

  const csv = [comment, header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${scenarioName.replace(/[^a-z0-9]/gi, '-')}-projection.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const Projections = ({
  results,
  userData,
  isCalculating,
  compareResults,
  compareScenario,
  isCompareCalculating,
  onSetCompare,
  onRegisterExport,
}: {
  results: any;
  userData: any;
  isCalculating?: boolean;
  compareResults?: any;
  compareScenario?: any;
  isCompareCalculating?: boolean;
  onSetCompare: (id: string | null) => void;
  onRegisterExport?: (fn: (() => void) | null) => void;
}) => {
  if (!results) return null;
  const {
    probability, median, downside, nominal, nominalBreakdowns, years,
    medianStockFactors, medianBondFactors, medianBreakdowns,
    downsideStockFactors, downsideBondFactors, downsideBreakdowns,
    medianInflation, downsideInflation, nominalInflation,
  } = results;

  const { displayCurrency, setDisplayCurrency } = useUIState();
  const context = useContext(RetirementContext);
  const scenarios = context?.scenarios ?? [];
  const compareMenuRef = useRef<Menu>(null);
  const compareMenuItems = scenarios
    .filter(s => s.id !== userData.id)
    .map(s => ({ label: s.name, command: () => onSetCompare(s.id) }));

  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [view, setView] = useState<ViewMode>('nominal');
  const [showData, setShowData] = useState(false);

  // Different return models expose different views:
  //  - parametric:           median + nominal + downside (full Monte Carlo + parametric mean)
  //  - historical_single:    nominal only (one deterministic slice; median/downside collapse)
  //  - historical_rolling:   median + downside (no canonical deterministic baseline)
  //  - historical_bootstrap: median + downside (same)
  // Nominal in historical_single is the slice itself (see createNominalGenerator).
  const returnModel = userData?.portfolioAssumptions?.returnModel ?? 'parametric';
  const nominalHidden = returnModel === 'historical_rolling' || returnModel === 'historical_bootstrap';
  const medianDownsideHidden = returnModel === 'historical_single';
  useEffect(() => {
    if (nominalHidden && view === 'nominal') setView('median');
    if (medianDownsideHidden && view !== 'nominal') setView('nominal');
  }, [nominalHidden, medianDownsideHidden, view]);
  const visibleViewModes: ViewMode[] = medianDownsideHidden
    ? ['nominal']
    : nominalHidden
      ? ['median', 'downside']
      : ['median', 'nominal', 'downside'];

  const buildExportFn = useCallback(() => {
    const bdInflation = view === 'median' ? medianInflation : view === 'nominal' ? nominalInflation : downsideInflation;
    const bdBreakdowns = view === 'median' ? medianBreakdowns : view === 'nominal' ? nominalBreakdowns : downsideBreakdowns;
    exportCsv(
      userData.name ?? 'scenario',
      years, nominal, median, downside,
      nominalInflation, medianInflation, downsideInflation,
      bdInflation, bdBreakdowns,
      userData.currentAge,
      displayCurrency,
      { nominalHidden, medianDownsideHidden },
    );
  }, [view, userData, years, nominal, median, downside, medianInflation, nominalInflation, downsideInflation, medianBreakdowns, nominalBreakdowns, downsideBreakdowns, displayCurrency, nominalHidden, medianDownsideHidden]);

  useEffect(() => {
    onRegisterExport?.(buildExportFn);
    return () => onRegisterExport?.(null);
  }, [buildExportFn, onRegisterExport]);

  const toggleRow = (index: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  // --- Crosshair hover state ---
  const chartRef = useRef<any>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hoverRafRef = useRef<number | null>(null);

  const isMobile = useIsMobile();

  // Chart.js 4.x ResizeObserver watches the canvas element itself, which has an
  // explicit inline style.width set by Chart.js and won't grow on its own.
  // Force a re-measure from the parent container on every window resize event so
  // the chart expands when the sidebar collapses or the browser window grows.
  useEffect(() => {
    const onResize = () => { chartRef.current?.resize(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const labels = useMemo(
    () => years.map((_: number, index: number) => `${userData.currentAge + index} (${years[index]})`),
    [years, userData.currentAge]
  );

  const chartData = useMemo(() => {
    const toDisplayPath = (path: number[], infArr: number[]) =>
      path.map((v, i) => pathToDisplay(v, infArr[i] ?? 1, displayCurrency));
    const makeDataset = (label: string, mode: ViewMode, data: number[], dashed = false) => ({
      label,
      data,
      borderColor: dashed ? VIEW_COLORS[mode] + '80' : VIEW_COLORS[mode],
      backgroundColor: dashed ? VIEW_COLORS[mode] + '80' : VIEW_COLORS[mode],
      borderWidth: dashed ? 2 : (view === mode ? 4 : 1.5),
      borderDash: dashed ? [6, 3] : [],
      pointRadius: 0,
    });
    const datasets: ReturnType<typeof makeDataset>[] = [];
    if (!medianDownsideHidden) {
      datasets.push(makeDataset('Median', 'median', toDisplayPath(median, medianInflation)));
    }
    if (!nominalHidden) {
      datasets.push(makeDataset('Deterministic', 'nominal', toDisplayPath(nominal, nominalInflation)));
    }
    if (!medianDownsideHidden) {
      datasets.push(makeDataset('Downside (10th percentile)', 'downside', toDisplayPath(downside, downsideInflation)));
    }
    if (compareResults && compareScenario) {
      const cPath = view === 'median' ? compareResults.median
                  : view === 'nominal' ? compareResults.nominal
                  : compareResults.downside;
      const cInf = view === 'median' ? compareResults.medianInflation
                 : view === 'nominal' ? compareResults.nominalInflation
                 : compareResults.downsideInflation;
      if (cPath && cInf) {
        datasets.push(makeDataset(compareScenario.name, view, toDisplayPath(cPath, cInf), true));
      }
    }
    return { labels, datasets };
  }, [labels, median, nominal, downside, medianInflation, nominalInflation, downsideInflation, displayCurrency, view, nominalHidden, medianDownsideHidden, compareResults, compareScenario]);

  // Group income events / spending goals by their start year once, then iterate
  // years to build the annotation list. Avoids N × M filter passes per render.
  const htmlAnnotations = useMemo<AnnotationConfig[]>(() => {
    const eventsByYear = new Map<number, any[]>();
    for (const event of userData.incomeEvents) {
      const ownerAge = (event.owner === 'spouse' && userData.spouseAge != null)
        ? userData.spouseAge : userData.currentAge;
      const startYear = userData.referenceYear + (event.startAge - ownerAge);
      const list = eventsByYear.get(startYear);
      if (list) list.push(event); else eventsByYear.set(startYear, [event]);
    }
    const goalsByYear = new Map<number, any[]>();
    for (const goal of userData.spendingGoals) {
      const startYear = userData.referenceYear + (goal.startAge - userData.currentAge);
      const list = goalsByYear.get(startYear);
      if (list) list.push(goal); else goalsByYear.set(startYear, [goal]);
    }

    const result: AnnotationConfig[] = [];
    years.forEach((year: number, index: number) => {
      const startingEvents = eventsByYear.get(year) ?? [];
      const startingGoals = goalsByYear.get(year) ?? [];
      startingEvents.forEach((event, eventIndex) => {
        result.push({
          id: `income_${event.id}_${year}`,
          type: 'income' as const,
          eventType: event.type,
          xValue: index,
          yValue: 0,
          stackIndex: eventIndex,
          data: event,
        });
      });
      startingGoals.forEach((goal, goalIndex) => {
        result.push({
          id: `spending_${goal.id}_${year}`,
          type: 'spending' as const,
          eventType: goal.type,
          xValue: index,
          yValue: 0,
          stackIndex: startingEvents.length + goalIndex,
          data: goal,
        });
      });
    });
    return result;
  }, [years, userData.incomeEvents, userData.spendingGoals, userData.referenceYear, userData.currentAge, userData.spouseAge]);

  const options = useMemo(() => ({
    responsive: true,
    plugins: {
      tooltip: { enabled: false },
      legend: { display: false },
      title: { display: false },
      htmlAnnotations: {
        annotations: htmlAnnotations,
        onIconClick: (annotation: AnnotationConfig) => {
          console.log('Clicked annotation:', annotation);
        },
        onIconHover: (annotation: AnnotationConfig | null) => {
          console.log('Hovered annotation:', annotation);
        },
      },
      blackSwanShading: {
        events: userData.portfolioAssumptions?.blackSwanEvents ?? [],
        years,
      },
      crosshair: {
        activeIndex: hoveredIndex,
      },
    },
    scales: {
      x: {
        ticks: {
          font: { size: isMobile ? 9 : 11 },
          maxTicksLimit: isMobile ? 6 : undefined,
        },
      },
      y: {
        ticks: {
          font: { size: isMobile ? 9 : 11 },
        },
      },
    },
  }), [isMobile, htmlAnnotations, userData.portfolioAssumptions?.blackSwanEvents, years, hoveredIndex]);


  return (
    <div>
      <ChartHeading>
        {compareScenario ? (
          <>
            <span>{userData.name}:</span>
            <span>{isCalculating ? '—' : `${probability}%`}</span>
            {!isCalculating && (() => {
              const tierInfo = getProbabilityTier(probability);
              return (
                <>
                  <PrimeTooltip target=".chance-tier-badge-primary" position="bottom" showDelay={150}>
                    <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>{tierInfo.tooltip}</div>
                  </PrimeTooltip>
                  <TierBadge
                    className="chance-tier-badge-primary"
                    $color={tierInfo.color}
                    $bg={tierInfo.backgroundColor}
                    aria-label={`Tier: ${tierInfo.label}. ${tierInfo.tooltip}`}
                  >
                    {tierInfo.label}
                  </TierBadge>
                </>
              );
            })()}
            {isCalculating && <UpdatingBadge style={{ marginLeft: spacing.md }}>Updating projection…</UpdatingBadge>}
            <span style={{ color: colors.textMuted, fontWeight: 400, fontSize: fontSize.sm }}>vs.</span>
            <span>{compareScenario.name}:</span>
            <span>{compareResults ? `${compareResults.probability}%` : '—'}</span>
            {compareResults && (() => {
              const tierInfo = getProbabilityTier(compareResults.probability);
              return (
                <>
                  <PrimeTooltip target=".chance-tier-badge-compare" position="bottom" showDelay={150}>
                    <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>{tierInfo.tooltip}</div>
                  </PrimeTooltip>
                  <TierBadge
                    className="chance-tier-badge-compare"
                    $color={tierInfo.color}
                    $bg={tierInfo.backgroundColor}
                    aria-label={`Compare tier: ${tierInfo.label}. ${tierInfo.tooltip}`}
                    style={{ opacity: 0.75 }}
                  >
                    {tierInfo.label}
                  </TierBadge>
                </>
              );
            })()}
            {isCompareCalculating
              ? <UpdatingBadge style={{ marginLeft: 'auto' }}>Loading…</UpdatingBadge>
              : <CompareWithButton onClick={() => onSetCompare(null)}>End comparison</CompareWithButton>
            }
          </>
        ) : (
          <>
            <span>Chance of Success: {isCalculating ? '—' : `${probability}%`}</span>
            {!isCalculating && (() => {
              const tierInfo = getProbabilityTier(probability);
              return (
                <>
                  <PrimeTooltip target=".chance-tier-badge" position="bottom" showDelay={150}>
                    <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                      {tierInfo.tooltip}
                    </div>
                  </PrimeTooltip>
                  <TierBadge
                    className="chance-tier-badge"
                    $color={tierInfo.color}
                    $bg={tierInfo.backgroundColor}
                    aria-label={`Tier: ${tierInfo.label}. ${tierInfo.tooltip}`}
                  >
                    {tierInfo.label}
                  </TierBadge>
                </>
              );
            })()}
            {isCalculating && <UpdatingBadge style={{ marginLeft: spacing.md }}>Updating projection…</UpdatingBadge>}
            {compareMenuItems.length > 0 && (
              <>
                <Menu ref={compareMenuRef} model={compareMenuItems} popup />
                <CompareWithButton onClick={(e) => compareMenuRef.current?.toggle(e)}>
                  Compare with <i className="pi pi-chevron-down" style={{ fontSize: '0.6rem' }} />
                </CompareWithButton>
              </>
            )}
          </>
        )}
      </ChartHeading>
      <ChartSubtitleRow>
        <span>Projected Portfolio Value</span>
        <PrimeTooltip target=".currency-pill-group" position="bottom" showDelay={150}>
          <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
            <div style={{ marginBottom: spacing.xs }}>
              <strong>Today's Dollars</strong>: Values adjusted for inflation (what your money can actually buy today).
            </div>
            <div>
              <strong>Nominal Dollars</strong>: Raw future dollar amounts with no inflation adjustment.
            </div>
          </div>
        </PrimeTooltip>
        <CurrencyPillGroup className="currency-pill-group">
          <CurrencyPillButton $active={displayCurrency === 'real'} onClick={() => setDisplayCurrency('real')}>Today's $</CurrencyPillButton>
          <CurrencyPillButton $active={displayCurrency === 'nominal'} onClick={() => setDisplayCurrency('nominal')}>Nominal $</CurrencyPillButton>
        </CurrencyPillGroup>
      </ChartSubtitleRow>
      <div
        style={{ position: 'relative' }}
        onMouseMove={(e) => {
          if (hoverRafRef.current !== null) return;
          const clientX = e.clientX;
          const rect = e.currentTarget.getBoundingClientRect();
          hoverRafRef.current = requestAnimationFrame(() => {
            hoverRafRef.current = null;
            const chart = chartRef.current;
            if (!chart) return;
            const x = clientX - rect.left;
            const { left, right } = chart.chartArea;
            if (x < left || x > right) { setHoveredIndex(null); return; }
            const raw = chart.scales.x.getValueForPixel(x);
            if (raw == null) return;
            const idx = Math.max(0, Math.min(Math.round(raw), years.length - 1));
            setHoveredIndex(prev => prev === idx ? prev : idx);
          });
        }}
        onMouseLeave={() => {
          if (hoverRafRef.current !== null) {
            cancelAnimationFrame(hoverRafRef.current);
            hoverRafRef.current = null;
          }
          setHoveredIndex(null);
        }}
      >
        <Line ref={chartRef} options={options} data={chartData} />
        {hoveredIndex !== null && chartRef.current && (() => {
          const chart = chartRef.current;
          const { top, left, right } = chart.chartArea;
          const xPx = chart.scales.x.getPixelForValue(hoveredIndex);
          const isRight = xPx > (left + right) / 2;
          const age = userData.currentAge + hoveredIndex;
          const year = years[hoveredIndex];

          const getF = (inf: number[]) => inf[hoveredIndex] ?? 1;

          const nomVal = pathToDisplay(nominal[hoveredIndex] ?? 0, getF(nominalInflation), displayCurrency);
          const medVal = pathToDisplay(median[hoveredIndex] ?? 0, getF(medianInflation), displayCurrency);
          const dwnVal = pathToDisplay(downside[hoveredIndex] ?? 0, getF(downsideInflation), displayCurrency);

          const yoyDelta = (path: number[], inf: number[]) => {
            if (hoveredIndex === 0) return null;
            return pathToDisplay(path[hoveredIndex] ?? 0, inf[hoveredIndex] ?? 1, displayCurrency)
                 - pathToDisplay(path[hoveredIndex - 1] ?? 0, inf[hoveredIndex - 1] ?? 1, displayCurrency);
          };
          const nomDelta = yoyDelta(nominal, nominalInflation);
          const medDelta = yoyDelta(median, medianInflation);
          const dwnDelta = yoyDelta(downside, downsideInflation);

          const selInf = view === 'median' ? medianInflation : view === 'nominal' ? nominalInflation : downsideInflation;
          const selBd = (view === 'median' ? medianBreakdowns : view === 'nominal' ? nominalBreakdowns : downsideBreakdowns)[hoveredIndex];
          const bdF = getF(selInf);
          const shortfall = toDisplay(selBd.spendingShortfall ?? 0, bdF, displayCurrency);
          const net = toDisplay(selBd.netCashFlow, bdF, displayCurrency);

          const fmtM = (v: number) => {
            const a = Math.abs(v);
            if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(1)}M`;
            if (a >= 1_000) return `$${Math.round(a / 1_000)}K`;
            return `$${Math.round(a)}`;
          };
          const fmtD = (d: number | null) =>
            d === null ? null : `${d >= 0 ? '+' : '−'}${fmtM(Math.abs(d))}`;

          // Compare tooltip data
          const cPath = compareResults
            ? (view === 'median' ? compareResults.median : view === 'nominal' ? compareResults.nominal : compareResults.downside)
            : null;
          const cInfArr = compareResults
            ? (view === 'median' ? compareResults.medianInflation : view === 'nominal' ? compareResults.nominalInflation : compareResults.downsideInflation)
            : null;
          const cBds = compareResults
            ? (view === 'median' ? compareResults.medianBreakdowns : view === 'nominal' ? compareResults.nominalBreakdowns : compareResults.downsideBreakdowns)
            : null;
          const cVal = cPath && cInfArr ? pathToDisplay(cPath[hoveredIndex] ?? 0, cInfArr[hoveredIndex] ?? 1, displayCurrency) : null;
          const cDelta = cPath && cInfArr && hoveredIndex > 0
            ? pathToDisplay(cPath[hoveredIndex] ?? 0, cInfArr[hoveredIndex] ?? 1, displayCurrency)
              - pathToDisplay(cPath[hoveredIndex - 1] ?? 0, cInfArr[hoveredIndex - 1] ?? 1, displayCurrency)
            : null;
          const cBd = cBds?.[hoveredIndex] ?? null;
          const cBdF = cInfArr?.[hoveredIndex] ?? 1;

          const isComparing = compareResults != null && compareScenario != null;

          const pathRows: Array<{ mode: ViewMode; val: number; delta: number | null }> = [
            { mode: 'nominal',  val: nomVal, delta: nomDelta },
            { mode: 'median',   val: medVal, delta: medDelta },
            { mode: 'downside', val: dwnVal, delta: dwnDelta },
          ];

          return (
            <div style={{
              position: 'absolute',
              top: top + 4,
              ...(isRight ? { right: chart.width - xPx + 12 } : { left: xPx + 12 }),
              zIndex: 10,
              pointerEvents: 'none',
              background: 'rgba(255,255,255,0.97)',
              border: border.standard,
              borderRadius: border.radiusRound,
              padding: `${spacing.xs} ${spacing.sm}`,
              fontSize: fontSize.xs,
              boxShadow: `0 2px 8px ${colors.shadowLight}`,
              minWidth: isComparing ? '18rem' : '13rem',
              lineHeight: '1.5',
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: spacing.xs, color: colors.textPrimary, fontSize: fontSize.sm }}>
                Age {age} · {year}
              </div>
              {isComparing ? (
                <>
                  <div style={{ display: 'flex', gap: spacing.sm, marginBottom: '2px' }}>
                    <span style={{ flex: 1, fontWeight: 'bold', color: VIEW_COLORS[view] }}>{userData.name}</span>
                    <span style={{ flex: 1, fontWeight: 'bold', color: VIEW_COLORS[view] + '99' }}>{compareScenario.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.xs }}>
                    <div style={{ flex: 1, color: colors.textPrimary }}>
                      {fmtM(view === 'nominal' ? nomVal : view === 'median' ? medVal : dwnVal)}
                      {(() => {
                        const d = fmtD(view === 'nominal' ? nomDelta : view === 'median' ? medDelta : dwnDelta);
                        const delta = view === 'nominal' ? nomDelta : view === 'median' ? medDelta : dwnDelta;
                        return d ? <span style={{ color: (delta ?? 0) >= 0 ? colors.income : colors.danger }}> {d}</span> : null;
                      })()}
                    </div>
                    <div style={{ flex: 1, color: colors.textPrimary, opacity: 0.75 }}>
                      {cVal !== null ? fmtM(cVal) : '—'}
                      {cDelta !== null && cVal !== null && (
                        <span style={{ color: cDelta >= 0 ? colors.income : colors.danger }}> {fmtD(cDelta)}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ borderTop: border.light, margin: `${spacing.xs} 0` }} />
                  {(['totalGrossIncome', 'totalSpendingNet', 'totalTax'] as const).map((field, i) => {
                    const labels = ['Inc', 'Spend', 'Tax'];
                    const labelColors = [colors.income, colors.spending, colors.textSecondary];
                    return (
                      <div key={field} style={{ display: 'flex', gap: spacing.sm, color: colors.textSecondary }}>
                        <span style={{ color: labelColors[i], minWidth: '2.8rem' }}>{labels[i]}</span>
                        <span style={{ flex: 1 }}>{fmtM(toDisplay(selBd[field], bdF, displayCurrency))}</span>
                        <span style={{ flex: 1, opacity: 0.75 }}>
                          {cBd ? fmtM(toDisplay(cBd[field], cBdF, displayCurrency)) : '—'}
                        </span>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: spacing.sm, marginTop: '1px' }}>
                    <span style={{ color: colors.textSecondary, minWidth: '2.8rem' }}>Net</span>
                    <span style={{ flex: 1, color: net >= 0 ? colors.income : colors.danger, fontWeight: 'bold' }}>
                      {net >= 0 ? '+' : '−'}{fmtM(Math.abs(net))}
                    </span>
                    {cBd && (() => {
                      const cNet = toDisplay(cBd.netCashFlow, cBdF, displayCurrency);
                      return (
                        <span style={{ flex: 1, color: cNet >= 0 ? colors.income : colors.danger, fontWeight: 'bold', opacity: 0.75 }}>
                          {cNet >= 0 ? '+' : '−'}{fmtM(Math.abs(cNet))}
                        </span>
                      );
                    })()}
                  </div>
                  {shortfall > 0.5 && (
                    <div style={{ color: colors.danger, marginTop: spacing.xs, fontWeight: 'bold' }}>
                      Portfolio Depleted
                    </div>
                  )}
                </>
              ) : (
                <>
                  {pathRows.map(({ mode, val, delta }) => {
                    const d = fmtD(delta);
                    const isSelected = view === mode;
                    return (
                      <div key={mode} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontWeight: isSelected ? 'bold' : 'normal',
                        opacity: isSelected ? 1 : 0.55,
                        marginBottom: '1px',
                      }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          backgroundColor: VIEW_COLORS[mode],
                          flexShrink: 0, display: 'inline-block',
                        }} />
                        <span style={{ width: '5rem', color: colors.textPrimary }}>{VIEW_LABELS[mode]}</span>
                        <span style={{ flex: 1, textAlign: 'right', color: colors.textPrimary }}>{fmtM(val)}</span>
                        {d !== null && (
                          <span style={{
                            minWidth: '3.5rem', textAlign: 'right',
                            color: (delta ?? 0) >= 0 ? colors.income : colors.danger,
                          }}>
                            {d}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <div style={{ borderTop: border.light, margin: `${spacing.xs} 0` }} />
                  <div style={{ color: VIEW_COLORS[view], fontWeight: 'bold', marginBottom: '2px' }}>
                    {VIEW_LABELS[view]}
                  </div>
                  <div style={{ display: 'flex', gap: spacing.sm, color: colors.textSecondary, flexWrap: 'wrap' }}>
                    <span><span style={{ color: colors.income }}>Inc</span> {fmtM(toDisplay(selBd.totalGrossIncome, bdF, displayCurrency))}</span>
                    <span><span style={{ color: colors.spending }}>Spend</span> {fmtM(toDisplay(selBd.totalSpendingNet, bdF, displayCurrency))}</span>
                    <span>Tax {fmtM(toDisplay(selBd.totalTax, bdF, displayCurrency))}</span>
                  </div>
                  <div style={{ marginTop: '1px', color: colors.textSecondary }}>
                    Net <span style={{ color: net >= 0 ? colors.income : colors.danger, fontWeight: 'bold' }}>
                      {net >= 0 ? '+' : '−'}{fmtM(Math.abs(net))}
                    </span>
                  </div>
                  {shortfall > 0.5 && (
                    <div style={{ color: colors.danger, marginTop: spacing.xs, fontWeight: 'bold' }}>
                      Portfolio Depleted
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}
      </div>
      <LegendRow>
        {visibleViewModes.map(mode => (
          <LegendButton
            key={mode}
            $active={view === mode}
            $color={VIEW_COLORS[mode]}
            onClick={() => setView(mode)}
          >
            <LegendSwatch $color={VIEW_COLORS[mode]} />
            {VIEW_LABELS[mode]}
          </LegendButton>
        ))}
        {compareScenario && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.xs, fontSize: fontSize.sm, color: colors.textSecondary, padding: `2px ${spacing.sm}` }}>
            <LegendSwatch $color={VIEW_COLORS[view] + '80'} $dashed />
            {compareScenario.name}
          </span>
        )}
        <DataToggle $active={showData} onClick={() => setShowData(d => !d)}>
          <i className="pi pi-table" />
          Data
        </DataToggle>
      </LegendRow>
      {showData && (
        <div style={{ marginTop: spacing.xs }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <td colSpan={6} style={{ padding: `${spacing.xs} ${spacing.sm} 0`, fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'right', border: 'none' }}>
                    All values in {displayCurrency === 'real' ? "today's" : 'nominal'} dollars
                  </td>
                </tr>
                <tr style={{ backgroundColor: colors.bgMedium }}>
                  <th style={{ padding: spacing.sm, border: border.standard, textAlign: 'left' }}>
                    Age (Year)
                  </th>
                  <th style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                    Portfolio
                  </th>
                  <th style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                    Income
                  </th>
                  <th style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                    Spending
                  </th>
                  <th style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                    Taxes
                  </th>
                  <th style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                    Cash Flow
                  </th>
                </tr>
              </thead>
              <tbody>
                {years.map((year: number, index: number) => {
                  const age = userData.currentAge + index;
                  const breakdown = (view === 'median' ? medianBreakdowns : view === 'nominal' ? nominalBreakdowns : downsideBreakdowns)[index];
                  const selectedPath = view === 'median' ? median : view === 'nominal' ? nominal : downside;
                  const selectedInflation: number[] = view === 'median' ? medianInflation : view === 'nominal' ? nominalInflation : downsideInflation;

                  // Inflation factor for the selected path at this year. Drives both
                  // portfolio (real → display) and breakdown (nominal → display) conversion.
                  const pathFactor = selectedInflation[index] ?? 1;
                  const nextPathFactor = index < years.length - 1 ? (selectedInflation[index + 1] ?? pathFactor) : pathFactor;

                  const dispIncome = toDisplay(breakdown.totalGrossIncome, pathFactor, displayCurrency);
                  const dispSpending = toDisplay(breakdown.totalSpendingNet, pathFactor, displayCurrency);
                  const dispTax = toDisplay(breakdown.totalTax, pathFactor, displayCurrency);
                  // Portfolio values in display currency
                  const portfolio = pathToDisplay(selectedPath[index] ?? 0, pathFactor, displayCurrency);
                  const nextPortfolio = index < years.length - 1
                    ? pathToDisplay(selectedPath[index + 1] ?? 0, nextPathFactor, displayCurrency)
                    : null;
                  const cashFlow = nextPortfolio !== null ? nextPortfolio - portfolio : null;

                  const startingEvents = userData.incomeEvents.filter(
                    (event: any) => {
                      const ownerAge = (event.owner === 'spouse' && userData.spouseAge != null)
                        ? userData.spouseAge : userData.currentAge;
                      const startYear =
                        userData.referenceYear + (event.startAge - ownerAge);
                      return startYear === year;
                    }
                  );

                  const startingGoals = userData.spendingGoals.filter(
                    (goal: any) => {
                      const startYear =
                        userData.referenceYear +
                        (goal.startAge - userData.currentAge);
                      return startYear === year;
                    }
                  );

                  const isExpanded = expandedRows.has(index);
                  const fmt = (v: number) => v.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  });

                  const iconChip = (key: string, icon: string, color: string, bgColor: string) => (
                    <span
                      key={key}
                      style={{
                        marginRight: spacing.xs,
                        color,
                        backgroundColor: bgColor,
                        borderRadius: border.radiusCircle,
                        padding: spacing.xs,
                        fontSize: fontSize.md,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '1.5rem',
                        height: '1.5rem',
                        fontWeight: 'bold',
                      }}
                    >
                      <i className={icon} />
                    </span>
                  );

                  return (
                    <React.Fragment key={year}>
                    <tr onClick={() => toggleRow(index)} style={{ cursor: 'pointer' }}>
                      <td style={{ padding: spacing.sm, border: border.standard, whiteSpace: 'nowrap' }}>
                        <i className={isExpanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'}
                          style={{ fontSize: fontSize.xs, marginRight: spacing.xs, color: colors.textMuted }} />
                        {age} ({year})
                      </td>
                      <td style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                        {fmt(portfolio)}
                      </td>
                      <td style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                        {startingEvents.length > 0 && (
                          <div style={{ marginBottom: spacing.xs, textAlign: 'left' }}>
                            {startingEvents.map((event: any) =>
                              iconChip(event.id, (eventTypeIcons as Record<string, string>)[event.type], colors.income, colors.incomeBg)
                            )}
                          </div>
                        )}
                        {fmt(dispIncome)}
                      </td>
                      <td style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                        {startingGoals.length > 0 && (
                          <div style={{ marginBottom: spacing.xs, textAlign: 'left' }}>
                            {startingGoals.map((goal: any) =>
                              iconChip(goal.id, (goalTypeIcons as Record<string, string>)[goal.type], colors.spending, colors.spendingBg)
                            )}
                          </div>
                        )}
                        {dispSpending > 0 ? `-${fmt(dispSpending)}` : fmt(dispSpending)}
                      </td>
                      <td style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                        {dispTax > 0 ? `-${fmt(dispTax)}` : fmt(dispTax)}
                      </td>
                      <td style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                        {cashFlow !== null ? fmt(cashFlow) : '—'}
                      </td>
                    </tr>
                    {isExpanded && (() => {
                      const { stockAllocation, stockReturn, bondReturn } = userData.portfolioAssumptions;
                      const bondAllocation = 1 - stockAllocation;

                      let stockFactor: number;
                      let bondFactor: number;
                      if (view === 'nominal') {
                        stockFactor = 1 + stockReturn;
                        bondFactor = 1 + bondReturn;
                      } else if (view === 'median') {
                        stockFactor = medianStockFactors?.[index] ?? (1 + stockReturn);
                        bondFactor = medianBondFactors?.[index] ?? (1 + bondReturn);
                      } else {
                        stockFactor = downsideStockFactors?.[index] ?? (1 + stockReturn);
                        bondFactor = downsideBondFactors?.[index] ?? (1 + bondReturn);
                      }

                      // Growth computed on displayed start balance — works for both modes since
                      // `portfolio` is already in display currency.
                      const startBalance = portfolio;
                      const stockGain = startBalance * stockAllocation * (stockFactor - 1);
                      const bondGain  = startBalance * bondAllocation  * (bondFactor  - 1);
                      const netGrowth = stockGain + bondGain;

                      // Breakdown items in display currency
                      const dispSS = toDisplay(breakdown.ssGross, pathFactor, displayCurrency);
                      const dispOtherTaxable = toDisplay(breakdown.otherTaxableGross, pathFactor, displayCurrency);
                      const dispAfterTax = toDisplay(breakdown.afterTaxIncome, pathFactor, displayCurrency);
                      const dispSSTaxable = toDisplay(breakdown.ssTaxableAmount, pathFactor, displayCurrency);
                      const dispBaseSpending = toDisplay(breakdown.baseSpendingNet, pathFactor, displayCurrency);
                      const dispGoalSpending = toDisplay(breakdown.otherSpendingGoalsNet, pathFactor, displayCurrency);
                      const dispWithdrawal = toDisplay(breakdown.portfolioWithdrawal, pathFactor, displayCurrency);

                      // Inflation adjustment = residual that makes the real-mode accounting balance.
                      // In nominal mode this collapses to ~0 and is suppressed.
                      const inflationAdj = cashFlow !== null
                        ? cashFlow - netGrowth - dispIncome + dispSpending + dispTax
                        : 0;

                      const fmtPct = (f: number) => `${((f - 1) * 100).toFixed(1)}%`;
                      const fmtSigned = (v: number) => `${v >= 0 ? '+' : '-'}$${fmt(Math.abs(v))}`;

                      // Shortfall: only when portfolio cap was binding (couldn't cover spending+tax).
                      // RMD withdrawals scale with balance, so lower-balance paths legitimately
                      // withdraw less — that is NOT a shortfall.
                      const shortfall = toDisplay(breakdown.spendingShortfall, pathFactor, displayCurrency);

                      const categoryStyle = { fontWeight: 'bold' as const, display: 'flex', justifyContent: 'space-between', padding: `${spacing.xs} 0` };
                      const itemStyle = { display: 'flex', justifyContent: 'space-between', paddingLeft: '1.5rem', color: colors.textSecondary };
                      const noteStyle = { paddingLeft: '2.5rem', color: colors.textMuted, fontSize: fontSize.xs };

                      return (
                        <tr key={`${year}-detail`}>
                          <td colSpan={6} style={{
                            padding: `${spacing.xs} ${spacing.sm}`,
                            backgroundColor: colors.bgLight,
                            border: border.standard,
                            fontSize: fontSize.sm,
                          }}>
                            <div style={{ maxWidth: '32rem' }}>
                              {/* Growth */}
                              <div style={categoryStyle}>
                                <span>Growth</span>
                                <span>{fmtSigned(netGrowth)}</span>
                              </div>
                              <div style={itemStyle}>
                                <span>Stocks ({Math.round(stockAllocation * 100)}% @ {fmtPct(stockFactor)})</span>
                                <span>{fmtSigned(stockGain)}</span>
                              </div>
                              <div style={itemStyle}>
                                <span>Bonds ({Math.round(bondAllocation * 100)}% @ {fmtPct(bondFactor)})</span>
                                <span>{fmtSigned(bondGain)}</span>
                              </div>

                              {/* Income */}
                              {dispIncome > 0 && (
                                <>
                                  <div style={{ ...categoryStyle, color: colors.income }}>
                                    <span>Income</span>
                                    <span>{fmtSigned(dispIncome)}</span>
                                  </div>
                                  {dispSS > 0 && (
                                    <>
                                      <div style={itemStyle}>
                                        <span>Social Security</span>
                                        <span>${fmt(dispSS)}</span>
                                      </div>
                                      {dispSSTaxable > 0 && (
                                        <div style={noteStyle}>
                                          Taxable portion: ${fmt(dispSSTaxable)}
                                        </div>
                                      )}
                                    </>
                                  )}
                                  {dispOtherTaxable > 0 && (
                                    <div style={itemStyle}>
                                      <span>Other Taxable</span>
                                      <span>${fmt(dispOtherTaxable)}</span>
                                    </div>
                                  )}
                                  {dispAfterTax > 0 && (
                                    <div style={itemStyle}>
                                      <span>After-Tax</span>
                                      <span>${fmt(dispAfterTax)}</span>
                                    </div>
                                  )}
                                </>
                              )}

                              {/* Spending */}
                              {dispSpending > 0 && (
                                <>
                                  <div style={{ ...categoryStyle, color: colors.spending }}>
                                    <span>Spending</span>
                                    <span>-${fmt(dispSpending)}</span>
                                  </div>
                                  {dispBaseSpending > 0 && (
                                    <div style={itemStyle}>
                                      <span>Living Expenses</span>
                                      <span>${fmt(dispBaseSpending)}</span>
                                    </div>
                                  )}
                                  {dispGoalSpending > 0 && (
                                    <div style={itemStyle}>
                                      <span>Goals</span>
                                      <span>${fmt(dispGoalSpending)}</span>
                                    </div>
                                  )}
                                </>
                              )}

                              {/* Taxes */}
                              {dispTax > 0 && (() => {
                                const dispOrdinaryTax = toDisplay(breakdown.ordinaryTax, pathFactor, displayCurrency);
                                const dispCapGainsTax = toDisplay(breakdown.capitalGainsTax, pathFactor, displayCurrency);
                                return (
                                  <>
                                    <div style={categoryStyle}>
                                      <span>Taxes</span>
                                      <span>-${fmt(dispTax)}</span>
                                    </div>
                                    {dispOrdinaryTax > 0.5 && (
                                      <div style={itemStyle}>
                                        <span>Ordinary Income</span>
                                        <span>${fmt(dispOrdinaryTax)}</span>
                                      </div>
                                    )}
                                    {dispCapGainsTax > 0.5 && (
                                      <div style={itemStyle}>
                                        <span>Capital Gains</span>
                                        <span>${fmt(dispCapGainsTax)}</span>
                                      </div>
                                    )}
                                  </>
                                );
                              })()}

                              {/* Inflation Adjustment — real mode only */}
                              {displayCurrency === 'real' && Math.abs(inflationAdj) > 0.5 && (
                                <div style={categoryStyle}>
                                  <span>Inflation Adjustment</span>
                                  <span>{fmtSigned(inflationAdj)}</span>
                                </div>
                              )}

                              {/* Separator + Cash Flow total */}
                              <div style={{ borderTop: border.medium, marginTop: spacing.xs, paddingTop: spacing.xs }}>
                                <div style={{ ...categoryStyle, fontSize: fontSize.base }}>
                                  <span>Cash Flow</span>
                                  <span>{cashFlow !== null ? fmtSigned(cashFlow) : '—'}</span>
                                </div>
                              </div>

                              {/* Portfolio withdrawal breakdown */}
                              {dispWithdrawal > 0 && (
                                <>
                                <div style={{ color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'right', paddingTop: spacing.xs }}>
                                  Portfolio withdrawal: ${fmt(dispWithdrawal)}
                                </div>
                                {(() => {
                                  const dispFromTaxable = toDisplay(breakdown.withdrawalFromTaxable, pathFactor, displayCurrency);
                                  const dispFromTrad = toDisplay(breakdown.withdrawalFromTraditional, pathFactor, displayCurrency);
                                  const dispFromRoth = toDisplay(breakdown.withdrawalFromRoth, pathFactor, displayCurrency);
                                  return (
                                    <>
                                      {dispFromTaxable > 0.5 && (
                                        <div style={noteStyle}>Taxable: ${fmt(dispFromTaxable)}</div>
                                      )}
                                      {dispFromTrad > 0.5 && (
                                        <div style={noteStyle}>Traditional: ${fmt(dispFromTrad)}</div>
                                      )}
                                      {dispFromRoth > 0.5 && (
                                        <div style={noteStyle}>Roth: ${fmt(dispFromRoth)}</div>
                                      )}
                                    </>
                                  );
                                })()}
                                </>
                              )}
                              {/* RMD */}
                              {breakdown.rmdRequired > 0.5 && (() => {
                                const dispRmdRequired = toDisplay(breakdown.rmdRequired, pathFactor, displayCurrency);
                                const dispRmdExcess = toDisplay(breakdown.rmdExcess, pathFactor, displayCurrency);
                                return (
                                  <>
                                    <div style={{ color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'right', paddingTop: spacing.xs }}>
                                      RMD required: ${fmt(dispRmdRequired)}
                                    </div>
                                    {dispRmdExcess > 0.5 && (
                                      <div style={noteStyle}>Reinvested to Taxable: ${fmt(dispRmdExcess)}</div>
                                    )}
                                  </>
                                );
                              })()}
                              {/* Roth Conversion */}
                              {breakdown.rothConversionGross > 0.5 && (() => {
                                const dispConv = toDisplay(breakdown.rothConversionGross, pathFactor, displayCurrency);
                                return (
                                  <div style={{ color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'right', paddingTop: spacing.xs }}>
                                    Roth conversion: ${fmt(dispConv)} <span style={{ color: colors.textMuted }}>(Trad → Roth)</span>
                                  </div>
                                );
                              })()}
                              {shortfall > 0.5 && (
                                <div style={{ color: colors.danger, fontWeight: 'bold', textAlign: 'right', paddingTop: spacing.xs }}>
                                  Portfolio Depleted — Shortfall: ${fmt(shortfall)}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(Projections);
