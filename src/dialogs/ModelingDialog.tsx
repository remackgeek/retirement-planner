import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import type { Scenario } from '../types/Scenario';
import type { SimulationSettings } from '../types/UserData';
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
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
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
  display: grid;
  grid-template-columns: 4rem 1fr 1fr;
  gap: ${spacing.sm};
  align-items: end;
`;

const AssetLabel = styled.div`
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
  padding-bottom: 0.4rem;
`;

const ColumnHeader = styled.div`
  font-size: ${fontSize.xs};
  color: ${colors.textMuted};
  text-align: center;
`;

const BlendedRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.xs};
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
  padding-top: ${spacing.xs};
`;

const BlendedValue = styled.span`
  font-weight: 600;
  color: ${colors.textPrimary};
`;

const simRunOptions = [
  { label: '1,000 (fast)', value: 1000 },
  { label: '5,000 (standard)', value: 5000 },
  { label: '10,000 (accurate)', value: 10000 },
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
  inflationRate: number;
  inflationStdDev: number;
  simulationSettings: SimulationSettings;
}

const ModelingDialog: React.FC<ModelingDialogProps> = ({
  visible,
  onHide,
  scenario,
  onSave,
}) => {
  const [form, setForm] = useState<FormState>({
    stockReturn: scenario.portfolioAssumptions.stockReturn,
    stockStdDev: scenario.portfolioAssumptions.stockStdDev,
    bondReturn: scenario.portfolioAssumptions.bondReturn,
    bondStdDev: scenario.portfolioAssumptions.bondStdDev,
    inflationRate: scenario.inflationRate,
    inflationStdDev: scenario.inflationStdDev,
    simulationSettings: { ...scenario.simulationSettings },
  });

  useEffect(() => {
    if (visible) {
      setForm({
        stockReturn: scenario.portfolioAssumptions.stockReturn,
        stockStdDev: scenario.portfolioAssumptions.stockStdDev,
        bondReturn: scenario.portfolioAssumptions.bondReturn,
        bondStdDev: scenario.portfolioAssumptions.bondStdDev,
        inflationRate: scenario.inflationRate,
        inflationStdDev: scenario.inflationStdDev,
        simulationSettings: { ...scenario.simulationSettings },
      });
    }
  }, [visible, scenario]);

  const stockAllocation = scenario.portfolioAssumptions.stockAllocation;
  const bondAllocation = 1 - stockAllocation;
  const blendedReturn = stockAllocation * form.stockReturn + bondAllocation * form.bondReturn;

  const handleSave = () => {
    onSave({
      ...scenario,
      inflationRate: form.inflationRate,
      inflationStdDev: form.inflationStdDev,
      simulationSettings: form.simulationSettings,
      portfolioAssumptions: {
        ...scenario.portfolioAssumptions,
        stockReturn: form.stockReturn,
        stockStdDev: form.stockStdDev,
        bondReturn: form.bondReturn,
        bondStdDev: form.bondStdDev,
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
      style={{ width: '100%' }}
    />
  );

  return (
    <Dialog
      header="Modeling"
      visible={visible}
      style={{ width: '34rem' }}
      onHide={onHide}
      footer={dialogFooter}
    >
      <Form onSubmit={(e) => e.preventDefault()}>

        <Section>
          <SectionHeader>Portfolio Returns</SectionHeader>
          <AssetRow>
            <div />
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
