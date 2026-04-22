import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import type { Scenario } from '../types/Scenario';
import type { SimulationSettings } from '../types/UserData';
import type { ReturnDistribution } from '../types/IncomeEvent';
import { spacing, colors, fontSize, border } from '../styles/theme';

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
  inflationRate: number;
  inflationStdDev: number;
  longTermCapGainsRate: number;
  simulationSettings: SimulationSettings;
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
    inflationRate: s.inflationRate,
    inflationStdDev: s.inflationStdDev,
    longTermCapGainsRate: s.longTermCapGainsRate,
    simulationSettings: { ...s.simulationSettings },
  });

  const [form, setForm] = useState<FormState>(() => formFromScenario(scenario));

  useEffect(() => {
    if (visible) setForm(formFromScenario(scenario));
  }, [visible, scenario]);

  const stockAllocation = scenario.portfolioAssumptions.stockAllocation;
  const bondAllocation = 1 - stockAllocation;
  const blendedReturn = stockAllocation * form.stockReturn + bondAllocation * form.bondReturn;

  const handleSave = () => {
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

  const pctField = (
    value: number,
    onChange: (v: number) => void,
    max = 50
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
          <SectionHeader>Portfolio Returns</SectionHeader>
          <AssetRow>
            <AssetLabel />
            <ColumnHeader>Expected Return</ColumnHeader>
            <ColumnHeader>Std Dev</ColumnHeader>
          </AssetRow>
          <AssetRow>
            <AssetLabel>Stocks</AssetLabel>
            {pctField(form.stockReturn, (v) => setForm({ ...form, stockReturn: v }))}
            {pctField(form.stockStdDev, (v) => setForm({ ...form, stockStdDev: v }))}
          </AssetRow>
          <AssetRow>
            <AssetLabel>Bonds</AssetLabel>
            {pctField(form.bondReturn, (v) => setForm({ ...form, bondReturn: v }))}
            {pctField(form.bondStdDev, (v) => setForm({ ...form, bondStdDev: v }))}
          </AssetRow>
          <BlendedRow>
            <span>Blended return ({Math.round(stockAllocation * 100)}/{Math.round(bondAllocation * 100)}):</span>
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
              />
            </AssetRow>
          )}
        </Section>

        <Section>
          <SectionHeader>Inflation</SectionHeader>
          <FieldRow>
            <InputGroup>
              <label>Rate</label>
              {pctField(form.inflationRate, (v) => setForm({ ...form, inflationRate: v }), 20)}
            </InputGroup>
            <InputGroup>
              <label>Std Dev</label>
              {pctField(form.inflationStdDev, (v) => setForm({ ...form, inflationStdDev: v }), 20)}
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
            />
          </InputGroup>
        </Section>

      </Form>
    </Dialog>
  );
};

export default ModelingDialog;
