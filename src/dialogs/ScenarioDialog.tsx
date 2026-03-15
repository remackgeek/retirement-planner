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
  lifeExpectancy: 92,
  currentSavings: 100000,
  spendingGoals: [],
  incomeEvents: [],
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
  isFirstScenario?: boolean;
}

const ScenarioDialog: React.FC<ScenarioDialogProps> = ({
  visible,
  onHide,
  onSave,
  scenario,
  isFirstScenario,
}) => {
  const [tempData, setTempData] = useState<Scenario>(makeDefaults);

  useEffect(() => {
    setTempData(scenario ? { ...scenario } : makeDefaults());
  }, [scenario]);

  const handleChange = (field: keyof Scenario, value: any) => {
    setTempData({ ...tempData, [field]: value });
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

  const isValid =
    tempData.name.trim().length > 0 &&
    tempData.currentAge >= 18 &&
    tempData.currentAge <= 100 &&
    tempData.lifeExpectancy > tempData.currentAge &&
    tempData.lifeExpectancy <= 120 &&
    tempData.currentSavings >= 0;

  const handleSave = () => {
    if (!isValid) return;
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
      {!isFirstScenario && (
        <Button
          label='Cancel'
          icon='pi pi-times'
          onClick={onHide}
          className='p-button-text'
        />
      )}
      <Button
        label='Save'
        icon='pi pi-check'
        onClick={handleSave}
        disabled={!isValid}
      />
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
              className={tempData.name.trim().length === 0 ? 'p-invalid' : ''}
            />
          </FullWidthField>

          <FieldGroup>
            <label>Current Age</label>
            <InputNumber
              value={tempData.currentAge}
              onValueChange={(e) => handleChange('currentAge', e.value)}
              mode='decimal'
              min={18}
              max={100}
            />
          </FieldGroup>
          <FieldGroup>
            <label>Life Expectancy</label>
            <InputNumber
              value={tempData.lifeExpectancy}
              onValueChange={(e) => handleChange('lifeExpectancy', e.value)}
              mode='decimal'
              min={(tempData.currentAge || 18) + 1}
              max={120}
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
              min={0}
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
