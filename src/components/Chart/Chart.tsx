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

const Projections = ({
  results,
  userData,
}: {
  results: any;
  userData: any;
}) => {
  if (!results) return null;
  const { probability, median, downside, years } = results;

  // Pre-calculate annual cash flow breakdowns for all years
  const annualBreakdowns: AnnualCashFlowBreakdown[] = useMemo(() => {
    return years.map((year: number) => calculateAnnualCashFlow(userData, year));
  }, [years, userData]);

  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
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
  const data = {
    labels,
    datasets: [
      {
        label: 'Median',
        data: median,
        borderColor: 'blue',
        backgroundColor: 'blue',
      },
      {
        label: 'Downside (10th percentile)',
        data: downside,
        borderColor: 'red',
        backgroundColor: 'red',
      },
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
          // TODO: Could implement navigation to table row, edit dialog, etc.
        },
        onIconHover: (annotation: AnnotationConfig | null) => {
          console.log('Hovered annotation:', annotation);
          // TODO: Could implement table row highlighting
        },
      },
    },
  };

  return (
    <div>
      <h2 style={{ margin: '0 0 0.5rem' }}>Probability of Success: {probability}%</h2>
      <Line options={options} data={data} />
      <Accordion style={{ marginTop: '0.5rem' }}>
        <AccordionTab header='Yearly Data'>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: colors.bgMedium }}>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: border.standard,
                      textAlign: 'left',
                    }}
                  >
                    Age (Year)
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: border.standard,
                      textAlign: 'right',
                    }}
                  >
                    Median Portfolio
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: border.standard,
                      textAlign: 'right',
                    }}
                  >
                    10th Percentile
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: border.standard,
                      textAlign: 'right',
                    }}
                  >
                    Spending
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: border.standard,
                      textAlign: 'right',
                    }}
                  >
                    Income
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: border.standard,
                      textAlign: 'right',
                    }}
                  >
                    Cash Flow
                  </th>
                </tr>
              </thead>
              <tbody>
                {years.map((year: number, index: number) => {
                  const age = userData.currentAge + index;
                  const breakdown = annualBreakdowns[index];

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
                        style={{ padding: '0.5rem', border: border.standard, whiteSpace: 'nowrap' }}
                      >
                        <i className={isExpanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'}
                          style={{ fontSize: fontSize.xs, marginRight: spacing.xs, color: colors.textMuted }} />
                        {age} ({year})
                      </td>
                      <td
                        style={{
                          padding: '0.5rem',
                          border: border.standard,
                          textAlign: 'right',
                        }}
                      >
                        {fmt(median[index] ?? 0)}
                      </td>
                      <td
                        style={{
                          padding: '0.5rem',
                          border: border.standard,
                          textAlign: 'right',
                        }}
                      >
                        {fmt(downside[index] ?? 0)}
                      </td>
                      <td
                        style={{
                          padding: '0.5rem',
                          border: border.standard,
                          textAlign: 'right',
                        }}
                      >
                        {startingGoals.length > 0 && (
                          <div
                            style={{
                              marginBottom: '0.25rem',
                              textAlign: 'left',
                            }}
                          >
                            {startingGoals.map((goal: any) => (
                              <span
                                key={goal.id}
                                style={{
                                  marginRight: '0.25rem',
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
                          padding: '0.5rem',
                          border: border.standard,
                          textAlign: 'right',
                        }}
                      >
                        {startingEvents.length > 0 && (
                          <div
                            style={{
                              marginBottom: '0.25rem',
                              textAlign: 'left',
                            }}
                          >
                            {startingEvents.map((event: any) => (
                              <span
                                key={event.id}
                                style={{
                                  marginRight: '0.25rem',
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
                          padding: '0.5rem',
                          border: border.standard,
                          textAlign: 'right',
                        }}
                      >
                        {fmt(cashFlow)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${year}-detail`}>
                        <td colSpan={6} style={{
                          padding: `${spacing.xs} ${spacing.sm}`,
                          backgroundColor: colors.bgLight,
                          border: border.standard,
                          fontSize: fontSize.sm,
                        }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: spacing.md }}>
                            {breakdown.totalGrossIncome > 0 && (
                            <div>
                              <div style={{ fontWeight: 'bold', marginBottom: spacing.xs, color: colors.income }}>Income (nominal)</div>
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
                              <div style={{ fontWeight: 'bold', marginBottom: spacing.xs, color: colors.spending }}>Spending (nominal)</div>
                              {breakdown.baseSpendingNet > 0 && <div>Base Spending: ${fmt(breakdown.baseSpendingNet)}</div>}
                              {breakdown.otherSpendingGoalsNet > 0 && <div>Goals: ${fmt(breakdown.otherSpendingGoalsNet)}</div>}
                              <div style={{ fontWeight: 'bold' }}>Total Need: ${fmt(breakdown.totalSpendingNet)}</div>
                            </div>
                            )}
                            <div>
                              <div style={{ fontWeight: 'bold', marginBottom: spacing.xs, color: colors.textPrimary }}>Tax &amp; Withdrawal</div>
                              {breakdown.totalTax > 0 && <div>Total Tax: ${fmt(breakdown.totalTax)}</div>}
                              {breakdown.portfolioWithdrawal > 0 && <div>Portfolio Withdrawal: ${fmt(breakdown.portfolioWithdrawal)}</div>}
                              <div style={{ fontWeight: 'bold' }}>
                                Net Cash Flow: {breakdown.netCashFlow >= 0 ? '' : '-'}${fmt(Math.abs(breakdown.netCashFlow))}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
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
