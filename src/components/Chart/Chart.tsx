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
  calculateAnnualCashFlow,
  type AnnualCashFlowBreakdown,
} from '../../services/SimulationService';
import React, { useMemo, useState } from 'react';
import { spacing, colors, border, fontSize } from '../../styles/theme';

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
    'Total Tax', 'Portfolio Withdrawal', 'Net Cash Flow',
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
      Math.round(bd.portfolioWithdrawal),
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
    probability, median, downside, nominal, years,
    medianStockFactors, medianBondFactors, medianBreakdowns,
    downsideStockFactors, downsideBondFactors, downsideBreakdowns,
  } = results;

  // Pre-calculate nominal (deterministic) annual cash flow breakdowns for all years
  const nominalBreakdowns: AnnualCashFlowBreakdown[] = useMemo(() => {
    return years.map((year: number) => calculateAnnualCashFlow(userData, year, userData.inflationRate));
  }, [years, userData]);

  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [view, setView] = useState<ViewMode>('median');

  const toggleRow = (index: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const labels = years.map(
    (_: number, index: number) =>
      `${userData.currentAge + index} (${years[index]})`
  );

  const makeDataset = (label: string, mode: ViewMode, data: number[]) => {
    const isSelected = view === mode;
    return {
      label,
      data,
      borderColor: VIEW_COLORS[mode],
      backgroundColor: VIEW_COLORS[mode],
      borderWidth: isSelected ? 4 : 1.5,
      pointRadius: 0,
    };
  };

  const chartData = {
    labels,
    datasets: [
      makeDataset('Median', 'median', median),
      makeDataset('Deterministic', 'nominal', nominal),
      makeDataset('Downside (10th percentile)', 'downside', downside),
    ],
  };

  // Generate HTML annotations for income events and spending goals
  const htmlAnnotations: AnnotationConfig[] = [];
  years.forEach((year: number, index: number) => {
    const startingEvents = userData.incomeEvents.filter((event: any) => {
      const ownerAge = (event.owner === 'spouse' && userData.spouseAge != null)
        ? userData.spouseAge : userData.currentAge;
      const startYear = userData.referenceYear + (event.startAge - ownerAge);
      return startYear === year;
    });

    const startingGoals = userData.spendingGoals.filter((goal: any) => {
      const startYear =
        userData.referenceYear + (goal.startAge - userData.currentAge);
      return startYear === year;
    });

    // Add income events
    startingEvents.forEach((event: any, eventIndex: number) => {
      htmlAnnotations.push({
        id: `income_${event.id}_${year}`,
        type: 'income' as const,
        eventType: event.type,
        xValue: index,
        yValue: 0,
        stackIndex: eventIndex,
        data: event,
      });
    });

    // Add spending goals (stack after income events)
    startingGoals.forEach((goal: any, goalIndex: number) => {
      htmlAnnotations.push({
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

  const options = {
    responsive: true,
    plugins: {
      legend: { position: 'top' as const },
      title: {
        display: true,
        text: "Projected Portfolio Value (Today's Dollars)",
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
  };


  return (
    <div>
      <h2 style={{ margin: `0 0 ${spacing.sm}` }}>Probability of Success: {probability}%</h2>
      <Line options={options} data={chartData} />
      <Accordion style={{ marginTop: spacing.sm }}>
        <AccordionTab header={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: spacing.md }}>
            <span>Yearly Data</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, fontSize: fontSize.sm }}>
              {(['median', 'nominal', 'downside'] as ViewMode[]).map(mode => (
                <label
                  key={mode}
                  style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, cursor: 'pointer', fontWeight: 'normal', color: view === mode ? (mode === 'nominal' ? colors.textPrimary : VIEW_COLORS[mode]) : colors.textPrimary }}
                  onClick={e => e.stopPropagation()}
                >
                  <input
                    type="radio"
                    name="view"
                    value={mode}
                    checked={view === mode}
                    onChange={() => setView(mode)}
                    style={{ accentColor: mode === 'nominal' ? colors.textPrimary : VIEW_COLORS[mode], margin: 0 }}
                  />
                  {VIEW_LABELS[mode]}
                </label>
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
            </div>
          </div>
        }>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: colors.bgMedium }}>
                  <th style={{ padding: spacing.sm, border: border.standard, textAlign: 'left' }}>
                    Age (Year)
                  </th>
                  <th style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                    Portfolio
                  </th>
                  <th style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                    Spending
                  </th>
                  <th style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                    Income
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

                  const totalSpending = breakdown.baseSpendingNet + breakdown.otherSpendingGoalsNet;
                  const totalIncome = breakdown.totalGrossIncome;

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

                  // Cash flow deflated to today's dollars
                  const inflationFactor = Math.pow(
                    1 + userData.inflationRate,
                    index
                  );
                  const cashFlow = breakdown.netCashFlow / inflationFactor;

                  const isExpanded = expandedRows.has(index);
                  const fmt = (v: number) => v.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  });

                  return (
                    <React.Fragment key={year}>
                    <tr onClick={() => toggleRow(index)} style={{ cursor: 'pointer' }}>
                      <td
                        style={{ padding: spacing.sm, border: border.standard, whiteSpace: 'nowrap' }}
                      >
                        <i className={isExpanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'}
                          style={{ fontSize: fontSize.xs, marginRight: spacing.xs, color: colors.textMuted }} />
                        {age} ({year})
                      </td>
                      <td style={{ padding: spacing.sm, border: border.standard, textAlign: 'right' }}>
                        {fmt((view === 'median' ? median : view === 'nominal' ? nominal : downside)[index] ?? 0)}
                      </td>
                      <td
                        style={{
                          padding: spacing.sm,
                          border: border.standard,
                          textAlign: 'right',
                        }}
                      >
                        {startingGoals.length > 0 && (
                          <div
                            style={{
                              marginBottom: spacing.xs,
                              textAlign: 'left',
                            }}
                          >
                            {startingGoals.map((goal: any) => (
                              <span
                                key={goal.id}
                                style={{
                                  marginRight: spacing.xs,
                                  color: colors.spending,
                                  backgroundColor: colors.spendingBg,
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
                                <i className={goalTypeIcons[goal.type]} />
                              </span>
                            ))}
                          </div>
                        )}
                        {totalSpending > 0
                          ? `-${fmt(totalSpending)}`
                          : fmt(totalSpending)}
                      </td>
                      <td
                        style={{
                          padding: spacing.sm,
                          border: border.standard,
                          textAlign: 'right',
                        }}
                      >
                        {startingEvents.length > 0 && (
                          <div
                            style={{
                              marginBottom: spacing.xs,
                              textAlign: 'left',
                            }}
                          >
                            {startingEvents.map((event: any) => (
                              <span
                                key={event.id}
                                style={{
                                  marginRight: spacing.xs,
                                  color: colors.income,
                                  backgroundColor: colors.incomeBg,
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
                                <i className={eventTypeIcons[event.type]} />
                              </span>
                            ))}
                          </div>
                        )}
                        {fmt(totalIncome)}
                      </td>
                      <td
                        style={{
                          padding: spacing.sm,
                          border: border.standard,
                          textAlign: 'right',
                        }}
                      >
                        {fmt(cashFlow)}
                      </td>
                    </tr>
                    {isExpanded && (() => {
                      const { stockAllocation, stockReturn, bondReturn } = userData.portfolioAssumptions;
                      const bondAllocation = 1 - stockAllocation;
                      const selectedPath = view === 'median' ? median : view === 'nominal' ? nominal : downside;
                      const startBalance = index === 0 ? userData.currentSavings : (selectedPath[index - 1] ?? 0);

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

                      const stockGain = startBalance * stockAllocation * (stockFactor - 1);
                      const bondGain  = startBalance * bondAllocation  * (bondFactor  - 1);
                      const netGrowth = stockGain + bondGain;
                      const fmtPct = (f: number) => `${((f - 1) * 100).toFixed(1)}%`;
                      const fmtSigned = (v: number) => `${v >= 0 ? '+' : '-'}$${fmt(Math.abs(v))}`;

                      return (
                        <tr key={`${year}-detail`}>
                          <td colSpan={5} style={{
                            padding: `${spacing.xs} ${spacing.sm}`,
                            backgroundColor: colors.bgLight,
                            border: border.standard,
                            fontSize: fontSize.sm,
                          }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: spacing.md }}>
                              {breakdown.totalGrossIncome > 0 && (
                              <div>
                                <div style={{ fontWeight: 'bold', marginBottom: spacing.xs, color: colors.income }}>Income</div>
                                {breakdown.ssGross > 0 && <div>SS Gross: ${fmt(breakdown.ssGross)}</div>}
                                {breakdown.otherTaxableGross > 0 && <div>Other Taxable: ${fmt(breakdown.otherTaxableGross)}</div>}
                                {breakdown.afterTaxIncome > 0 && <div>After-Tax: ${fmt(breakdown.afterTaxIncome)}</div>}
                                {breakdown.ssTaxableAmount > 0 && (
                                  <div style={{ color: colors.textSecondary }}>SS Taxable Portion: ${fmt(breakdown.ssTaxableAmount)}</div>
                                )}
                              </div>
                              )}
                              {breakdown.totalSpendingNet > 0 && (
                              <div>
                                <div style={{ fontWeight: 'bold', marginBottom: spacing.xs, color: colors.spending }}>Spending</div>
                                {breakdown.baseSpendingNet > 0 && <div>Base Spending: ${fmt(breakdown.baseSpendingNet)}</div>}
                                {breakdown.otherSpendingGoalsNet > 0 && <div>Goals: ${fmt(breakdown.otherSpendingGoalsNet)}</div>}
                                <div style={{ fontWeight: 'bold' }}>Total Need: ${fmt(breakdown.totalSpendingNet)}</div>
                              </div>
                              )}
                              <div>
                                <div style={{ fontWeight: 'bold', marginBottom: spacing.xs, color: colors.textPrimary }}>Tax &amp; Withdrawal</div>
                                {breakdown.totalTax > 0 && <div>Total Tax: ${fmt(breakdown.totalTax)}</div>}
                                {breakdown.portfolioWithdrawal > 0 && <div>Portfolio Withdrawal: ${fmt(breakdown.portfolioWithdrawal)}</div>}
                                {(() => {
                                  const shortfall = nominalBreakdowns[index].portfolioWithdrawal - breakdown.portfolioWithdrawal;
                                  return shortfall > 0 ? (
                                    <div style={{ color: colors.danger, fontWeight: 'bold' }}>
                                      Portfolio Depleted — Shortfall: ${fmt(shortfall)}
                                    </div>
                                  ) : null;
                                })()}
                                <div style={{ fontWeight: 'bold' }}>
                                  Net Cash Flow: {breakdown.netCashFlow >= 0 ? '' : '-'}${fmt(Math.abs(breakdown.netCashFlow))}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontWeight: 'bold', marginBottom: spacing.xs, color: colors.textSecondary }}>Portfolio Growth</div>
                                <div>Stocks ({Math.round(stockAllocation * 100)}%): {fmtPct(stockFactor)} → {fmtSigned(stockGain)}</div>
                                <div>Bonds ({Math.round(bondAllocation * 100)}%): {fmtPct(bondFactor)} → {fmtSigned(bondGain)}</div>
                                <div style={{ fontWeight: 'bold' }}>Net: {fmtSigned(netGrowth)}</div>
                              </div>
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

export default Projections;
