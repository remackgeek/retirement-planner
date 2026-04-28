import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import type { Scenario } from '../types/Scenario';
import type { SimulationSettings } from '../types/UserData';
import type { ReturnDistribution, ReturnModel, BlackSwanEvent } from '../types/IncomeEvent';
import { spacing, colors, fontSize, border } from '../styles/theme';
import BlackSwanEventsEditor from './BlackSwanEventsEditor';
import {
  HISTORICAL_FIRST_YEAR,
  HISTORICAL_LAST_YEAR,
  HISTORICAL_YEARS,
} from '../data/historicalReturns';

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  padding: ${spacing.sm} 0;
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

const SectionHeader = styled.div`
  font-size: ${fontSize.sm};
  font-weight: 600;
  color: ${colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-bottom: ${spacing.xs};
  border-bottom: ${border.light};
  margin-bottom: ${spacing.xs};
`;

const FieldRow = styled.div`
  display: flex;
  gap: ${spacing.md};
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};

  label {
    font-size: ${fontSize.sm};
    color: ${colors.textPrimary};
  }
`;

const AssetRow = styled.div`
  display: flex;
  gap: ${spacing.md};
  align-items: flex-end;
`;

const AssetLabel = styled.div`
  flex: 0 0 4rem;
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
  padding-bottom: 0.4rem;
`;

const ColumnHeader = styled.div`
  width: 8rem;
  font-size: ${fontSize.sm};
  color: ${colors.textPrimary};
`;

const BlendedRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.xs};
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
  padding-top: ${spacing.xs};
  margin-bottom: ${spacing.md};
`;

const BlendedValue = styled.span`
  font-weight: 600;
  color: ${colors.textPrimary};
`;

const HelpText = styled.div`
  font-size: ${fontSize.xs};
  color: ${colors.textSecondary};
