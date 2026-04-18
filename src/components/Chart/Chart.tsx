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
import htmlAnnotationsPlugin, {
  type AnnotationConfig,
} from '../../plugins/chartHtmlAnnotations';
import {
  type AnnualCashFlowBreakdown,
} from '../../services/SimulationService';
import React, { useState, useMemo, useEffect } from 'react';
import styled from 'styled-components';
import { spacing, colors, border, fontSize, mediaQuery } from '../../styles/theme';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  htmlAnnotationsPlugin
);

// PrimeReact icons for chart annotations and table
const eventTypeIcons: Record<string, string> = {
  employment_savings: 'pi pi-wallet',
  social_security: 'pi pi-shield',
  annuity_income: 'pi pi-money-bill',
  inheritance: 'pi pi-gift',
  pension_income: 'pi pi-briefcase',
  rental_income: 'pi pi-home',
  sale_of_property: 'pi pi-arrow-right-arrow-left',
  work_during_retirement: 'pi pi-cog',
  other_income: 'pi pi-ellipsis-h',
};

const goalTypeIcons: Record<string, string> = {
  living_expenses: 'pi pi-dollar',
  charity: 'pi pi-heart',
  dependent_support: 'pi pi-users',
  healthcare: 'pi pi-heart-fill',
  home_purchase: 'pi pi-home',
  education: 'pi pi-book',
  renovation: 'pi pi-wrench',
  vacation: 'pi pi-plane',
  vehicle: 'pi pi-car',
  wedding: 'pi pi-heart',
  other: 'pi pi-circle',
};

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
  annualBreakdowns: AnnualCashFlowBreakdown[],
  currentAge: number
) {
  const header = [
    'Age', 'Year',
    'Deterministic Portfolio ($)', 'Median Portfolio ($)', 'Downside Portfolio ($)',
    'SS Gross', 'Other Taxable Income', 'After-Tax Income', 'Total Gross Income',
    'Base Spending', 'Goal Spending', 'Total Spending',
    'Total Tax', 'Ordinary Income Tax', 'Capital Gains Tax', 'Portfolio Withdrawal',
    'Withdrawal — Taxable', 'Withdrawal — Traditional', 'Withdrawal — Roth',
    'RMD Required', 'RMD Reinvested',
    'Net Cash Flow',
  ].join(',');

  const rows = years.map((year, i) => {
    const bd = annualBreakdowns[i];
    return [
      currentAge + i,
      year,
      Math.round(nominal[i] ?? 0),
      Math.round(median[i] ?? 0),
      Math.round(downside[i] ?? 0),
      Math.round(bd.ssGross),
      Math.round(bd.otherTaxableGross),
      Math.round(bd.afterTaxIncome),
      Math.round(bd.totalGrossIncome),
      Math.round(bd.baseSpendingNet),
      Math.round(bd.otherSpendingGoalsNet),
      Math.round(bd.totalSpendingNet),
      Math.round(bd.totalTax),
      Math.round(bd.ordinaryTax),
      Math.round(bd.capitalGainsTax),
      Math.round(bd.portfolioWithdrawal),
      Math.round(bd.withdrawalFromTaxable),
      Math.round(bd.withdrawalFromTraditional),
      Math.round(bd.withdrawalFromRoth),
      Math.round(bd.rmdRequired),
      Math.round(bd.rmdExcess),
      Math.round(bd.netCashFlow),
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');
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
  } = results;

  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [view, setView] = useState<ViewMode>('median');

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
        makeDataset('Median', 'median', median),
        makeDataset('Deterministic', 'nominal', nominal),
        makeDataset('Downside (10th percentile)', 'downside', downside),
      ],
    };
  }, [labels, median, nominal, downside, view]);

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
        text: "Projected Portfolio Value (Today's Dollars)",
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
  }), [isMobile, htmlAnnotations]);


  return (
    <div>
      <ChartHeading>Probability of Success: {probability}%</ChartHeading>
      <Line options={options} data={chartData} />
      <Accordion style={{ marginTop: spacing.sm }}>
        <AccordionTab header={
          <YearlyDataHeader>
            <span>Yearly Data</span>
            <YearlyDataControls>
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
                  exportCsv(userData.name ?? 'scenario', years, nominal, median, downside,
                    view === 'median' ? medianBreakdowns : view === 'nominal' ? nominalBreakdowns : downsideBreakdowns,
                    userData.currentAge);
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
                    All values in today's dollars
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

                  // All display values in today's dollars
                  const inflationFactor = Math.pow(1 + userData.inflationRate, index);
                  const realIncome = breakdown.totalGrossIncome / inflationFactor;
                  const realSpending = breakdown.totalSpendingNet / inflationFactor;
                  const realTax = breakdown.totalTax / inflationFactor;
                  // Cash Flow = total real delta: Portfolio[next] - Portfolio[current]
                  const portfolio = selectedPath[index] ?? 0;
                  const nextPortfolio = index < years.length - 1 ? (selectedPath[index + 1] ?? 0) : null;
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
                              iconChip(event.id, eventTypeIcons[event.type], colors.income, colors.incomeBg)
                            )}
                          </div>
                        )}
                        {fmt(realIncome)}
                      </td>
                      <td style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                        {startingGoals.length > 0 && (
                          <div style={{ marginBottom: spacing.xs, textAlign: 'left' }}>
                            {startingGoals.map((goal: any) =>
                              iconChip(goal.id, goalTypeIcons[goal.type], colors.spending, colors.spendingBg)
                            )}
                          </div>
                        )}
                        {realSpending > 0 ? `-${fmt(realSpending)}` : fmt(realSpending)}
                      </td>
                      <td style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                        {realTax > 0 ? `-${fmt(realTax)}` : fmt(realTax)}
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

                      // Growth computed on displayed start balance (today's $) — correct since growth happens first
                      const startBalance = portfolio;
                      const stockGain = startBalance * stockAllocation * (stockFactor - 1);
                      const bondGain  = startBalance * bondAllocation  * (bondFactor  - 1);
                      const netGrowth = stockGain + bondGain;

                      // All breakdown items deflated to today's $
                      const realSS = breakdown.ssGross / inflationFactor;
                      const realOtherTaxable = breakdown.otherTaxableGross / inflationFactor;
                      const realAfterTax = breakdown.afterTaxIncome / inflationFactor;
                      const realSSTaxable = breakdown.ssTaxableAmount / inflationFactor;
                      const realBaseSpending = breakdown.baseSpendingNet / inflationFactor;
                      const realGoalSpending = breakdown.otherSpendingGoalsNet / inflationFactor;
                      const realWithdrawal = breakdown.portfolioWithdrawal / inflationFactor;

                      // Inflation adjustment = residual that makes everything balance
                      const inflationAdj = cashFlow !== null
                        ? cashFlow - netGrowth - realIncome + realSpending + realTax
                        : 0;

                      const fmtPct = (f: number) => `${((f - 1) * 100).toFixed(1)}%`;
                      const fmtSigned = (v: number) => `${v >= 0 ? '+' : '-'}$${fmt(Math.abs(v))}`;

                      // Shortfall detection
                      const nominalWithdrawal = nominalBreakdowns[index].portfolioWithdrawal / inflationFactor;
                      const shortfall = nominalWithdrawal - realWithdrawal;

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
                              {realIncome > 0 && (
                                <>
                                  <div style={{ ...categoryStyle, color: colors.income }}>
                                    <span>Income</span>
                                    <span>{fmtSigned(realIncome)}</span>
                                  </div>
                                  {realSS > 0 && (
                                    <>
                                      <div style={itemStyle}>
                                        <span>Social Security</span>
                                        <span>${fmt(realSS)}</span>
                                      </div>
                                      {realSSTaxable > 0 && (
                                        <div style={noteStyle}>
                                          Taxable portion: ${fmt(realSSTaxable)}
                                        </div>
                                      )}
                                    </>
                                  )}
                                  {realOtherTaxable > 0 && (
                                    <div style={itemStyle}>
                                      <span>Other Taxable</span>
                                      <span>${fmt(realOtherTaxable)}</span>
                                    </div>
                                  )}
                                  {realAfterTax > 0 && (
                                    <div style={itemStyle}>
                                      <span>After-Tax</span>
                                      <span>${fmt(realAfterTax)}</span>
                                    </div>
                                  )}
                                </>
                              )}

                              {/* Spending */}
                              {realSpending > 0 && (
                                <>
                                  <div style={{ ...categoryStyle, color: colors.spending }}>
                                    <span>Spending</span>
                                    <span>-${fmt(realSpending)}</span>
                                  </div>
                                  {realBaseSpending > 0 && (
                                    <div style={itemStyle}>
                                      <span>Living Expenses</span>
                                      <span>${fmt(realBaseSpending)}</span>
                                    </div>
                                  )}
                                  {realGoalSpending > 0 && (
                                    <div style={itemStyle}>
                                      <span>Goals</span>
                                      <span>${fmt(realGoalSpending)}</span>
                                    </div>
                                  )}
                                </>
                              )}

                              {/* Taxes */}
                              {realTax > 0 && (() => {
                                const realOrdinaryTax = breakdown.ordinaryTax / inflationFactor;
                                const realCapGainsTax = breakdown.capitalGainsTax / inflationFactor;
                                return (
                                  <>
                                    <div style={categoryStyle}>
                                      <span>Taxes</span>
                                      <span>-${fmt(realTax)}</span>
                                    </div>
                                    {realOrdinaryTax > 0.5 && (
                                      <div style={itemStyle}>
                                        <span>Ordinary Income</span>
                                        <span>${fmt(realOrdinaryTax)}</span>
                                      </div>
                                    )}
                                    {realCapGainsTax > 0.5 && (
                                      <div style={itemStyle}>
                                        <span>Capital Gains</span>
                                        <span>${fmt(realCapGainsTax)}</span>
                                      </div>
                                    )}
                                  </>
                                );
                              })()}

                              {/* Inflation Adjustment */}
                              {Math.abs(inflationAdj) > 0.5 && (
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
                              {realWithdrawal > 0 && (
                                <>
                                <div style={{ color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'right', paddingTop: spacing.xs }}>
                                  Portfolio withdrawal: ${fmt(realWithdrawal)}
                                </div>
                                {(() => {
                                  const realFromTaxable = breakdown.withdrawalFromTaxable / inflationFactor;
                                  const realFromTrad = breakdown.withdrawalFromTraditional / inflationFactor;
                                  const realFromRoth = breakdown.withdrawalFromRoth / inflationFactor;
                                  return (
                                    <>
                                      {realFromTaxable > 0.5 && (
                                        <div style={noteStyle}>Taxable: ${fmt(realFromTaxable)}</div>
                                      )}
                                      {realFromTrad > 0.5 && (
                                        <div style={noteStyle}>Traditional: ${fmt(realFromTrad)}</div>
                                      )}
                                      {realFromRoth > 0.5 && (
                                        <div style={noteStyle}>Roth: ${fmt(realFromRoth)}</div>
                                      )}
                                    </>
                                  );
                                })()}
                                </>
                              )}
                              {/* RMD */}
                              {breakdown.rmdRequired > 0.5 && (() => {
                                const realRmdRequired = breakdown.rmdRequired / inflationFactor;
                                const realRmdExcess = breakdown.rmdExcess / inflationFactor;
                                return (
                                  <>
                                    <div style={{ color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'right', paddingTop: spacing.xs }}>
                                      RMD required: ${fmt(realRmdRequired)}
                                    </div>
                                    {realRmdExcess > 0.5 && (
                                      <div style={noteStyle}>Reinvested to Taxable: ${fmt(realRmdExcess)}</div>
                                    )}
                                  </>
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
