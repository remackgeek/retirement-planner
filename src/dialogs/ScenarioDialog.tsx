import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { InputNumber } from 'primereact/inputnumber';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { Checkbox } from 'primereact/checkbox';
import { Tooltip as PrimeTooltip } from 'primereact/tooltip';
import type { Scenario } from '../types/Scenario';
import { spacing, colors, fontSize, border, dialogWidth } from '../styles/theme';
import { SELECTABLE_STATES, getStateTaxProfile } from '../data/stateTaxProfiles';
import { currentCalendarYear } from '../utils/rollScenarioYear';

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

// State list now sourced from the per-state profile registry (includes "New York City"
// as a pseudo-state with NYC local tax). Successor variants ("South Carolina (2027+)",
// "West Virginia (2026+)") are filtered out of the dropdown.
const stateOptions = SELECTABLE_STATES.map((s) => ({ label: s, value: s }));

const makeDefaults = (): Scenario => ({
  id: '',
  name: '',
  currentAge: 40,
  lifeExpectancy: 92,
  accounts: [],
  spendingGoals: [],
  incomeEvents: [],
  portfolioAssumptions: {
    stockReturn: 0.085,
    stockStdDev: 0.16,
    bondReturn: 0.048,
    bondStdDev: 0.06,
    stockBondCorrelationEnabled: true,
    stockBondCorrelation: -0.2,
    returnDistribution: 'lognormal' as const,
    degreesOfFreedom: 4,
    returnModel: 'parametric' as const,
  },
  referenceYear: currentCalendarYear(),
  inflationRate: 0.03,
  inflationStdDev: 0.012,
  simulationSettings: { numSimulations: 1000 },
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
    if (visible) setTempData(scenario ? { ...scenario } : makeDefaults());
    // Initialize form state only when the dialog opens (false→true). The
    // Sidebar sets `editingScenario` (this `scenario` prop) in the same
    // handler that flips `visible`, so the open-time run always sees the
    // right create-vs-edit target. `scenario` is deliberately NOT a dep: the
    // automatic ~1s lastSuccessProbability write-back replaces the scenario
    // object identity while the dialog is open, and re-running this effect
    // then would wipe the user's in-progress edits. Same pattern as
    // SocialSecurityWizardDialog's open-gated effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Draft state may transiently hold null for cleared numeric inputs
  // (PrimeReact InputNumber emits null mid-edit), so the value is wider than
  // the field's persisted type — hence the cast rather than Scenario[K].
  const handleChange = (field: keyof Scenario, value: unknown) => {
    setTempData({ ...tempData, [field]: value } as Scenario);
  };

  const handleFilingStatusChange = (value: Scenario['filingStatus']) => {
    if (value !== 'mfj') {
      setTempData({
        ...tempData,
        filingStatus: value,
        spouseAge: null,
        spouseLifeExpectancy: null,
        incomeEvents: tempData.incomeEvents.filter((e) => e.owner !== 'spouse'),
      });
    } else {
      setTempData({ ...tempData, filingStatus: value });
    }
  };

  const isMfj = tempData.filingStatus === 'mfj';

  // Spouse Life Expectancy is optional, but if provided it must exceed the spouse's
  // current age (otherwise the widow's-penalty model silently treats it as "off").
  // Surface that as a validation error rather than letting it pass unnoticed.
  const spouseLEInvalid =
    isMfj &&
    tempData.spouseAge !== null &&
    tempData.spouseLifeExpectancy != null &&
    (tempData.spouseLifeExpectancy <= tempData.spouseAge || tempData.spouseLifeExpectancy > 120);

  const isValid =
    tempData.name.trim().length > 0 &&
    tempData.currentAge >= 18 &&
    tempData.currentAge <= 100 &&
    tempData.lifeExpectancy > tempData.currentAge &&
    tempData.lifeExpectancy <= 120 &&
    (!isMfj || (tempData.spouseAge !== null && tempData.spouseAge >= 18 && tempData.spouseAge <= 100)) &&
    !spouseLEInvalid;

  const handleSave = () => {
    if (!isValid) return;
    // `tempData` is a snapshot taken when the dialog OPENED (the init effect is
    // gated on `visible` so live scenario churn can't wipe in-progress edits).
    // That makes it stale for the sidebar's display cache: the ~1s MC
    // write-back may have stamped a fresh probability while the dialog sat
    // open. Take that one field from the live `scenario` prop instead, or a
    // no-op Save would revert the % — and since the sim fingerprint ignores it,
    // nothing would recompute it until the next real edit.
    const scenarioData = scenario
      ? { ...tempData, id: scenario.id, lastSuccessProbability: scenario.lastSuccessProbability }
      : { ...tempData, id: crypto.randomUUID() };
    onSave(scenarioData);
    onHide();
  };

  const buildRelocationYearOptions = (minYear: number) =>
    Array.from({ length: tempData.referenceYear + 40 - minYear + 1 }, (_, i) => {
      const y = minYear + i;
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
      style={dialogWidth('40rem')}
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
            <InputText
              value={tempData.spouseAge !== null ? String(tempData.spouseAge) : ''}
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = parseInt(raw, 10);
                handleChange('spouseAge', raw === '' ? null : isNaN(parsed) ? null : parsed);
              }}
              keyfilter='pint'
              className={tempData.spouseAge === null ? 'p-invalid' : ''}
            />
          </FieldGroup>
        )}

        {isMfj && tempData.spouseAge !== null && (
          <FieldGroup>
            <label>Spouse Life Expectancy</label>
            <InputNumber
              value={tempData.spouseLifeExpectancy ?? null}
              onValueChange={(e) => handleChange('spouseLifeExpectancy', e.value ?? null)}
              mode='decimal'
              min={(tempData.spouseAge || 18) + 1}
              max={120}
              placeholder='Optional'
              className={spouseLEInvalid ? 'p-invalid' : ''}
            />
            <div style={{ fontSize: fontSize.xs, color: spouseLEInvalid ? colors.danger : colors.textMuted, lineHeight: 1.4 }}>
              {spouseLEInvalid
                ? `Must be greater than the spouse's age (${tempData.spouseAge}) and at most 120.`
                : `Optional. When set, models the survivor "widow's penalty": at the first death the survivor files as single (compressed brackets, lower IRMAA tiers) and keeps the larger Social Security benefit. Leave blank to skip.`}
            </div>
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
            {(() => {
              const sn = tempData.stateTimeline[0]?.state ?? 'California';
              const p = getStateTaxProfile(sn, tempData.referenceYear).profile;
              return p.summary ? (
                <div style={{ fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 1.4 }}>
                  {p.summary}
                </div>
              ) : null;
            })()}
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
                    options={buildRelocationYearOptions(
                      (tempData.stateTimeline[idx - 1].startYear ?? tempData.referenceYear) + 1
                    )}
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

      {/* Scenario-level override: applies across the entire timeline. Shown when
          ANY profile in the timeline has a non-`none` retirement exclusion. */}
      {tempData.stateTimeline.some((entry) => {
        const p = getStateTaxProfile(entry.state, tempData.referenceYear).profile;
        return p.retirementExclusion.kind !== 'none';
      }) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm }}>
          <Checkbox
            inputId="scenario-state-exclusion-override"
            checked={tempData.disableStateRetirementExclusion === true}
            onChange={(e) => setTempData({
              ...tempData,
              disableStateRetirementExclusion: e.checked ? true : undefined,
            })}
          />
          <label
            htmlFor="scenario-state-exclusion-override"
            className="scn-exclusion-override-tip"
            style={{ fontSize: fontSize.xs, color: colors.textMuted, cursor: 'pointer' }}
          >
            Disable state retirement-income exclusion (advanced)
          </label>
          <PrimeTooltip target=".scn-exclusion-override-tip" position="bottom" showDelay={150}>
            <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
              Some state retirement-income exclusions apply only to specific income sources
              (e.g. public pensions, defined-benefit plans). If your Traditional withdrawals
              don't qualify under your state's actual rule, check this to expose them fully
              to state ordinary brackets. Applies to every state in the timeline.
            </div>
          </PrimeTooltip>
        </div>
      )}

    </Dialog>
  );
};

export default ScenarioDialog;
