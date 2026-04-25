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
import { Accordion, AccordionTab } from 'primereact/accordion';
import { Tooltip as PrimeTooltip } from 'primereact/tooltip';
import htmlAnnotationsPlugin, {
  type AnnotationConfig,
} from '../../plugins/chartHtmlAnnotations';
import chartBlackSwanShadingPlugin from '../../plugins/chartBlackSwanShading';
import {
  type AnnualCashFlowBreakdown,
} from '../../services/SimulationService';
import React, { useState, useMemo, useEffect } from 'react';
import styled from 'styled-components';
import { spacing, colors, border, fontSize, mediaQuery } from '../../styles/theme';
import { useUIState } from '../../context/UIStateContext';
import { toDisplay, pathToDisplay, type DisplayCurrency } from '../../utils/displayCurrency';
import { eventTypeIcons, goalTypeIcons } from '../../utils/defaultName';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  htmlAnnotationsPlugin,
  chartBlackSwanShadingPlugin
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

const VIEW_LABELS_SHORT: Record<ViewMode, string> = {
  median: 'Med',
  nominal: 'Det',
  downside: 'Down',
};

// --- Styled components ---

const ChartHeading = styled.h2`
  margin: 0 0 ${spacing.sm};
  font-size: 1.25rem;
  ${mediaQuery.mobile} { font-size: ${fontSize.xl}; }
`;

const YearlyDataHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: ${spacing.md};
  flex-wrap: wrap;
`;

const YearlyDataControls = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  font-size: ${fontSize.sm};
  flex-wrap: wrap;
`;

