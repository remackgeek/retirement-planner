import { useContext, useState, useEffect } from 'react';
import styled from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { runSimulation } from '../../services/SimulationService';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const ContentContainer = styled.main`
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
`;

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
`;

const Projections = ({ results }: { results: any }) => {
  if (!results) return null;
  const { probability, median, downside, years } = results;
  const data = {
    labels: years,
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
      title: { display: true, text: 'Projected Portfolio Value (Today\'s Dollars)' },
    },
  };
  return (
    <div>
      <h2>Probability of Success: {probability}%</h2>
      <Line options={options} data={data} />
      <p>Disclaimer: This is a hypothetical projection and not financial advice.</p>
    </div>
  );
};

const Content: React.FC = () => {
  const context = useContext(RetirementContext);
  if (!context) return null;
  const { activeScenario, addScenario } = context;
  const [tempData, setTempData] = useState({
    id: '',
    name: '',
    currentAge: 40,
    retirementAge: 65,
    lifeExpectancy: 92,
    currentSavings: 100000,
    annualSavings: 20000,
    monthlyRetirementSpending: 5000,
    ssAmount: 30000,
    riskLevel: 'moderate' as 'conservative' | 'moderate' | 'high',
  });
  const [dialogVisible, setDialogVisible] = useState(false);
  const [results, setResults] = useState<any>(null);
  const riskOptions = [
    { label: 'Conservative', value: 'conservative' },
    { label: 'Moderate', value: 'moderate' },
    { label: 'High', value: 'high' },
  ];

  useEffect(() => {
    if (activeScenario) {
      setTempData(activeScenario);
      setResults(runSimulation(activeScenario));
    }
  }, [activeScenario]);

  const handleChange = (field: keyof typeof tempData, value: any) => {
    setTempData({ ...tempData, [field]: value });
  };

  const handleSave = () => {
    const scenario = { ...tempData, id: crypto.randomUUID() };
    addScenario(scenario);
    setDialogVisible(false);
  };

  const runSim = () => {
    if (activeScenario) {
      const res = runSimulation(activeScenario);
      setResults(res);
    }
  };

  const dialogFooter = (
    <div>
      <Button label="Cancel" icon="pi pi-times" onClick={() => setDialogVisible(false)} className="p-button-text" />
      <Button label="Save" icon="pi pi-check" onClick={handleSave} />
    </div>
  );

  return (
    <ContentContainer>
      <h1>Retirement Planner MVP</h1>
      <Button label="New Scenario" onClick={() => setDialogVisible(true)} />
      {results && <Projections results={results} />}
      <Dialog header="New Scenario" visible={dialogVisible} style={{ width: '50vw' }} onHide={() => setDialogVisible(false)} footer={dialogFooter}>
        <FormGrid>
          <div>
            <label>Scenario Name</label>
            <InputText value={tempData.name} onChange={(e) => handleChange('name', e.target.value)} />
          </div>
          <div>
            <label>Current Age</label>
            <InputNumber value={tempData.currentAge} onValueChange={(e) => handleChange('currentAge', e.value)} mode="decimal" />
          </div>
          <div>
            <label>Retirement Age</label>
            <InputNumber value={tempData.retirementAge} onValueChange={(e) => handleChange('retirementAge', e.value)} mode="decimal" />
          </div>
          <div>
            <label>Life Expectancy</label>
            <InputNumber value={tempData.lifeExpectancy} onValueChange={(e) => handleChange('lifeExpectancy', e.value)} mode="decimal" />
          </div>
          <div>
            <label>Current Savings</label>
            <InputNumber value={tempData.currentSavings} onValueChange={(e) => handleChange('currentSavings', e.value)} mode="currency" currency="USD" />
          </div>
          <div>
            <label>Annual Savings</label>
            <InputNumber value={tempData.annualSavings} onValueChange={(e) => handleChange('annualSavings', e.value)} mode="currency" currency="USD" />
          </div>
          <div>
            <label>Monthly Retirement Spending</label>
            <InputNumber value={tempData.monthlyRetirementSpending} onValueChange={(e) => handleChange('monthlyRetirementSpending', e.value)} mode="currency" currency="USD" />
          </div>
          <div>
            <label>Annual Social Security</label>
            <InputNumber value={tempData.ssAmount} onValueChange={(e) => handleChange('ssAmount', e.value)} mode="currency" currency="USD" />
          </div>
          <div>
            <label>Risk Level</label>
            <Dropdown value={tempData.riskLevel} options={riskOptions} onChange={(e) => handleChange('riskLevel', e.value)} />
          </div>
        </FormGrid>
      </Dialog>
    </ContentContainer>
  );
};

export default Content;