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
import {
  calculateAnnualSpending,
  calculateAnnualIncome,
} from '../../services/SimulationService';
import htmlAnnotationsPlugin, {
  type AnnotationConfig,
} from '../../plugins/chartHtmlAnnotations';

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

// Unicode symbols for chart annotations and table
const eventTypeSymbols: Record<string, string> = {
  social_security: '🛡',
  annuity_income: '$',
  inheritance: '⬇',
  pension_income: '⚒',
  rental_income: '⌂',
  sale_of_property: '⇄',
  work_during_retirement: '⚙',
  other_income: '●',
};

const goalTypeSymbols: Record<string, string> = {
  monthly_retirement: '$',
  charity: '♡',
  dependent_support: '&',
  healthcare: '⚕',
  home_purchase: '⌂',
  education: '∇',
  renovation: '⚒',
  vacation: '✈',
  vehicle: 'V',
  wedding: '⚭',
  other: '●',
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
        new Date().getFullYear() + (event.startAge - userData.currentAge);
      return startYear === year;
    });

    const startingGoals = userData.spendingGoals.filter(
      (goal: any) => goal.startYear === year
    );

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

  const currentYear = new Date().getFullYear();
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

                  // Calculate total spending and income for this year
                  const totalSpending = calculateAnnualSpending(userData, year);
                  let totalIncome = calculateAnnualIncome(userData, year);
                  if (!isRetirement) {
                    totalIncome += userData.annualSavings; // Add annual savings pre-retirement
                  }

                  // Basic amount = annual savings (pre-retirement) or retirement spending (post-retirement)
                  const basicAmount = isRetirement
                    ? userData.retirementSpending.monthlyAmount * 12
                    : userData.annualSavings;

                  // Other spending goals = total spending minus basic retirement spending (or 0 for pre-retirement)
                  const basicSpending = isRetirement
                    ? userData.retirementSpending.monthlyAmount * 12
                    : 0;
                  const otherSpendingGoals = Math.max(
                    0,
                    totalSpending - basicSpending
                  );

                  // Other income events = all income events
                  const otherIncomeEvents = calculateAnnualIncome(
                    userData,
                    year
                  );

                  const startingEvents = userData.incomeEvents.filter(
                    (event: any) => {
                      const startYear =
                        new Date().getFullYear() +
                        (event.startAge - userData.currentAge);
                      return startYear === year;
                    }
                  );

                  const startingGoals = userData.spendingGoals.filter(
                    (goal: any) => goal.startYear === year
                  );

                  // Cash flow = income - spending for this year
                  const cashFlow = totalIncome - totalSpending;

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
                                {goalTypeSymbols[goal.type]}
                              </span>
                            ))}
                          </div>
                        )}
                        {otherSpendingGoals.toLocaleString(undefined, {
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
                                {eventTypeSymbols[event.type]}
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