const ViewLabel = styled.label<{ $active: boolean; $color: string }>`
  display: flex;
  align-items: center;
  gap: ${spacing.xs};
  cursor: pointer;
  font-weight: normal;
  color: ${props => (props.$active ? props.$color : colors.textPrimary)};

  .label-full  { display: inline; }
  .label-short { display: none; }

  ${mediaQuery.mobile} {
    .label-full  { display: none; }
    .label-short { display: inline; }
  }
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
) {
  const modeLabel = displayCurrency === 'real' ? "today's dollars" : 'nominal dollars';
  const timestamp = new Date().toISOString();
  const comment = `# scenario: ${scenarioName} | exported: ${timestamp} | values in ${modeLabel}`;
  const header = [
    'Age', 'Year',
    'Deterministic Portfolio ($)', 'Median Portfolio ($)', 'Downside Portfolio ($)',
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
    return [
      currentAge + i,
      year,
      Math.round(pathToDisplay(nominal[i] ?? 0, nominalInflation[i] ?? 1, displayCurrency)),
      Math.round(pathToDisplay(median[i] ?? 0, medianInflation[i] ?? 1, displayCurrency)),
      Math.round(pathToDisplay(downside[i] ?? 0, downsideInflation[i] ?? 1, displayCurrency)),
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
}: {
  results: any;
  userData: any;
}) => {
  if (!results) return null;
  const {
    probability, median, downside, nominal, nominalBreakdowns, years,
    medianStockFactors, medianBondFactors, medianBreakdowns,
    downsideStockFactors, downsideBondFactors, downsideBreakdowns,
    medianInflation, downsideInflation, nominalInflation,
  } = results;

  const { displayCurrency, setDisplayCurrency } = useUIState();

  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [view, setView] = useState<ViewMode>('nominal');

  const toggleRow = (index: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const isMobile = useIsMobile();

  const labels = useMemo(
    () => years.map((_: number, index: number) => `${userData.currentAge + index} (${years[index]})`),
    [years, userData.currentAge]
  );

  const chartData = useMemo(() => {
    const toDisplayPath = (path: number[], infArr: number[]) =>
      path.map((v, i) => pathToDisplay(v, infArr[i] ?? 1, displayCurrency));
    const makeDataset = (label: string, mode: ViewMode, data: number[]) => ({
      label,
      data,
      borderColor: VIEW_COLORS[mode],
      backgroundColor: VIEW_COLORS[mode],
      borderWidth: view === mode ? 4 : 1.5,
      pointRadius: 0,
    });
    return {
      labels,
      datasets: [
        makeDataset('Median', 'median', toDisplayPath(median, medianInflation)),
        makeDataset('Deterministic', 'nominal', toDisplayPath(nominal, nominalInflation)),
        makeDataset('Downside (10th percentile)', 'downside', toDisplayPath(downside, downsideInflation)),
      ],
    };
  }, [labels, median, nominal, downside, medianInflation, nominalInflation, downsideInflation, displayCurrency, view]);

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
      legend: {
        position: 'top' as const,
        labels: {
          font: { size: isMobile ? 10 : 12 },
          boxWidth: isMobile ? 12 : 20,
        },
      },
      title: {
        display: true,
        text: `Projected Portfolio Value (${displayCurrency === 'real' ? "Today's" : 'Nominal'} Dollars)`,
        font: { size: isMobile ? 11 : 13 },
      },
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
  }), [isMobile, htmlAnnotations, userData.portfolioAssumptions?.blackSwanEvents, years, displayCurrency]);


  return (
    <div>
      <ChartHeading>Probability of Success: {probability}%</ChartHeading>
      <Line options={options} data={chartData} />
      <Accordion style={{ marginTop: spacing.sm }}>
        <AccordionTab header={
          <YearlyDataHeader>
            <span>Yearly Data</span>
            <YearlyDataControls>
              <PrimeTooltip
                target=".currency-toggle-group"
                position="bottom"
                showDelay={150}
              >
                <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                  <div style={{ marginBottom: spacing.xs }}>
                    <strong>Today's Dollars</strong>: Values adjusted for inflation (what your money can actually buy today).
                  </div>
                  <div>
                    <strong>Nominal Dollars</strong>: Raw future dollar amounts with no inflation adjustment.
                  </div>
                </div>
              </PrimeTooltip>
              <span
                className="currency-toggle-group"
                style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}
                onClick={e => e.stopPropagation()}
              >
                {(['real', 'nominal'] as DisplayCurrency[]).map(mode => {
                  const active = displayCurrency === mode;
                  return (
                    <ViewLabel
                      key={mode}
                      $active={active}
                      $color={colors.primary}
                    >
                      <input
                        type="radio"
                        name="displayCurrency"
                        value={mode}
                        checked={active}
                        onChange={() => setDisplayCurrency(mode)}
                        style={{ accentColor: colors.primary, margin: 0 }}
                      />
                      <span className="label-full">{mode === 'real' ? "Today's $" : 'Nominal $'}</span>
                      <span className="label-short">{mode === 'real' ? "Today" : 'Nom'}</span>
                    </ViewLabel>
                  );
                })}
              </span>
              <span style={{ color: colors.borderMedium }}>|</span>
              {(['median', 'nominal', 'downside'] as ViewMode[]).map(mode => (
                <ViewLabel
                  key={mode}
                  $active={view === mode}
                  $color={mode === 'nominal' ? colors.textPrimary : VIEW_COLORS[mode]}
                  onClick={e => e.stopPropagation()}
                >
                  <input
                    type="radio"
                    name="view"
                    value={mode}
                    checked={view === mode}
                    onChange={() => setView(mode)}
                    style={{ accentColor: colors.primary, margin: 0 }}
                  />
                  <span className="label-full">{VIEW_LABELS[mode]}</span>
                  <span className="label-short">{VIEW_LABELS_SHORT[mode]}</span>
                </ViewLabel>
              ))}
              <button
                onClick={e => {
                  e.stopPropagation();
                  const bdInflation = view === 'median' ? medianInflation : view === 'nominal' ? nominalInflation : downsideInflation;
                  const bdBreakdowns = view === 'median' ? medianBreakdowns : view === 'nominal' ? nominalBreakdowns : downsideBreakdowns;
                  exportCsv(
                    userData.name ?? 'scenario',
                    years, nominal, median, downside,
                    nominalInflation, medianInflation, downsideInflation,
                    bdInflation, bdBreakdowns,
                    userData.currentAge,
                    displayCurrency,
                  );
                }}
                style={{
                  marginLeft: spacing.sm,
                  padding: `${spacing.xs} ${spacing.sm}`,
                  fontSize: fontSize.sm,
                  background: colors.bgMedium,
                  border: border.standard,
                  borderRadius: border.radius,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: spacing.xs,
                  color: colors.textPrimary,
                }}
              >
                <i className="pi pi-download" style={{ fontSize: fontSize.sm }} />
                CSV
              </button>
            </YearlyDataControls>
          </YearlyDataHeader>
        }>
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
        </AccordionTab>
      </Accordion>
    </div>
  );
};

export default React.memo(Projections);