`;

const simRunOptions = [
  { label: '1,000 (fast)', value: 1000 },
  { label: '5,000 (standard)', value: 5000 },
  { label: '10,000 (accurate)', value: 10000 },
];

const distributionOptions: { label: string; value: ReturnDistribution }[] = [
  { label: 'Log-normal', value: 'lognormal' },
  { label: "Student's t (fat tails)", value: 'student_t' },
];

const returnModelOptions: { label: string; value: ReturnModel }[] = [
  { label: 'Parametric (random draws)', value: 'parametric' },
  { label: 'Historical: Single Sequence', value: 'historical_single' },
  { label: 'Historical: Rolling Start', value: 'historical_rolling' },
  { label: 'Historical: Block Bootstrap', value: 'historical_bootstrap' },
];

const blockSizeOptions = [
  { label: '1 year (year shuffle)', value: 1 },
  { label: '3 years', value: 3 },
  { label: '5 years', value: 5 },
  { label: '10 years', value: 10 },
];

// Years 1928–2024, descending (most recent first).
const historicalStartYearOptions: { label: string; value: number }[] = Array.from(
  { length: HISTORICAL_YEARS },
  (_, i) => HISTORICAL_LAST_YEAR - i
).map((y) => ({ label: String(y), value: y }));

interface ModelingDialogProps {
  visible: boolean;
  onHide: () => void;
  scenario: Scenario;
  onSave: (updated: Scenario) => void;
}

interface FormState {
  stockReturn: number;
  stockStdDev: number;
  bondReturn: number;
  bondStdDev: number;
  stockBondCorrelationEnabled: boolean;
  stockBondCorrelation: number;
  returnDistribution: ReturnDistribution;
  degreesOfFreedom: number;
  returnModel: ReturnModel;
  historicalStartYear: number;
  historicalWrapEnabled: boolean;
  historicalBlockSize: number;
  inflationRate: number;
  inflationStdDev: number;
  longTermCapGainsRate: number;
  simulationSettings: SimulationSettings;
  blackSwanEvents: BlackSwanEvent[];
}

const ModelingDialog: React.FC<ModelingDialogProps> = ({
  visible,
  onHide,
  scenario,
  onSave,
}) => {
  const formFromScenario = (s: Scenario): FormState => ({
    stockReturn: s.portfolioAssumptions.stockReturn,
    stockStdDev: s.portfolioAssumptions.stockStdDev,
    bondReturn: s.portfolioAssumptions.bondReturn,
    bondStdDev: s.portfolioAssumptions.bondStdDev,
    stockBondCorrelationEnabled: s.portfolioAssumptions.stockBondCorrelationEnabled,
    stockBondCorrelation: s.portfolioAssumptions.stockBondCorrelation,
    returnDistribution: s.portfolioAssumptions.returnDistribution,
    degreesOfFreedom: s.portfolioAssumptions.degreesOfFreedom,
    returnModel: s.portfolioAssumptions.returnModel ?? 'parametric',
    historicalStartYear: s.portfolioAssumptions.historicalStartYear ?? 1966,
    historicalWrapEnabled: s.portfolioAssumptions.historicalWrapEnabled ?? false,
    historicalBlockSize: s.portfolioAssumptions.historicalBlockSize ?? 5,
    inflationRate: s.inflationRate,
    inflationStdDev: s.inflationStdDev,
    longTermCapGainsRate: s.longTermCapGainsRate,
    simulationSettings: { ...s.simulationSettings },
    blackSwanEvents: s.portfolioAssumptions.blackSwanEvents
      ? s.portfolioAssumptions.blackSwanEvents.map((e) => ({ ...e }))
      : [],
  });

  const [form, setForm] = useState<FormState>(() => formFromScenario(scenario));

  useEffect(() => {
    if (visible) setForm(formFromScenario(scenario));
  }, [visible, scenario]);

  const totalBalance = scenario.accounts.reduce((s, a) => s + a.balance, 0);
  const weightedStockAlloc = scenario.accounts.length === 0
    ? 0.6
    : totalBalance > 0
      ? scenario.accounts.reduce((s, a) => s + a.stockAllocation * a.balance, 0) / totalBalance
      : scenario.accounts.reduce((s, a) => s + a.stockAllocation, 0) / scenario.accounts.length;
  const blendedReturn = weightedStockAlloc * form.stockReturn + (1 - weightedStockAlloc) * form.bondReturn;

  const handleSave = () => {
    const isHistorical = form.returnModel !== 'parametric';
    onSave({
      ...scenario,
      inflationRate: form.inflationRate,
      inflationStdDev: form.inflationStdDev,
      longTermCapGainsRate: form.longTermCapGainsRate,
      simulationSettings: form.simulationSettings,
      portfolioAssumptions: {
        ...scenario.portfolioAssumptions,
        stockReturn: form.stockReturn,
        stockStdDev: form.stockStdDev,
        bondReturn: form.bondReturn,
        bondStdDev: form.bondStdDev,
        stockBondCorrelationEnabled: form.stockBondCorrelationEnabled,
        stockBondCorrelation: form.stockBondCorrelation,
        returnDistribution: form.returnDistribution,
        degreesOfFreedom: form.degreesOfFreedom,
        returnModel: isHistorical ? form.returnModel : undefined,
        historicalStartYear:
          form.returnModel === 'historical_single' ? form.historicalStartYear : undefined,
        historicalWrapEnabled:
          form.returnModel === 'historical_single' || form.returnModel === 'historical_rolling'
            ? form.historicalWrapEnabled
            : undefined,
        historicalBlockSize:
          form.returnModel === 'historical_bootstrap' ? form.historicalBlockSize : undefined,
        blackSwanEvents: form.blackSwanEvents.length > 0 ? form.blackSwanEvents : undefined,
      },
    });
    onHide();
  };

  const dialogFooter = (
    <div>
      <Button label="Cancel" icon="pi pi-times" onClick={onHide} className="p-button-text" />
      <Button label="Save" icon="pi pi-check" onClick={handleSave} />
    </div>
  );

  const isHistorical = form.returnModel !== 'parametric';
  const horizon = scenario.lifeExpectancy - scenario.currentAge + 1;
  const rollingRunCount = form.historicalWrapEnabled
    ? HISTORICAL_YEARS
    : Math.max(1, HISTORICAL_YEARS - horizon + 1);

  const pctField = (
    value: number,
    onChange: (v: number) => void,
    max = 50,
    disabled = false
  ) => (
    <InputNumber
      value={value * 100}
      onValueChange={(e) => onChange((e.value ?? 0) / 100)}
      mode="decimal"
      minFractionDigits={1}
      maxFractionDigits={1}
      min={0}
      max={max}
      suffix="%"
      inputStyle={{ width: '8rem' }}
      disabled={disabled}
    />
  );

  return (
    <Dialog
      header="Modeling"
      visible={visible}
      style={{ width: '28rem' }}
      onHide={onHide}
      footer={dialogFooter}
    >
      <Form onSubmit={(e) => e.preventDefault()}>

        <Section>
          <SectionHeader>Return Model</SectionHeader>
          <InputGroup>
            <Dropdown
              value={form.returnModel}
              options={returnModelOptions}
              onChange={(e) => setForm({ ...form, returnModel: e.value })}
              style={{ width: '100%' }}
            />
          </InputGroup>

          {form.returnModel === 'historical_single' && (
            <>
              <FieldRow>
                <InputGroup>
                  <label>Start Year</label>
                  <Dropdown
                    value={form.historicalStartYear}
                    options={historicalStartYearOptions}
                    onChange={(e) => setForm({ ...form, historicalStartYear: e.value })}
                    filter
                    style={{ width: '8rem' }}
                  />
                </InputGroup>
              </FieldRow>
              <AssetRow>
                <Checkbox
                  inputId="historical-wrap-single"
                  checked={form.historicalWrapEnabled}
                  onChange={(e) => setForm({ ...form, historicalWrapEnabled: !!e.checked })}
                />
                <label
                  htmlFor="historical-wrap-single"
                  style={{ fontSize: fontSize.sm, cursor: 'pointer' }}
                >
                  Wrap to {HISTORICAL_FIRST_YEAR} when the series ends
                </label>
              </AssetRow>
              <HelpText>
                Walks one fixed slice of recorded history paired with that year's CPI.
                Single deterministic run.
              </HelpText>
            </>
          )}

          {form.returnModel === 'historical_rolling' && (
            <>
              <AssetRow>
                <Checkbox
                  inputId="historical-wrap-rolling"
                  checked={form.historicalWrapEnabled}
                  onChange={(e) => setForm({ ...form, historicalWrapEnabled: !!e.checked })}
                />
                <label
                  htmlFor="historical-wrap-rolling"
                  style={{ fontSize: fontSize.sm, cursor: 'pointer' }}
                >
                  Wrap to {HISTORICAL_FIRST_YEAR} when the series ends
                </label>
              </AssetRow>
              <HelpText>
                Trinity-style. One run per valid start year in {HISTORICAL_FIRST_YEAR}–
                {HISTORICAL_LAST_YEAR}. {form.historicalWrapEnabled
                  ? `${rollingRunCount} runs (every start year wraps).`
                  : `${rollingRunCount} runs (start years where the full ${horizon}-year horizon fits).`}
              </HelpText>
            </>
          )}

          {form.returnModel === 'historical_bootstrap' && (
            <>
              <InputGroup>
                <label>Block Size</label>
                <Dropdown
                  value={form.historicalBlockSize}
                  options={blockSizeOptions}
                  onChange={(e) => setForm({ ...form, historicalBlockSize: e.value })}
                  style={{ width: '100%' }}
                />
              </InputGroup>
              <HelpText>
                Stitches random multi-year slices from history. Preserves short-term
                sequence correlation while generating many alternate futures. Run count
                comes from the Simulation setting below.
              </HelpText>
            </>
          )}

          {form.returnModel === 'parametric' && (
            <HelpText>
              Random draws from the configured distribution and stock/bond parameters below.
            </HelpText>
          )}
        </Section>

        <Section>
          <SectionHeader>Portfolio Returns</SectionHeader>
          {isHistorical && (
            <HelpText>Historical mode uses recorded S&amp;P 500 and 10-yr Treasury returns.</HelpText>
          )}
          <AssetRow>
            <AssetLabel />
            <ColumnHeader>Expected Return</ColumnHeader>
            <ColumnHeader>Std Dev</ColumnHeader>
          </AssetRow>
          <AssetRow>
            <AssetLabel>Stocks</AssetLabel>
            {pctField(form.stockReturn, (v) => setForm({ ...form, stockReturn: v }), 50, isHistorical)}
            {pctField(form.stockStdDev, (v) => setForm({ ...form, stockStdDev: v }), 50, isHistorical)}
          </AssetRow>
          <AssetRow>
            <AssetLabel>Bonds</AssetLabel>
            {pctField(form.bondReturn, (v) => setForm({ ...form, bondReturn: v }), 50, isHistorical)}
            {pctField(form.bondStdDev, (v) => setForm({ ...form, bondStdDev: v }), 50, isHistorical)}
          </AssetRow>
          <BlendedRow>
            <span>Blended return (portfolio avg):</span>
            <BlendedValue>{(blendedReturn * 100).toFixed(1)}%</BlendedValue>
          </BlendedRow>
        </Section>

        <Section>
          <SectionHeader>Return Distribution</SectionHeader>
          <InputGroup>
            <label>Distribution</label>
            <Dropdown
              value={form.returnDistribution}
              options={distributionOptions}
              onChange={(e) => setForm({ ...form, returnDistribution: e.value })}
              style={{ width: '100%' }}
              disabled={isHistorical}
            />
          </InputGroup>
          {form.returnDistribution === 'student_t' && (
            <InputGroup>
              <label>Degrees of Freedom</label>
              <InputNumber
                value={form.degreesOfFreedom}
                onValueChange={(e) =>
                  setForm({ ...form, degreesOfFreedom: e.value ?? 4 })
                }
                min={3}
                max={12}
                showButtons
                inputStyle={{ width: '8rem' }}
                disabled={isHistorical}
              />
              <HelpText>
                Lower values = fatter tails (more extreme events). 4 is a common professional setting.
              </HelpText>
            </InputGroup>
          )}
        </Section>

        <Section>
          <SectionHeader>Asset Correlation</SectionHeader>
          <AssetRow>
            <Checkbox
              inputId="stock-bond-correlation-enabled"
              checked={form.stockBondCorrelationEnabled}
              onChange={(e) =>
                setForm({ ...form, stockBondCorrelationEnabled: !!e.checked })
              }
              disabled={isHistorical}
            />
            <label
              htmlFor="stock-bond-correlation-enabled"
              style={{ fontSize: fontSize.sm, cursor: 'pointer' }}
            >
              Apply stock/bond correlation
            </label>
          </AssetRow>
          {form.stockBondCorrelationEnabled && (
            <AssetRow>
              <AssetLabel>Stocks vs Bonds</AssetLabel>
              <InputNumber
                value={form.stockBondCorrelation}
                onValueChange={(e) =>
                  setForm({ ...form, stockBondCorrelation: e.value ?? 0 })
                }
                mode="decimal"
                minFractionDigits={2}
                maxFractionDigits={2}
                min={-1}
                max={1}
                step={0.05}
                inputStyle={{ width: '8rem' }}
                disabled={isHistorical}
              />
            </AssetRow>
          )}
        </Section>

        <Section>
          <SectionHeader>Inflation</SectionHeader>
          {isHistorical && (
            <HelpText>Historical mode pairs recorded CPI with each year's returns.</HelpText>
          )}
          <FieldRow>
            <InputGroup>
              <label>Rate</label>
              {pctField(form.inflationRate, (v) => setForm({ ...form, inflationRate: v }), 20, isHistorical)}
            </InputGroup>
            <InputGroup>
              <label>Std Dev</label>
              {pctField(form.inflationStdDev, (v) => setForm({ ...form, inflationStdDev: v }), 20, isHistorical)}
            </InputGroup>
          </FieldRow>
        </Section>

        <Section>
          <SectionHeader>Tax</SectionHeader>
          <InputGroup>
            <label>Long-term Capital Gains Rate</label>
            {pctField(form.longTermCapGainsRate, (v) => setForm({ ...form, longTermCapGainsRate: v }), 40)}
          </InputGroup>
        </Section>

        <Section>
          <SectionHeader>Black Swan Events</SectionHeader>
          <BlackSwanEventsEditor
            events={form.blackSwanEvents}
            onChange={(blackSwanEvents) =>
              setForm((prev) => ({ ...prev, blackSwanEvents }))
            }
            yearMin={scenario.referenceYear}
            yearMax={scenario.referenceYear + scenario.lifeExpectancy - scenario.currentAge}
            baseAge={scenario.currentAge}
          />
        </Section>

        <Section style={{ marginTop: spacing.md }}>
          <SectionHeader>Simulation</SectionHeader>
          <InputGroup>
            <label>Runs</label>
            <Dropdown
              value={form.simulationSettings.numSimulations}
              options={simRunOptions}
              onChange={(e) =>
                setForm({ ...form, simulationSettings: { ...form.simulationSettings, numSimulations: e.value } })
              }
              style={{ width: '100%' }}
              disabled={form.returnModel === 'historical_single' || form.returnModel === 'historical_rolling'}
            />
            {form.returnModel === 'historical_single' && (
              <HelpText>Historical: Single Sequence runs once (deterministic).</HelpText>
            )}
            {form.returnModel === 'historical_rolling' && (
              <HelpText>
                Historical: Rolling Start uses {rollingRunCount} runs (one per valid start year).
              </HelpText>
            )}
          </InputGroup>
        </Section>

      </Form>
    </Dialog>
  );
};

export default ModelingDialog;
