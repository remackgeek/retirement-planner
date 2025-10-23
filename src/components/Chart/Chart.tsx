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

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const eventTypeLabels: Record<string, string> = {
  social_security: 'Social Security',
  annuity_income: 'Annuity Income',
  inheritance: 'Inheritance',
  pension_income: 'Pension Income',
  rental_income: 'Rental Income',
  sale_of_property: 'Sale of Property/Downsize',
  work_during_retirement: 'Work During Retirement',
  other_income: 'Other Income',
};

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
  const options = {
    responsive: true,
    plugins: {
      legend: { position: 'top' as const },
      title: {
        display: true,
        text: "Projected Portfolio Value (Today's Dollars)",
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
                              <i
                                key={event.id}
                                className={eventTypeIcons[event.type]}
                                style={{
                                  marginRight: '0.25rem',
                                  color: 'green',
                                  backgroundColor: 'rgba(0, 128, 0, 0.1)',
                                  borderRadius: '50%',
                                  padding: '0.3125rem 0.25rem 0.25rem 0.25rem',
                                  fontSize: '0.8rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '1.5rem',
                                  height: '1.5rem',
                                }}
                              ></i>
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
