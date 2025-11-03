import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import type { Scenario } from '../types/Scenario';

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
`;

interface ScenarioDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (scenario: Scenario) => void;
  scenario?: Scenario;
}

const ScenarioDialog: React.FC<ScenarioDialogProps> = ({
  visible,
  onHide,
  onSave,
  scenario,
}) => {
  const [tempData, setTempData] = useState<Scenario>(() => ({
    id: '',
    name: '',
    currentAge: 40,
    retirementAge: 65,
    lifeExpectancy: 92,
    currentSavings: 100000,
    annualSavings: 20000,
    retirementSpending: {
      monthlyAmount: 5000,
      startAge: 65,
    },
    spendingGoals: [],
    incomeEvents: [
      {
        id: crypto.randomUUID(),
        type: 'social_security' as const,
        amount: 30000,
        startAge: 65,
        taxStatus: 'before_tax' as const,
        colaType: 'inflation_adjusted' as const,
        syncWithEstimate: true,
      },
    ],
    portfolioAssumptions: {
      riskLevel: 'moderate' as const,
    },
    referenceYear: new Date().getFullYear(),
    inflationRate: 0.035,
    // Legacy fields for backward compatibility
    monthlyRetirementSpending: 5000,
    ssAmount: 30000,
    riskLevel: 'moderate' as const,
  }));

  // Update tempData when scenario prop changes (for editing)
  useEffect(() => {
    if (scenario) {
      setTempData({
        ...scenario,
        // Ensure legacy fields are set
        monthlyRetirementSpending: scenario.retirementSpending.monthlyAmount,
        ssAmount:
          scenario.incomeEvents.find((e) => e.type === 'social_security')
            ?.amount || 30000,
        riskLevel: scenario.portfolioAssumptions.riskLevel as
          | 'conservative'
          | 'moderate'
          | 'high',
      });
    } else {
      // Reset to defaults when no scenario (for new scenario creation)
      setTempData({
        id: '',
        name: '',
        currentAge: 40,
        retirementAge: 65,
        lifeExpectancy: 92,
        currentSavings: 100000,
        annualSavings: 20000,
        retirementSpending: {
          monthlyAmount: 5000,
          startAge: 65,
        },
        spendingGoals: [],
        incomeEvents: [
          {
            id: crypto.randomUUID(),
            type: 'social_security' as const,
            amount: 30000,
            startAge: 65,
            taxStatus: 'before_tax' as const,
            colaType: 'inflation_adjusted' as const,
            syncWithEstimate: true,
          },
        ],
        portfolioAssumptions: {
          riskLevel: 'moderate' as const,
        },
        referenceYear: new Date().getFullYear(),
        inflationRate: 0.035,
        // Legacy fields for backward compatibility
        monthlyRetirementSpending: 5000,
        ssAmount: 30000,
        riskLevel: 'moderate' as const,
      });
    }
  }, [scenario]);

  const riskOptions = [
    { label: 'Conservative', value: 'conservative' },
    { label: 'Moderate', value: 'moderate' },
    { label: 'High', value: 'high' },
  ];

  const handleChange = (field: keyof typeof tempData, value: any) => {
    if (field === 'retirementSpending') {
      setTempData({ ...tempData, retirementSpending: value });
    } else {
      setTempData({ ...tempData, [field]: value });
    }
  };

  const handleSave = () => {
    const scenarioData = scenario
      ? { ...tempData, id: scenario.id } // Keep existing ID for edits
      : { ...tempData, id: crypto.randomUUID() }; // Generate new ID for creates
    onSave(scenarioData);
    onHide();
  };

  const dialogFooter = (
    <div>
      <Button
        label='Cancel'
        icon='pi pi-times'
        onClick={onHide}
        className='p-button-text'
      />
      <Button label='Save' icon='pi pi-check' onClick={handleSave} />
    </div>
  );

  return (
    <Dialog
      header={scenario ? 'Edit Scenario' : 'New Scenario'}
      visible={visible}
      style={{ width: '50vw' }}
      onHide={onHide}
      footer={dialogFooter}
    >
      <FormGrid>
        <div>
          <label>Scenario Name</label>
          <InputText
            value={tempData.name}
            onChange={(e) => handleChange('name', e.target.value)}
          />
        </div>
        <div>
          <label>Current Age</label>
          <InputNumber
            value={tempData.currentAge}
            onValueChange={(e) => handleChange('currentAge', e.value)}
            mode='decimal'
          />
        </div>
        <div>
          <label>Retirement Age</label>
          <InputNumber
            value={tempData.retirementAge}
            onValueChange={(e) => handleChange('retirementAge', e.value)}
            mode='decimal'
          />
        </div>
        <div>
          <label>Life Expectancy</label>
          <InputNumber
            value={tempData.lifeExpectancy}
            onValueChange={(e) => handleChange('lifeExpectancy', e.value)}
            mode='decimal'
          />
        </div>
        <div>
          <label>Current Savings</label>
          <InputNumber
            value={tempData.currentSavings}
            onValueChange={(e) => handleChange('currentSavings', e.value)}
            mode='currency'
            currency='USD'
          />
        </div>
        <div>
          <label>Annual Savings</label>
          <InputNumber
            value={tempData.annualSavings}
            onValueChange={(e) => handleChange('annualSavings', e.value)}
            mode='currency'
            currency='USD'
          />
        </div>
        <div>
          <label>Monthly Retirement Spending</label>
          <InputNumber
            value={tempData.retirementSpending.monthlyAmount}
            onValueChange={(e) =>
              handleChange('retirementSpending', {
                ...tempData.retirementSpending,
                monthlyAmount: e.value,
              })
            }
            mode='currency'
            currency='USD'
          />
        </div>
        <div>
          <label>Retirement Spending Start Age</label>
          <InputNumber
            value={tempData.retirementSpending.startAge}
            onValueChange={(e) =>
              handleChange('retirementSpending', {
                ...tempData.retirementSpending,
                startAge: e.value,
              })
            }
            mode='decimal'
          />
        </div>
        <div>
          <label>Risk Level</label>
          <Dropdown
            value={tempData.riskLevel}
            options={riskOptions}
            onChange={(e) => handleChange('riskLevel', e.value)}
          />
        </div>
        <div>
          <label>Inflation Rate (%)</label>
          <InputNumber
            value={tempData.inflationRate * 100}
            onValueChange={(e) =>
              handleChange('inflationRate', (e.value || 0) / 100)
            }
            mode='decimal'
            min={0}
            max={20}
            suffix='%'
          />
        </div>
      </FormGrid>
    </Dialog>
  );
};

export default ScenarioDialog;
