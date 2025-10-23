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

                  // Other income events = total income minus basic SS and annual savings
                  const basicIncome = isRetirement
                    ? userData.incomeEvents.find(
                        (e: any) => e.type === 'social_security'
                      )?.amount || 0
                    : userData.annualSavings;
                  const otherIncomeEvents = Math.max(
                    0,
                    totalIncome - basicIncome
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
