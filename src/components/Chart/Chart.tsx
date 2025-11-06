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
  calculateAnnualIncome,
  calculateAnnualSpending,
} from '../../services/SimulationService';
import { useMemo } from 'react';
import type { SpendingGoal } from '../../types/SpendingGoal';
import type { IncomeEvent } from '../../types/IncomeEvent';

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
  monthly_retirement: 'pi pi-dollar',
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

  // Pre-calculate annual spending and income for all years to avoid redundant calculations
  const annualCalculations = useMemo(() => {
    return years.map((year: number) => ({
      year,
      totalSpending: calculateAnnualSpending(userData, year),
      totalIncome: calculateAnnualIncome(userData, year),
    }));
  }, [years, userData]);
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
      const startYear =
        userData.referenceYear + (event.startAge - userData.currentAge);
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

  const currentYear = userData.referenceYear;
  const yearsToRetire = userData.retirementAge - userData.currentAge;
  const retirementYear = currentYear + yearsToRetire;

  return (
    <div>
      <h2>Probability of Success: {probability}%</h2>
      <Line options={options} data={data} />
      <Accordion style={{ marginTop: '1rem' }}>
        <AccordionTab header='Yearly Data'>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5' }}>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: '1px solid #ddd',
                      textAlign: 'left',
                    }}
                  >
                    Age (Year)
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: '1px solid #ddd',
                      textAlign: 'right',
                    }}
                  >
                    Starting Portfolio Value (Median)
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: '1px solid #ddd',
                      textAlign: 'right',
                    }}
                  >
                    Starting Portfolio Value (10th Percentile)
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: '1px solid #ddd',
                      textAlign: 'right',
                    }}
                  >
                    Basic Saving or Retirement Spending
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: '1px solid #ddd',
                      textAlign: 'right',
                    }}
                  >
                    Other Spending Goals
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: '1px solid #ddd',
                      textAlign: 'right',
                    }}
                  >
                    Other Income Events
                  </th>
                  <th
                    style={{
                      padding: '0.5rem',
                      border: '1px solid #ddd',
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
                  const isRetirement = year >= retirementYear;

                  // Basic amount = annual savings (pre-retirement) or retirement spending (post-retirement)
                  const basicAmount = isRetirement
                    ? userData.retirementSpending.monthlyAmount * 12
                    : userData.annualSavings;

                  // Use pre-calculated tax-adjusted values
                  const { totalSpending, totalIncome } =
                    annualCalculations[index];
                  if (!isRetirement) {
                    // Add annual savings for pre-retirement years (not included in calculateAnnualIncome)
                    // Note: annual savings are not taxed in this model
                  }

                  // For display purposes, calculate non-tax-adjusted versions for the table breakdown
                  // Calculate total spending and income in today's dollars (without tax adjustments for breakdown)
                  const inflationRate = 0.03; // Assuming 3% inflation rate
                  let totalSpendingBase = 0;
                  if (isRetirement) {
                    totalSpendingBase +=
                      userData.retirementSpending.monthlyAmount * 12;
                  }
                  userData.spendingGoals.forEach((goal: SpendingGoal) => {
                    const startYear =
                      userData.referenceYear +
                      (goal.startAge - userData.currentAge);
                    const endYear = goal.endAge
                      ? userData.referenceYear +
                        (goal.endAge - userData.currentAge)
                      : userData.lifeExpectancy +
                        userData.referenceYear -
                        userData.currentAge;
                    let shouldInclude = false;
                    if (goal.isOneTime) {
                      shouldInclude = year === startYear;
                    } else {
                      shouldInclude = year >= startYear && year <= endYear;
                    }
                    if (shouldInclude) {
                      let amount = goal.amount;
                      if (!goal.inflationAdjusted) {
                        // Fixed spending: deflate by inflation to show in today's dollars
                        const yearsFromReference =
                          year - userData.referenceYear;
                        amount =
                          goal.amount /
                          Math.pow(1 + inflationRate, yearsFromReference);
                      }
                      // Inflation-adjusted spending: amount stays constant (real value preserved)
                      totalSpendingBase += amount;
                    }
                  });

                  let totalIncomeBase = 0;
                  userData.incomeEvents.forEach((event: IncomeEvent) => {
                    const startYear =
                      userData.referenceYear +
                      (event.startAge - userData.currentAge);
                    const endYear = event.endAge
                      ? userData.referenceYear +
                        (event.endAge - userData.currentAge)
                      : userData.lifeExpectancy +
                        userData.referenceYear -
                        userData.currentAge;
                    let shouldInclude = false;
                    if (event.isOneTime) {
                      shouldInclude = year === startYear;
                    } else {
                      shouldInclude = year >= startYear && year <= endYear;
                    }
                    if (shouldInclude) {
                      let amount = event.amount;
                      if (event.colaType === 'fixed') {
                        // Fixed income: deflate by inflation to show in today's dollars
                        const yearsFromReference =
                          year - userData.referenceYear;
                        amount =
                          event.amount /
                          Math.pow(1 + inflationRate, yearsFromReference);
                      }
                      // Inflation-adjusted income: amount stays constant (real value preserved)
                      totalIncomeBase += amount;
                    }
                  });
                  if (!isRetirement) {
                    totalIncomeBase += userData.annualSavings;
                  }

                  // Other spending goals = total spending base minus basic
                  const otherSpendingGoals = Math.max(
                    0,
                    totalSpendingBase - basicAmount
                  );

                  // Other income events = total income base minus annual savings if pre-retirement
                  const otherIncomeEvents =
                    totalIncomeBase -
                    (isRetirement ? 0 : userData.annualSavings);

                  const startingEvents = userData.incomeEvents.filter(
                    (event: any) => {
                      const startYear =
                        userData.referenceYear +
                        (event.startAge - userData.currentAge);
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

                  // Cash flow = tax-adjusted income - tax-adjusted spending
                  // Both functions already account for inflation and taxes appropriately
                  // Deflate to today's dollars for consistent display with portfolio balance
                  const inflationFactor = Math.pow(
                    1 + userData.inflationRate,
                    index
                  );
                  const cashFlow =
                    (totalIncome - totalSpending) / inflationFactor;

                  return (
                    <tr key={year}>
                      <td
                        style={{ padding: '0.5rem', border: '1px solid #ddd' }}
                      >
                        {age} ({year})
                      </td>
                      <td
                        style={{
                          padding: '0.5rem',
                          border: '1px solid #ddd',
                          textAlign: 'right',
                        }}
                      >
                        {median[index]?.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td
                        style={{
                          padding: '0.5rem',
                          border: '1px solid #ddd',
                          textAlign: 'right',
                        }}
                      >
                        {downside[index]?.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td
                        style={{
                          padding: '0.5rem',
                          border: '1px solid #ddd',
                          textAlign: 'right',
                        }}
                      >
                        {basicAmount.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td
                        style={{
                          padding: '0.5rem',
                          border: '1px solid #ddd',
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
                                  color: '#d2691e',
                                  backgroundColor: 'rgba(210, 105, 30, 0.1)',
                                  borderRadius: '50%',
                                  padding: '0.25rem',
                                  fontSize: '0.9rem',
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
                        {otherSpendingGoals > 0
                          ? `-${otherSpendingGoals.toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            })}`
                          : otherSpendingGoals.toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            })}
                      </td>
                      <td
                        style={{
                          padding: '0.5rem',
                          border: '1px solid #ddd',
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
                                  color: 'green',
                                  backgroundColor: 'rgba(0, 128, 0, 0.1)',
                                  borderRadius: '50%',
                                  padding: '0.25rem',
                                  fontSize: '0.9rem',
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
                        {otherIncomeEvents.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td
                        style={{
                          padding: '0.5rem',
                          border: '1px solid #ddd',
                          textAlign: 'right',
                        }}
                      >
                        {cashFlow.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </td>
                    </tr>
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
