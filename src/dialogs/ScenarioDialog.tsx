import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import type { Scenario } from '../types/Scenario';
import { spacing, colors, fontSize, border } from '../styles/theme';

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

const TimelineCard = styled.div`
  margin-top: ${spacing.xl};
  padding: ${spacing.sm};
  background: ${colors.bgLight};
  border: ${border.light};
  border-radius: ${border.radius};
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
  overflow: hidden;
`;

const TimelineLabel = styled.h4`
  margin: 0 0 ${spacing.xs} 0;
  font-size: ${fontSize.sm};
  font-weight: 600;
  color: ${colors.textSecondary};
`;

const TimelineRow = styled.div`
  display: flex;
  align-items: center;
  gap: 2.5rem;
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
`;

const TimelineHeader = styled.div`
  display: flex;
  gap: 2.5rem;
  font-size: ${fontSize.xs};
  font-weight: 600;
  color: ${colors.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.03em;
`;

const TimelineYearSection = styled.div`
  width: 8rem;
  flex-shrink: 0;

  .p-dropdown {
    width: 100%;
  }
`;

const AddRelocationButton = styled(Button)`
  align-self: flex-start;
  font-size: ${fontSize.sm} !important;
`;

const filingStatusOptions = [
  { label: 'Single', value: 'single' },
  { label: 'Married Filing Jointly', value: 'mfj' },
  { label: 'Married Filing Separately', value: 'mfs' },
  { label: 'Head of Household', value: 'hoh' },
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
  accounts: [],
  spendingGoals: [],
  incomeEvents: [],
  portfolioAssumptions: {
    portfolioBalance: '60_40' as const,
    stockAllocation: 0.60,
    stockReturn: 0.07,
    stockStdDev: 0.15,
    bondReturn: 0.03,
    bondStdDev: 0.05,
    stockBondCorrelationEnabled: true,
    stockBondCorrelation: -0.2,
  },
  referenceYear: new Date().getFullYear(),
  inflationRate: 0.035,
  inflationStdDev: 0.01,
  simulationSettings: { numSimulations: 5000 },
  filingStatus: 'single' as const,
  spouseAge: null,
  stateTimeline: [{ state: 'California' }],
  longTermCapGainsRate: 0.15,
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
    setTempData({ ...tempData, [field]: value });
  };

  const handleFilingStatusChange = (value: Scenario['filingStatus']) => {
    if (value !== 'mfj') {
      setTempData({
        ...tempData,
        filingStatus: value,
        spouseAge: null,
        incomeEvents: tempData.incomeEvents.filter((e) => e.owner !== 'spouse'),
      });
    } else {
      setTempData({ ...tempData, filingStatus: value });
    }
  };

  const isMfj = tempData.filingStatus === 'mfj';

  const isValid =
    tempData.name.trim().length > 0 &&
    tempData.currentAge >= 18 &&
    tempData.currentAge <= 100 &&
    tempData.lifeExpectancy > tempData.currentAge &&
    tempData.lifeExpectancy <= 120 &&
    (!isMfj || (tempData.spouseAge !== null && tempData.spouseAge >= 18 && tempData.spouseAge <= 100));

  const handleSave = () => {
    if (!isValid) return;
    const scenarioData = scenario
      ? { ...tempData, id: scenario.id }
      : { ...tempData, id: crypto.randomUUID() };
    onSave(scenarioData);
    onHide();
  };

  const yearOptions = Array.from({ length: 41 }, (_, i) => {
    const y = tempData.referenceYear + i;
    return { label: String(y), value: y };
  });

  const dialogFooter = (
    <div>
      <Button
        label='Cancel'
        icon='pi pi-times'
        onClick={onHide}
        className='p-button-text'
      />
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
      header={
        <>
          <i className="pi pi-chart-bar" style={{ marginRight: spacing.sm, color: colors.primary }} />
          {scenario ? 'Edit Scenario' : 'New Scenario'}
        </>
      }
      visible={visible}
      style={{ width: '40rem' }}
      onHide={onHide}
      footer={dialogFooter}
    >
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
          <FieldGroup>
            <label>Spouse Age *</label>
            <InputNumber
              value={tempData.spouseAge ?? undefined}
              onValueChange={(e) => handleChange('spouseAge', e.value ?? null)}
              mode='decimal'
              min={18}
              max={100}
              className={tempData.spouseAge === null ? 'p-invalid' : ''}
            />
          </FieldGroup>
        )}

        {tempData.stateTimeline.length === 1 && (
          <FieldGroup>
            <label>State</label>
            <Dropdown
              value={tempData.stateTimeline[0]?.state ?? 'California'}
              options={stateOptions}
              onChange={(e) => {
                const updated = [...tempData.stateTimeline];
                updated[0] = { ...updated[0], state: e.value };
                setTempData({ ...tempData, stateTimeline: updated });
              }}
            />
            <AddRelocationButton
              className='p-button-text p-button-sm'
              icon='pi pi-plus'
              label='Add relocation'
              onClick={() => {
                const currentState = tempData.stateTimeline[0]?.state ?? 'California';
                setTempData({
                  ...tempData,
                  stateTimeline: [
                    ...tempData.stateTimeline,
                    { state: currentState, startYear: tempData.referenceYear + 5 },
                  ],
                });
              }}
            />
          </FieldGroup>
        )}
      </SectionGrid>

      {tempData.stateTimeline.length > 1 && (
        <TimelineCard>
          <TimelineLabel>State Residence Timeline</TimelineLabel>
          <TimelineHeader>
            <span style={{ width: '12rem' }}>State</span>
            <span>Year</span>
          </TimelineHeader>
          {tempData.stateTimeline.map((entry, idx) => (
            <TimelineRow key={idx}>
              <Dropdown
                value={entry.state}
                options={stateOptions}
                onChange={(e) => {
                  const updated = [...tempData.stateTimeline];
                  updated[idx] = { ...updated[idx], state: e.value };
                  setTempData({ ...tempData, stateTimeline: updated });
                }}
                style={{ width: '12rem' }}
              />
              <TimelineYearSection>
                {idx === 0 ? (
                  <span>current</span>
                ) : (
                  <Dropdown
                    value={entry.startYear ?? tempData.referenceYear}
                    options={yearOptions}
                    onChange={(e) => {
                      const updated = [...tempData.stateTimeline];
                      updated[idx] = { ...updated[idx], startYear: e.value };
                      const base = updated[0];
                      const relocations = updated.slice(1).sort(
                        (a, b) => (a.startYear ?? 0) - (b.startYear ?? 0)
                      );
                      setTempData({ ...tempData, stateTimeline: [base, ...relocations] });
                    }}
                  />
                )}
              </TimelineYearSection>
              {idx > 0 && (
                <Button
                  icon='pi pi-trash'
                  className='p-button-text p-button-sm p-button-danger'
                  onClick={() => {
                    const updated = tempData.stateTimeline.filter((_, i) => i !== idx);
                    setTempData({ ...tempData, stateTimeline: updated });
                  }}
                  style={{ padding: spacing.xs, flexShrink: 0 }}
                />
              )}
            </TimelineRow>
          ))}
          <AddRelocationButton
            className='p-button-text p-button-sm'
            icon='pi pi-plus'
            label='Add relocation'
            onClick={() => {
              const currentState = tempData.stateTimeline[0]?.state ?? 'California';
              const lastYear =
                (tempData.stateTimeline[tempData.stateTimeline.length - 1].startYear ?? tempData.referenceYear) + 5;
              setTempData({
                ...tempData,
                stateTimeline: [
                  ...tempData.stateTimeline,
                  { state: currentState, startYear: lastYear },
                ],
              });
            }}
          />
        </TimelineCard>
      )}
    </Dialog>
  );
};

export default ScenarioDialog;
