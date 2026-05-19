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
import chartPercentileBandPlugin from '../../plugins/chartPercentileBand';
import {
  type AnnualCashFlowBreakdown,
} from '../../services/SimulationService';
import React, { useState, useMemo, useEffect, useRef, useContext, useCallback } from 'react';
import styled from 'styled-components';
import { Menu } from 'primereact/menu';
import { TabView, TabPanel } from 'primereact/tabview';
import YearTaxAudit from './YearTaxAudit';
import YearIncomeDetail from './YearIncomeDetail';
import CloneScenarioDialog from '../../dialogs/CloneScenarioDialog';
import { spacing, colors, border, fontSize, mediaQuery } from '../../styles/theme';
import { useUIState } from '../../context/UIStateContext';
import { RetirementContext } from '../../context/RetirementContext';
import { toDisplay, pathToDisplay, type DisplayCurrency } from '../../utils/displayCurrency';
import { formatCurrencyShort } from '../../utils/formatCurrencyShort';
import type { Account } from '../../types/Account';
import { eventTypeIcons, goalTypeIcons } from '../../utils/defaultName';
import { getProbabilityTier } from '../../utils/probabilityTier';
import { effectiveTaxRate, fmtRate } from '../../utils/effectiveTaxRate';

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
  chartCrosshairPlugin,
  chartPercentileBandPlugin
);

type ViewMode = 'median' | 'nominal' | 'downside';

const VIEW_COLORS: Record<ViewMode, string> = {
  median: colors.chartMedian,
  nominal: colors.chartNominal,
  downside: colors.chartDownside,
};

