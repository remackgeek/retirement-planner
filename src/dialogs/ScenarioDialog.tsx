import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import type { Scenario } from '../types/Scenario';
import { spacing, colors, fontSize, border } from '../styles/theme';

const SectionGroup = styled.div`
  margin-bottom: ${spacing.md};

  &:last-child {
    margin-bottom: 0;
  }
`;

const SectionLabel = styled.h4`
  margin: 0 0 ${spacing.sm} 0;
  font-size: ${fontSize.sm};
  font-weight: 600;
  color: ${colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: ${border.light};
  padding-bottom: ${spacing.xs};
`;

const SectionGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing.md} ${spacing.lg};
`;

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};

  label {
    font-size: ${fontSize.sm};
    color: ${colors.textPrimary};
  }

  .p-inputtext,
  .p-dropdown,
  .p-inputnumber {
    width: 100%;
  }
`;

const FullWidthField = styled(FieldGroup)`
  grid-column: 1 / -1;
`;

const filingStatusOptions = [
  { label: 'Single', value: 'single' },
  { label: 'Married Filing Jointly', value: 'mfj' },
  { label: 'Married Filing Separately', value: 'mfs' },
  { label: 'Head of Household', value: 'hoh' },
];

const riskOptions = [
  { label: 'Conservative', value: 'conservative' },
  { label: 'Balanced', value: 'balanced' },
  { label: 'Aggressive', value: 'aggressive' },
];

const stateOptions = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
  'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming', 'Washington, DC',
].map((s) => ({ label: s, value: s }));

const makeDefaults = (): Scenario => ({
  id: '',
  name: '',
  currentAge: 40,
  retirementAge: 65,
  lifeExpectancy: 92,
  currentSavings: 100000,
  annualSavings: 20000,
  retirementSpending: { monthlyAmount: 5000, startAge: 65 },
  spendingGoals: [],
  incomeEvents: [
    {
      id: crypto.randomUUID(),
      type: 'social_security' as const,
      amount: 30000,
      startAge: 65,
      taxStatus: 'before_tax' as const,
      colaType: 'inflation_adjusted' as const,
      ssAmountBasis: 'today' as const,
      ssHaircutEnabled: true,
      ssHaircutPercent: 23,
    },
  ],
  portfolioAssumptions: { riskLevel: 'balanced' as const },
  referenceYear: new Date().getFullYear(),
  inflationRate: 0.035,
  filingStatus: 'single' as const,
  spouseName: null,
  spouseAge: null,
  state: 'California',
});

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
  const [tempData, setTempData] = useState<Scenario>(makeDefaults);

  useEffect(() => {
    setTempData(scenario ? { ...scenario } : makeDefaults());
  }, [scenario]);

  const handleChange = (field: keyof Scenario, value: any) => {
    if (field === 'retirementSpending') {
      setTempData({ ...tempData, retirementSpending: value });
    } else {
      setTempData({ ...tempData, [field]: value });
    }
  };

  const handleFilingStatusChange = (value: Scenario['filingStatus']) => {
    if (value !== 'mfj') {
      setTempData({
        ...tempData,
        filingStatus: value,
        spouseName: null,
        spouseAge: null,
        incomeEvents: tempData.incomeEvents.filter((e) => e.owner !== 'spouse'),
      });
    } else {
      setTempData({ ...tempData, filingStatus: value });
    }
  };

  const handleSave = () => {
    const spouseName = tempData.spouseName?.trim() || null;
    const scenarioData = scenario
      ? { ...tempData, id: scenario.id, spouseName }
      : { ...tempData, id: crypto.randomUUID(), spouseName };
    onSave(scenarioData);
    onHide();
  };

  const isMfj = tempData.filingStatus === 'mfj';

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
      style={{ width: '40rem' }}
      onHide={onHide}
      footer={dialogFooter}
    >
      {/* People */}
      <SectionGroup>
        <SectionLabel>People</SectionLabel>
        <SectionGrid>
          <FullWidthField>
            <label>Scenario Name</label>
            <InputText
              value={tempData.name}
              onChange={(e) => handleChange('name', e.target.value)}
            />
          </FullWidthField>

          <FieldGroup>
            <label>Current Age</label>
            <InputNumber
              value={tempData.currentAge}
              onValueChange={(e) => handleChange('currentAge', e.value)}
              mode='decimal'
            />
          </FieldGroup>
          <FieldGroup>
            <label>Retirement Age</label>
            <InputNumber
              value={tempData.retirementAge}
              onValueChange={(e) => handleChange('retirementAge', e.value)}
              mode='decimal'
            />
          </FieldGroup>

          <FieldGroup>
            <label>Life Expectancy</label>
            <InputNumber
              value={tempData.lifeExpectancy}
              onValueChange={(e) => handleChange('lifeExpectancy', e.value)}
              mode='decimal'
            />
          </FieldGroup>
          <FieldGroup>
            <label>Filing Status</label>
            <Dropdown
              value={tempData.filingStatus}
              options={filingStatusOptions}
              onChange={(e) => handleFilingStatusChange(e.value)}
            />
          </FieldGroup>

          {isMfj && (
            <>
              <FieldGroup>
                <label>Spouse Name</label>
                <InputText
                  value={tempData.spouseName || ''}
                  onChange={(e) => handleChange('spouseName', e.target.value || null)}
                />
              </FieldGroup>
              <FieldGroup>
                <label>Spouse Age</label>
                <InputNumber
                  value={tempData.spouseAge ?? undefined}
                  onValueChange={(e) => handleChange('spouseAge', e.value ?? null)}
                  mode='decimal'
                  min={18}
                  max={120}
                />
              </FieldGroup>
            </>
          )}
        </SectionGrid>
      </SectionGroup>

      {/* Finances */}
      <SectionGroup>
        <SectionLabel>Finances</SectionLabel>
        <SectionGrid>
          <FieldGroup>
            <label>Current Savings</label>
            <InputNumber
              value={tempData.currentSavings}
              onValueChange={(e) => handleChange('currentSavings', e.value)}
              mode='currency'
              currency='USD'
            />
          </FieldGroup>
          <FieldGroup>
            <label>Annual Savings</label>
            <InputNumber
              value={tempData.annualSavings}
              onValueChange={(e) => handleChange('annualSavings', e.value)}
              mode='currency'
              currency='USD'
            />
          </FieldGroup>

          <FieldGroup>
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
          </FieldGroup>
          <FieldGroup>
            <label>Spending Start Age</label>
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
          </FieldGroup>

          <FieldGroup>
            <label>Inflation Rate</label>
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
          </FieldGroup>
        </SectionGrid>
      </SectionGroup>

      {/* Portfolio & Tax */}
      <SectionGroup>
        <SectionLabel>Portfolio & Tax</SectionLabel>
        <SectionGrid>
          <FieldGroup>
            <label>Risk Level</label>
            <Dropdown
              value={tempData.portfolioAssumptions.riskLevel}
              options={riskOptions}
              onChange={(e) =>
                setTempData({
                  ...tempData,
                  portfolioAssumptions: {
                    ...tempData.portfolioAssumptions,
                    riskLevel: e.value,
                  },
                })
              }
            />
          </FieldGroup>
          <FieldGroup>
            <label>State</label>
            <Dropdown
              value={tempData.state}
              options={stateOptions}
              onChange={(e) => handleChange('state', e.value)}
            />
          </FieldGroup>
        </SectionGrid>
      </SectionGroup>
    </Dialog>
  );
};

export default ScenarioDialog;