const VIEW_LABELS: Record<ViewMode, string> = {
  median: 'Median',
  nominal: 'Projected',
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
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const WhatIfButton = styled.button`
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
  &:hover { background: rgba(61, 122, 95, 0.08); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const ActionButton = styled.button<{ $variant?: 'danger' | 'primary' | 'neutral' }>`
  padding: 2px ${spacing.sm};
  font-size: ${fontSize.xs};
  font-family: inherit;
  font-weight: 500;
  border: 1px solid ${props =>
    props.$variant === 'danger' ? colors.danger
      : props.$variant === 'primary' ? colors.primary
      : colors.border};
  background: transparent;
  color: ${props =>
    props.$variant === 'danger' ? colors.danger
      : props.$variant === 'primary' ? colors.primary
      : colors.textPrimary};
  border-radius: ${border.radiusRound};
  cursor: pointer;
  &:hover { background: ${colors.bgHover}; }
`;

const BandToggle = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  height: 1.65rem;
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
  height: 1.65rem;
  padding: 0 ${spacing.sm};
  font-size: ${fontSize.xs};
  font-family: inherit;
  line-height: 1;
  background: ${props => props.$active ? colors.primary : colors.bgMedium};
  color: ${props => props.$active ? '#fff' : colors.textPrimary};
  border: ${border.standard};
  border-radius: ${border.radius};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  & > i { font-size: ${fontSize.xs}; }
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
  band: { p10: number[]; p90: number[] } | null,
) {
  const modeLabel = displayCurrency === 'real' ? "today's dollars" : 'nominal dollars';
  const timestamp = new Date().toISOString();
  const comment = `# scenario: ${scenarioName} | exported: ${timestamp} | values in ${modeLabel}`;
  const pathHeaders: string[] = [];
  if (!options.nominalHidden) pathHeaders.push('Projected Portfolio ($)');
  if (!options.medianDownsideHidden) pathHeaders.push('Median Portfolio ($)', 'Downside Portfolio ($)');
  if (band) pathHeaders.push('Band p10 ($)', 'Band p90 ($)');
  // Scalar audit columns are appended after the core columns. Per-event tax
  // attribution and per-account flows are NOT exported — they don't fit a flat
  // one-row-per-year CSV cleanly. See the Income Detail tab in the app for those.
  const header = [
    'Age', 'Year',
    ...pathHeaders,
    'SS Gross', 'Other Taxable Income', 'After-Tax Income', 'Total Gross Income',
    'Base Spending', 'Goal Spending', 'Total Spending',
    'Total Tax', 'Ordinary Income Tax', 'Federal LTCG Tax', 'State LTCG Tax', 'NIIT (3.8%)', 'IRMAA Surcharge', 'Portfolio Withdrawal',
    'Withdrawal — Taxable', 'Withdrawal — Traditional', 'Withdrawal — Roth',
    'RMD Required', 'RMD Reinvested',
    'Roth Conversion',
    'Surplus Contribution',
    'Net Cash Flow',
    // ---- audit columns ----
    'AGI', 'Standard Deduction', 'Senior Add-On', 'OBBB Reduction', 'Total Deductions', 'Taxable Income',
    'Federal Bracket Index', 'Federal Marginal Rate', 'Federal Ordinary Tax', 'State Ordinary Tax', 'Effective State',
    'SS Provisional Income', 'SS Zone',
    'IRMAA Lookback MAGI', 'IRMAA Tier', 'IRMAA Per-Enrollee Annual', 'IRMAA Enrollees',
    'NIIT MAGI', 'NIIT Threshold', 'NIIT MAGI Excess', 'NIIT Taxable Base',
    'RMD Self', 'RMD Spouse', 'RMD Divisor Self', 'RMD Divisor Spouse', 'BoY Trad Bal Self', 'BoY Trad Bal Spouse',
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
    if (band) {
      // Band values displayed using the deterministic inflation deflator —
      // matches the chart's band rendering.
      pathCells.push(Math.round(pathToDisplay(band.p10[i] ?? 0, nominalInflation[i] ?? 1, displayCurrency)));
      pathCells.push(Math.round(pathToDisplay(band.p90[i] ?? 0, nominalInflation[i] ?? 1, displayCurrency)));
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
      Math.round(toDisplay(bd.federalCapGainsTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.stateCapGainsTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.niitTax, bdF, displayCurrency)),
      Math.round(toDisplay(bd.irmaaSurcharge, bdF, displayCurrency)),
      Math.round(toDisplay(bd.portfolioWithdrawal, bdF, displayCurrency)),
      Math.round(toDisplay(bd.withdrawalFromTaxable, bdF, displayCurrency)),
      Math.round(toDisplay(bd.withdrawalFromTraditional, bdF, displayCurrency)),
      Math.round(toDisplay(bd.withdrawalFromRoth, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rmdRequired, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rmdExcess, bdF, displayCurrency)),
      Math.round(toDisplay(bd.rothConversionGross, bdF, displayCurrency)),
      Math.round(toDisplay(bd.surplusContribution, bdF, displayCurrency)),
      Math.round(toDisplay(bd.netCashFlow, bdF, displayCurrency)),
      // ---- audit columns ----
      Math.round(toDisplay(bd.audit?.agi ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.standardDeduction ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.seniorAddOn ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.obbbReduction ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.totalDeductions ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.taxableIncome ?? 0, bdF, displayCurrency)),
      bd.audit?.federalBracketIndex ?? 0,
      ((bd.audit?.federalMarginalRate ?? 0) * 100).toFixed(2) + '%',
      Math.round(toDisplay(bd.audit?.federalOrdinaryTax ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.stateOrdinaryTax ?? 0, bdF, displayCurrency)),
      // Quote the state name in case it contains a comma (e.g., "Washington, DC").
      `"${(bd.audit?.effectiveStateName ?? '').replace(/"/g, '""')}"`,
      Math.round(toDisplay(bd.audit?.ssProvisionalIncome ?? 0, bdF, displayCurrency)),
      bd.audit?.ssZone ?? 'none',
      Math.round(toDisplay(bd.audit?.irmaaLookbackMagi ?? 0, bdF, displayCurrency)),
      bd.audit?.irmaaTierIndex ?? 0,
      Math.round(toDisplay(bd.audit?.irmaaPerEnrolleeAnnual ?? 0, bdF, displayCurrency)),
      bd.audit?.irmaaEnrolleeCount ?? 0,
      Math.round(toDisplay(bd.audit?.niitMagi ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.niitThreshold ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.niitMagiExcess ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.niitTaxableBase ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.rmdSelf ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.rmdSpouse ?? 0, bdF, displayCurrency)),
      (bd.audit?.rmdDivisorSelf ?? 0).toFixed(1),
      (bd.audit?.rmdDivisorSpouse ?? 0).toFixed(1),
      Math.round(toDisplay(bd.audit?.rmdBoyBalanceSelf ?? 0, bdF, displayCurrency)),
      Math.round(toDisplay(bd.audit?.rmdBoyBalanceSpouse ?? 0, bdF, displayCurrency)),
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
  whatIfActive,
  whatIfSnapshot,
  whatIfSnapshotResults,
  compareDisabled,
  onEnterWhatIf,
  onDiscardWhatIf,
  onSaveWhatIf,
  onSaveWhatIfAsNew,
}: {
  results: any;
  userData: any;
  isCalculating?: boolean;
  compareResults?: any;
  compareScenario?: any;
  isCompareCalculating?: boolean;
  onSetCompare: (id: string | null) => void;
  onRegisterExport?: (fn: (() => void) | null) => void;
  whatIfActive?: boolean;
  whatIfSnapshot?: any;
  whatIfSnapshotResults?: any;
  compareDisabled?: boolean;
  onEnterWhatIf?: () => void;
  onDiscardWhatIf?: () => void;
  onSaveWhatIf?: () => void;
  onSaveWhatIfAsNew?: (name: string) => void;
}) => {
  const [cloneDialogVisible, setCloneDialogVisible] = useState(false);
  if (!results) return null;
  const {
    probability, median, downside, nominal, nominalBreakdowns, years,
    medianStockFactors, medianBondFactors, medianBreakdowns,
    downsideStockFactors, downsideBondFactors, downsideBreakdowns,
    medianInflation, downsideInflation, nominalInflation,
    percentileBand, mcStats,
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
  // Session-only toggle: shaded 10th–90th percentile band on the chart.
  // Defaults on. Not on UserData — this is a view preference, not a modeling knob.
  const [showBand, setShowBand] = useState(true);

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

  // The chart's primary line is the deterministic projection when available,
  // falling back to the median path in modes that don't compute a deterministic
  // baseline (historical_rolling, historical_bootstrap). Independent of `view`,
  // which now drives the data table only.
  const chartPrimaryMode: ViewMode = nominalHidden ? 'median' : 'nominal';
  const chartPrimaryPath: number[] = chartPrimaryMode === 'median' ? median : nominal;
  const chartPrimaryInflation: number[] = chartPrimaryMode === 'median' ? medianInflation : nominalInflation;
  const bandActive = showBand && !!percentileBand && !whatIfActive;

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
      percentileBand,
    );
  }, [view, userData, years, nominal, median, downside, medianInflation, nominalInflation, downsideInflation, medianBreakdowns, nominalBreakdowns, downsideBreakdowns, displayCurrency, nominalHidden, medianDownsideHidden, percentileBand]);

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
    // Only called for the compare overlay (dashed). Solid datasets are pushed
    // inline below. Border width is constant — it used to track `view`, but
    // `view` no longer drives the chart, so coupling line thickness to the
    // data-table selector would be surprising.
    const makeDataset = (label: string, mode: ViewMode, data: number[], dashed = false, dashColor?: string) => {
      const color = dashed
        ? (dashColor ?? VIEW_COLORS[mode] + '80')
        : VIEW_COLORS[mode];
      return {
        label,
        data,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        borderDash: dashed ? [6, 3] : [],
        pointRadius: 0,
      };
    };
    const datasets: ReturnType<typeof makeDataset>[] = [];

    // In What If mode: snapshot vs draft, both rendered as the chart's primary
    // line (Deterministic when available, else Median). Locking to the primary
    // mode keeps the comparison reproducible — Deterministic projections coincide
    // at entry when no edits have been made, instead of diverging from RNG noise.
    if (whatIfActive && whatIfSnapshotResults) {
      const snap = whatIfSnapshotResults;
      const sPath = chartPrimaryMode === 'nominal' ? snap.nominal : snap.median;
      const sInf  = chartPrimaryMode === 'nominal' ? snap.nominalInflation : snap.medianInflation;
      const aPath = chartPrimaryPath;
      const aInf  = chartPrimaryInflation;
      datasets.push({
        label: 'Original',
        data: toDisplayPath(sPath, sInf),
        borderColor: colors.textMuted,
        backgroundColor: colors.textMuted,
        borderWidth: 2,
        borderDash: [],
        pointRadius: 0,
      });
      datasets.push({
        label: 'Draft',
        data: toDisplayPath(aPath, aInf),
        borderColor: colors.draftOverlay,
        backgroundColor: colors.draftOverlay,
        borderWidth: 2,
        borderDash: [6, 3],
        pointRadius: 0,
      });
    } else {
      // Chart shows only the primary line (Deterministic when available, else Median).
      // The shaded 10–90 band rendered by chartPercentileBandPlugin replaces the
      // separate Median and Downside lines. The data table still exposes all three
      // views via its own selector.
      datasets.push({
        label: VIEW_LABELS[chartPrimaryMode],
        data: toDisplayPath(chartPrimaryPath, chartPrimaryInflation),
        borderColor: VIEW_COLORS[chartPrimaryMode],
        backgroundColor: VIEW_COLORS[chartPrimaryMode],
        borderWidth: 3,
        borderDash: [],
        pointRadius: 0,
      });
      if (compareResults && compareScenario) {
        const cPath = chartPrimaryMode === 'nominal' ? compareResults.nominal : compareResults.median;
        const cInf = chartPrimaryMode === 'nominal' ? compareResults.nominalInflation : compareResults.medianInflation;
        if (cPath && cInf) {
          datasets.push(makeDataset(compareScenario.name, chartPrimaryMode, toDisplayPath(cPath, cInf), true));
        }
      }
    }
    return { labels, datasets };
  }, [labels, median, nominal, downside, medianInflation, nominalInflation, downsideInflation, displayCurrency, nominalHidden, medianDownsideHidden, compareResults, compareScenario, whatIfActive, whatIfSnapshotResults, chartPrimaryMode, chartPrimaryPath, chartPrimaryInflation]);

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
      percentileBand: {
        // Deflate using the deterministic inflation series so band edges live in
        // the same display-currency space as the primary line.
        p10: bandActive && percentileBand
          ? percentileBand.p10.map((v: number, i: number) => pathToDisplay(v, nominalInflation[i] ?? 1, displayCurrency))
          : [],
        p90: bandActive && percentileBand
          ? percentileBand.p90.map((v: number, i: number) => pathToDisplay(v, nominalInflation[i] ?? 1, displayCurrency))
          : [],
        enabled: bandActive,
        color: colors.chartBand,
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
  }), [isMobile, htmlAnnotations, userData.portfolioAssumptions?.blackSwanEvents, years, hoveredIndex, bandActive, percentileBand, nominalInflation, displayCurrency]);


  const snapshotProb = whatIfSnapshotResults?.probability;
  const whatIfLoading = whatIfActive && !whatIfSnapshotResults;

  return (
    <div>
      {whatIfActive && whatIfSnapshot && (
        <CloneScenarioDialog
          visible={cloneDialogVisible}
          sourceName={whatIfSnapshot.name}
          defaultName={`What If - ${whatIfSnapshot.name}`}
          onHide={() => setCloneDialogVisible(false)}
          onSave={(name) => onSaveWhatIfAsNew?.(name)}
        />
      )}
      <ChartHeading>
        {whatIfActive ? (
          <>
            <span>What If: {userData.name}</span>
            <span style={{ color: colors.textMuted, fontWeight: 400, fontSize: fontSize.sm }}>Original:</span>
            <span>{snapshotProb != null ? `${snapshotProb}%` : '—'}</span>
            {snapshotProb != null && (() => {
              const tierInfo = getProbabilityTier(snapshotProb);
              return (
                <>
                  <PrimeTooltip target=".chance-tier-badge-snapshot" position="bottom" showDelay={150}>
                    <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>{tierInfo.tooltip}</div>
                  </PrimeTooltip>
                  <TierBadge
                    className="chance-tier-badge-snapshot"
                    $color={tierInfo.color}
                    $bg={tierInfo.backgroundColor}
                    aria-label={`Original tier: ${tierInfo.label}`}
                  >
                    {tierInfo.label}
                  </TierBadge>
                </>
              );
            })()}
            <span style={{ color: colors.textMuted, fontWeight: 400, fontSize: fontSize.sm }}>|</span>
            <span style={{ color: colors.draftOverlay }}>Draft:</span>
            <span style={{ color: colors.draftOverlay }}>{isCalculating ? '—' : `${probability}%`}</span>
            {!isCalculating && (() => {
              const tierInfo = getProbabilityTier(probability);
              return (
                <>
                  <PrimeTooltip target=".chance-tier-badge-draft" position="bottom" showDelay={150}>
                    <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>{tierInfo.tooltip}</div>
                  </PrimeTooltip>
                  <TierBadge
                    className="chance-tier-badge-draft"
                    $color={tierInfo.color}
                    $bg={tierInfo.backgroundColor}
                    aria-label={`Draft tier: ${tierInfo.label}`}
                  >
                    {tierInfo.label}
                  </TierBadge>
                </>
              );
            })()}
            {whatIfLoading && <UpdatingBadge style={{ marginLeft: spacing.md }}><i className="pi pi-spin pi-spinner" style={{ marginRight: spacing.xs, fontSize: '0.7rem' }} />Setting up What If…</UpdatingBadge>}
            {!whatIfLoading && isCalculating && <UpdatingBadge style={{ marginLeft: spacing.md }}>Updating draft…</UpdatingBadge>}
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: spacing.xs }}>
              <PrimeTooltip target=".whatif-discard-btn" position="bottom" showDelay={150}>
                <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>Restore the scenario to its original state</div>
              </PrimeTooltip>
              <PrimeTooltip target=".whatif-save-btn" position="bottom" showDelay={150}>
                <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>Keep your changes — they are already saved</div>
              </PrimeTooltip>
              <PrimeTooltip target=".whatif-clone-btn" position="bottom" showDelay={150}>
                <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>Create a new scenario from your experiment and restore the original</div>
              </PrimeTooltip>
              <ActionButton className="whatif-discard-btn" $variant="danger" onClick={() => onDiscardWhatIf?.()}>Discard</ActionButton>
              <ActionButton className="whatif-save-btn" onClick={() => onSaveWhatIf?.()}>Save</ActionButton>
              <ActionButton className="whatif-clone-btn" $variant="primary" onClick={() => setCloneDialogVisible(true)}>Save as New</ActionButton>
            </span>
          </>
        ) : compareScenario ? (
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
            <span className="chance-tier-badge" style={{ cursor: 'help' }}>Chance of Success: {isCalculating ? '—' : `${probability}%`}</span>
            {!isCalculating && (() => {
              const tierInfo = getProbabilityTier(probability);
              const lastIdx = years.length - 1;
              const defl = nominalInflation[lastIdx] ?? 1;
              const dispEnd = (v: number) => pathToDisplay(v, defl, displayCurrency);
              const fmtAge = (age: number | null) => age == null ? 'never' : `age ${age}`;
              const fmtMoney = (v: number) => formatCurrencyShort(v, 'compact');
              // Tooltip text colors: default PrimeReact tooltip has a dark background,
              // so we use light grays here (not the dark theme.colors.textPrimary).
              const tipLabel = 'rgba(255,255,255,0.7)';
              const tipValue = 'rgba(255,255,255,0.95)';
              const tipSep = 'rgba(255,255,255,0.2)';
              return (
                <>
                  <PrimeTooltip target=".chance-tier-badge" position="bottom" showDelay={150}>
                    <div style={{ maxWidth: '22rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                      <div style={{ marginBottom: spacing.xs }}>{tierInfo.tooltip}</div>
                      {mcStats && (
                        <>
                          <div style={{ borderTop: `1px solid ${tipSep}`, margin: `${spacing.xs} 0` }} />
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'auto auto',
                            columnGap: spacing.md,
                            rowGap: '2px',
                          }}>
                            <span style={{ color: tipLabel }}>Median ending balance</span>
                            <span style={{ color: tipValue, fontWeight: 500, textAlign: 'right' }}>{fmtMoney(dispEnd(mcStats.medianEndingBalance))}</span>
                            <span style={{ color: tipLabel }}>10th-pctile ending</span>
                            <span style={{ color: tipValue, fontWeight: 500, textAlign: 'right' }}>{fmtMoney(dispEnd(mcStats.p10EndingBalance))}</span>
                            <span style={{ color: tipLabel }}>Median depletion</span>
                            <span style={{ color: tipValue, fontWeight: 500, textAlign: 'right' }}>{fmtAge(mcStats.medianDepletionAge)}</span>
                            <span style={{ color: tipLabel }}>Worst-decile depletion</span>
                            <span style={{ color: tipValue, fontWeight: 500, textAlign: 'right' }}>{fmtAge(mcStats.worstDecileDepletionAge)}</span>
                          </div>
                        </>
                      )}
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
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: spacing.xs }}>
              {onEnterWhatIf && (
                <>
                  <PrimeTooltip target=".whatif-button" position="bottom" showDelay={150}>
                    <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                      {compareScenario
                        ? 'End comparison first, then you can enter What If mode.'
                        : 'Try changes to this scenario without committing. The original stays untouched as a reference line; your edits appear as a dashed draft line. Discard to revert, Save to keep, or Save as New to spin off a copy.'}
                    </div>
                  </PrimeTooltip>
                  <WhatIfButton
                    className="whatif-button"
                    onClick={() => onEnterWhatIf()}
                    disabled={!!compareScenario}
                  >
                    <i className="pi pi-flask" style={{ fontSize: '0.7rem' }} /> What If?
                  </WhatIfButton>
                </>
              )}
              {compareMenuItems.length > 0 && (
                <>
                  <Menu ref={compareMenuRef} model={compareMenuItems} popup />
                  <PrimeTooltip target=".compare-with-button" position="bottom" showDelay={150}>
                    <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                      {compareDisabled
                        ? 'End What If mode first, then you can compare this scenario against another.'
                        : 'Pick another scenario to overlay on the chart — compare projected paths, success probabilities, and yearly cash flow side by side. Useful for "is plan A better than plan B?"'}
                    </div>
                  </PrimeTooltip>
                  <CompareWithButton
                    className="compare-with-button"
                    onClick={(e) => compareMenuRef.current?.toggle(e)}
                    disabled={!!compareDisabled}
                  >
                    Compare with <i className="pi pi-chevron-down" style={{ fontSize: '0.6rem' }} />
                  </CompareWithButton>
                </>
              )}
            </span>
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
              <strong>Future Dollars</strong>: Raw future dollar amounts with no inflation adjustment.
            </div>
          </div>
        </PrimeTooltip>
        <CurrencyPillGroup className="currency-pill-group">
          <CurrencyPillButton $active={displayCurrency === 'real'} onClick={() => setDisplayCurrency('real')}>Today's $</CurrencyPillButton>
          <CurrencyPillButton $active={displayCurrency === 'nominal'} onClick={() => setDisplayCurrency('nominal')}>Future $</CurrencyPillButton>
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

          const medVal = pathToDisplay(median[hoveredIndex] ?? 0, getF(medianInflation), displayCurrency);

          // For the hover popup, all values reflect the chart's primary line
          // (Deterministic when available, else Median) — not the view selector,
          // which only drives the data table.
          const primaryBd = (chartPrimaryMode === 'nominal' ? nominalBreakdowns : medianBreakdowns)[hoveredIndex];
          const primaryF = getF(chartPrimaryInflation);
          const primaryNet = toDisplay(primaryBd.netCashFlow, primaryF, displayCurrency);
          const primaryShortfall = toDisplay(primaryBd.spendingShortfall ?? 0, primaryF, displayCurrency);
          const primaryVal = pathToDisplay(chartPrimaryPath[hoveredIndex] ?? 0, primaryF, displayCurrency);
          const bandLow = percentileBand
            ? pathToDisplay(percentileBand.p10[hoveredIndex] ?? 0, getF(nominalInflation), displayCurrency)
            : null;
          const bandHigh = percentileBand
            ? pathToDisplay(percentileBand.p90[hoveredIndex] ?? 0, getF(nominalInflation), displayCurrency)
            : null;

          // Side-by-side tooltip data — sourced from compare scenario in compare
          // mode, or from the What If snapshot in What If mode. Both overlays
          // render the chart's primary line (Deterministic when available),
          // so the popup matches.
          const overlaySource = whatIfActive && whatIfSnapshotResults
            ? whatIfSnapshotResults
            : compareResults;
          const cPath = overlaySource
            ? (chartPrimaryMode === 'nominal' ? overlaySource.nominal : overlaySource.median)
            : null;
          const cInfArr = overlaySource
            ? (chartPrimaryMode === 'nominal' ? overlaySource.nominalInflation : overlaySource.medianInflation)
            : null;
          const cBds = overlaySource
            ? (chartPrimaryMode === 'nominal' ? overlaySource.nominalBreakdowns : overlaySource.medianBreakdowns)
            : null;
          const cVal = cPath && cInfArr ? pathToDisplay(cPath[hoveredIndex] ?? 0, cInfArr[hoveredIndex] ?? 1, displayCurrency) : null;
          const cBd = cBds?.[hoveredIndex] ?? null;
          const cBdF = cInfArr?.[hoveredIndex] ?? 1;

          const isComparing = (compareResults != null && compareScenario != null) || (whatIfActive && whatIfSnapshotResults != null);
          const primaryLabel = whatIfActive ? 'Draft' : userData.name;
          const overlayLabel = whatIfActive ? 'Original' : compareScenario?.name;

          const fmtM = (v: number) =>
            formatCurrencyShort(v, isComparing ? 'precise' : 'compact');

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
              minWidth: isComparing ? '16rem' : '11rem',
              lineHeight: '1.5',
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: spacing.xs, color: colors.textPrimary, fontSize: fontSize.sm }}>
                Age {age} · {year}
              </div>
              {isComparing ? (
                <>
                  <div style={{ display: 'flex', gap: spacing.sm, marginBottom: '2px' }}>
                    <span style={{ flex: 1, fontWeight: 'bold', color: whatIfActive ? colors.draftOverlay : VIEW_COLORS[chartPrimaryMode] }}>{primaryLabel}</span>
                    <span style={{ flex: 1, fontWeight: 'bold', color: whatIfActive ? colors.textMuted : VIEW_COLORS[chartPrimaryMode] + '99' }}>{overlayLabel}</span>
                  </div>
                  <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.xs }}>
                    <div style={{ flex: 1, color: colors.textPrimary }}>
                      {fmtM(primaryVal)}
                    </div>
                    <div style={{ flex: 1, color: colors.textPrimary, opacity: 0.75 }}>
                      {cVal !== null ? fmtM(cVal) : '—'}
                    </div>
                  </div>
                  <div style={{ borderTop: border.light, margin: `${spacing.xs} 0` }} />
                  {(['totalGrossIncome', 'totalSpendingNet', 'totalTax'] as const).map((field, i) => {
                    const labels = ['Inc', 'Spend', 'Tax'];
                    const labelColors = [colors.income, colors.spending, colors.textSecondary];
                    return (
                      <div key={field} style={{ display: 'flex', gap: spacing.sm, color: colors.textSecondary }}>
                        <span style={{ color: labelColors[i], minWidth: '2.8rem' }}>{labels[i]}</span>
                        <span style={{ flex: 1 }}>{fmtM(toDisplay(primaryBd[field], primaryF, displayCurrency))}</span>
                        <span style={{ flex: 1, opacity: 0.75 }}>
                          {cBd ? fmtM(toDisplay(cBd[field], cBdF, displayCurrency)) : '—'}
                        </span>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: spacing.sm, marginTop: '1px' }}>
                    <span style={{ color: colors.textSecondary, minWidth: '2.8rem' }}>Net</span>
                    <span style={{ flex: 1, color: primaryNet >= 0 ? colors.income : colors.danger, fontWeight: 'bold' }}>
                      {primaryNet >= 0 ? '+' : '−'}{fmtM(Math.abs(primaryNet))}
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
                  {primaryShortfall > 0.5 && (
                    <div style={{ color: colors.danger, marginTop: spacing.xs, fontWeight: 'bold' }}>
                      Portfolio Depleted
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Primary line value (Deterministic when available, else Median) */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                    fontWeight: 'bold', marginBottom: '1px',
                  }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      backgroundColor: VIEW_COLORS[chartPrimaryMode],
                      flexShrink: 0, display: 'inline-block',
                    }} />
                    <span style={{ width: '5rem', color: colors.textPrimary }}>{VIEW_LABELS[chartPrimaryMode]}</span>
                    <span style={{ flex: 1, textAlign: 'right', color: colors.textPrimary }}>{fmtM(primaryVal)}</span>
                  </div>
                  {/* 10–90 band range from Monte Carlo */}
                  {bandLow !== null && bandHigh !== null && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '0.3rem',
                      opacity: 0.7, marginBottom: '1px',
                    }}>
                      <span style={{
                        width: 14, height: 6,
                        backgroundColor: colors.chartBand,
                        border: `1px solid ${colors.borderMedium}`,
                        flexShrink: 0, display: 'inline-block',
                      }} />
                      <span style={{ width: '4.4rem', color: colors.textSecondary, fontSize: fontSize.xs }}>Likely</span>
                      <span style={{ flex: 1, textAlign: 'right', color: colors.textSecondary }}>
                        {fmtM(bandLow)} – {fmtM(bandHigh)}
                      </span>
                    </div>
                  )}
                  {/* Median path value, subdued — only useful when it differs from the primary (i.e. not in nominalHidden mode where median IS the primary) */}
                  {chartPrimaryMode !== 'median' && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '0.3rem',
                      opacity: 0.55, marginBottom: '1px',
                    }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%',
                        backgroundColor: VIEW_COLORS.median,
                        flexShrink: 0, display: 'inline-block',
                      }} />
                      <span style={{ width: '5rem', color: colors.textPrimary }}>{VIEW_LABELS.median}</span>
                      <span style={{ flex: 1, textAlign: 'right', color: colors.textPrimary }}>{fmtM(medVal)}</span>
                    </div>
                  )}
                  <div style={{ borderTop: border.light, margin: `${spacing.xs} 0` }} />
                  <div style={{ color: VIEW_COLORS[chartPrimaryMode], fontWeight: 'bold', marginBottom: '2px' }}>
                    {VIEW_LABELS[chartPrimaryMode]}
                  </div>
                  <div style={{ display: 'flex', gap: spacing.sm, color: colors.textSecondary, flexWrap: 'wrap' }}>
                    <span><span style={{ color: colors.income }}>Inc</span> {fmtM(toDisplay(primaryBd.totalGrossIncome, primaryF, displayCurrency))}</span>
                    <span><span style={{ color: colors.spending }}>Spend</span> {fmtM(toDisplay(primaryBd.totalSpendingNet, primaryF, displayCurrency))}</span>
                    <span>
                      {primaryBd.irmaaSurcharge > 0.5 ? 'Tax+IRMAA' : 'Tax'} {fmtM(toDisplay(primaryBd.totalTax, primaryF, displayCurrency))}
                      {(() => {
                        const rate = effectiveTaxRate(primaryBd);
                        if (rate === null) return '';
                        return primaryBd.irmaaSurcharge > 0.5
                          ? ` (income tax ${fmtRate(rate)})`
                          : ` (${fmtRate(rate)})`;
                      })()}
                    </span>
                  </div>
                  <div style={{ marginTop: '1px', color: colors.textSecondary }}>
                    Net <span style={{ color: primaryNet >= 0 ? colors.income : colors.danger, fontWeight: 'bold' }}>
                      {primaryNet >= 0 ? '+' : '−'}{fmtM(Math.abs(primaryNet))}
                    </span>
                  </div>
                  {primaryShortfall > 0.5 && (
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
        {whatIfActive ? (
          // What If chart is locked to the primary line (Deterministic when
          // available, else Median). Show static swatches for Original (gray
          // solid) and Draft (dashed amber-ish) so the user knows which is which.
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.xs, fontSize: fontSize.sm, color: colors.textSecondary, padding: `2px ${spacing.sm}` }}>
              <LegendSwatch $color={colors.textMuted} />
              Original ({VIEW_LABELS[chartPrimaryMode]})
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.xs, fontSize: fontSize.sm, color: colors.textSecondary, padding: `2px ${spacing.sm}` }}>
              <LegendSwatch $color={colors.draftOverlay} $dashed />
              Draft ({VIEW_LABELS[chartPrimaryMode]})
            </span>
          </>
        ) : (
          <>
            <PrimeTooltip target=".projected-label" position="bottom" showDelay={150}>
              <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                {chartPrimaryMode === 'nominal'
                  ? 'A single projection using your average return assumptions, with no market randomness. The expected path.'
                  : 'The middle outcome across all Monte Carlo runs (the historical mode in use has no deterministic baseline).'}
              </div>
            </PrimeTooltip>
            <span
              className="projected-label"
              style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.xs, fontSize: fontSize.sm, color: colors.textSecondary, padding: `2px ${spacing.sm}`, cursor: 'help' }}
            >
              <LegendSwatch $color={VIEW_COLORS[chartPrimaryMode]} />
              {VIEW_LABELS[chartPrimaryMode]}
            </span>
            {bandActive && (
              <>
                <PrimeTooltip target=".likely-range-label" position="bottom" showDelay={150}>
                  <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                    The shaded region covers the 10th–90th percentile of simulated futures — 80% of Monte Carlo runs land inside this band each year.
                  </div>
                </PrimeTooltip>
                <span
                  className="likely-range-label"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.xs, fontSize: fontSize.sm, color: colors.textSecondary, padding: `2px ${spacing.sm}`, cursor: 'help' }}
                >
                  <span style={{
                    display: 'inline-block', width: 18, height: 8,
                    background: colors.chartBand,
                    border: `1px solid ${colors.borderMedium}`,
                  }} />
                  Likely range
                </span>
              </>
            )}
          </>
        )}
        {compareScenario && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.xs, fontSize: fontSize.sm, color: colors.textSecondary, padding: `2px ${spacing.sm}` }}>
            <LegendSwatch $color={VIEW_COLORS[chartPrimaryMode] + '80'} $dashed />
            {compareScenario.name}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: spacing.md }}>
          {percentileBand && !whatIfActive && (
            <>
              <PrimeTooltip target=".band-toggle-btn" position="bottom" showDelay={150}>
                <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                  {showBand
                    ? 'Hide the shaded Likely range band on the chart.'
                    : 'Show the shaded Likely range band — the 10th–90th percentile of simulated futures.'}
                </div>
              </PrimeTooltip>
              <BandToggle
                className="band-toggle-btn"
                $active={showBand}
                onClick={() => setShowBand(b => !b)}
              >
                <span style={{
                  display: 'inline-block', width: 14, height: 8,
                  background: colors.chartBand,
                  border: `1px solid ${colors.borderMedium}`,
                }} />
                {showBand ? 'Hide band' : 'Show band'}
              </BandToggle>
            </>
          )}
          <PrimeTooltip target=".data-toggle-btn" position="bottom" showDelay={150}>
            <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
              {showData
                ? 'Hide the year-by-year data table.'
                : 'Show the year-by-year data table — balance, income, spending, taxes, and withdrawals for each year. Switch between Median / Projected / Downside views and export to CSV.'}
            </div>
          </PrimeTooltip>
          <DataToggle
            className="data-toggle-btn"
            $active={showData}
            onClick={() => setShowData(d => !d)}
          >
            <i className="pi pi-table" />
            Data
          </DataToggle>
        </span>
      </LegendRow>
      {showData && (
        <div style={{ marginTop: spacing.xs }}>
          {visibleViewModes.length > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: spacing.xs,
              padding: `${spacing.xs} 0`, fontSize: fontSize.xs, color: colors.textSecondary,
            }}>
              <span style={{ marginRight: spacing.xs }}>Table view:</span>
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
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <td colSpan={6} style={{ padding: `${spacing.xs} ${spacing.sm} 0`, fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'right', border: 'none' }}>
                    All values in {displayCurrency === 'real' ? "today's" : 'future'} dollars
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
                      const { stockReturn, bondReturn } = userData.portfolioAssumptions;
                      const accounts = userData.accounts as Account[];
                      const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
                      const stockAllocation = totalBalance > 0
                        ? accounts.reduce((s, a) => s + a.stockAllocation * a.balance, 0) / totalBalance
                        : (accounts[0]?.stockAllocation ?? 0.6);
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
                            <TabView
                              panelContainerStyle={{ padding: spacing.sm, background: 'transparent' }}
                            >
                              <TabPanel header="Summary">
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
                                const dispCapGainsTax = toDisplay(
                                  breakdown.federalCapGainsTax + breakdown.stateCapGainsTax,
                                  pathFactor,
                                  displayCurrency,
                                );
                                const dispNiit = toDisplay(breakdown.niitTax, pathFactor, displayCurrency);
                                const dispIrmaa = toDisplay(breakdown.irmaaSurcharge, pathFactor, displayCurrency);
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
                                        <span>Capital Gains (fed+state)</span>
                                        <span>${fmt(dispCapGainsTax)}</span>
                                      </div>
                                    )}
                                    {dispNiit > 0.5 && (
                                      <div style={itemStyle}>
                                        <span>NIIT (3.8%)</span>
                                        <span>${fmt(dispNiit)}</span>
                                      </div>
                                    )}
                                    {dispIrmaa > 0.5 && (
                                      <div style={itemStyle}>
                                        <span>Medicare IRMAA</span>
                                        <span>${fmt(dispIrmaa)}</span>
                                      </div>
                                    )}
                                    {(() => {
                                      const rate = effectiveTaxRate(breakdown);
                                      if (rate === null) return null;
                                      const label = breakdown.irmaaSurcharge > 0.5
                                        ? 'Effective Tax Rate (excl. IRMAA)'
                                        : 'Effective Rate';
                                      return (
                                        <div style={itemStyle}>
                                          <span>{label}</span>
                                          <span>{fmtRate(rate)}</span>
                                        </div>
                                      );
                                    })()}
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
                              {/* Surplus contribution */}
                              {breakdown.surplusContribution > 0.5 && (() => {
                                const dispSurplus = toDisplay(breakdown.surplusContribution, pathFactor, displayCurrency);
                                return (
                                  <div style={{ color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'right', paddingTop: spacing.xs }}>
                                    Surplus reinvested to Taxable: ${fmt(dispSurplus)}
                                  </div>
                                );
                              })()}
                              {shortfall > 0.5 && (
                                <div style={{ color: colors.danger, fontWeight: 'bold', textAlign: 'right', paddingTop: spacing.xs }}>
                                  Portfolio Depleted — Shortfall: ${fmt(shortfall)}
                                </div>
                              )}
                            </div>
                              </TabPanel>
                              <TabPanel header="Tax Audit">
                                <YearTaxAudit
                                  breakdown={breakdown}
                                  pathFactor={pathFactor}
                                  displayCurrency={displayCurrency}
                                  year={year}
                                />
                              </TabPanel>
                              <TabPanel header="Income Detail">
                                <YearIncomeDetail
                                  breakdown={breakdown}
                                  pathFactor={pathFactor}
                                  displayCurrency={displayCurrency}
                                />
                              </TabPanel>
                            </TabView>
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
