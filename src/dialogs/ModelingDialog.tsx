import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import type { Scenario } from '../types/Scenario';
import type { SimulationSettings } from '../types/UserData';
import type { PortfolioType } from '../types/IncomeEvent';
import { PORTFOLIO_PRESETS } from '../utils/portfolioPresets';
import { spacing, colors, fontSize } from '../styles/theme';

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  padding: ${spacing.sm} 0;

  .p-inputtext,
  .p-dropdown,
  .p-inputnumber {
    width: 100%;
  }
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

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing.md};
`;

const HelpText = styled.small`
  color: ${colors.textMuted};
  font-size: ${fontSize.xs};
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
  expectedReturn: number;
  standardDeviation: number;
  inflationRate: number;
  simulationSettings: SimulationSettings;
}

const ModelingDialog: React.FC<ModelingDialogProps> = ({
  visible,
  onHide,
  scenario,
  onSave,
}) => {
  const [form, setForm] = useState<FormState>({
    expectedReturn: scenario.portfolioAssumptions.expectedReturn,
    standardDeviation: scenario.portfolioAssumptions.standardDeviation,
    inflationRate: scenario.inflationRate,
    simulationSettings: { ...scenario.simulationSettings },
  });

  useEffect(() => {
    if (visible) {
      setForm({
        expectedReturn: scenario.portfolioAssumptions.expectedReturn,
        standardDeviation: scenario.portfolioAssumptions.standardDeviation,
        inflationRate: scenario.inflationRate,
        simulationSettings: { ...scenario.simulationSettings },
      });
    }
  }, [visible, scenario]);

  const handleSave = () => {
    const eps = 0.00001;
    const matchingPreset = (Object.keys(PORTFOLIO_PRESETS) as PortfolioType[]).find(
      (key) =>
        Math.abs(PORTFOLIO_PRESETS[key].expectedReturn - form.expectedReturn) < eps &&
        Math.abs(PORTFOLIO_PRESETS[key].standardDeviation - form.standardDeviation) < eps
    );
    const riskLevel = matchingPreset ?? 'custom';
    onSave({
      ...scenario,
      inflationRate: form.inflationRate,
      simulationSettings: form.simulationSettings,
      portfolioAssumptions: {
        riskLevel,
        expectedReturn: form.expectedReturn,
        standardDeviation: form.standardDeviation,
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

  return (
    <Dialog
      header="Modeling"
      visible={visible}
      style={{ width: '32rem' }}
      onHide={onHide}
      footer={dialogFooter}
    >
      <Form onSubmit={(e) => e.preventDefault()}>
        <FieldRow>
          <InputGroup>
            <label>Expected Return</label>
            <InputNumber
              value={form.expectedReturn * 100}
              onValueChange={(e) => setForm({ ...form, expectedReturn: (e.value ?? 0) / 100 })}
              mode="decimal"
              minFractionDigits={2}
              maxFractionDigits={2}
              min={0}
              max={30}
              suffix="%"
            />
          </InputGroup>
          <InputGroup>
            <label>Standard Deviation</label>
            <InputNumber
              value={form.standardDeviation * 100}
              onValueChange={(e) => setForm({ ...form, standardDeviation: (e.value ?? 0) / 100 })}
              mode="decimal"
              minFractionDigits={2}
              maxFractionDigits={2}
              min={0}
              max={50}
              suffix="%"
            />
          </InputGroup>
        </FieldRow>
        <HelpText>Real (inflation-adjusted) annual returns. Populated from Portfolio risk level — adjust here to fine-tune.</HelpText>

        <InputGroup>
          <label>Inflation Rate</label>
          <InputNumber
            value={form.inflationRate * 100}
            onValueChange={(e) => setForm({ ...form, inflationRate: (e.value ?? 0) / 100 })}
            mode="decimal"
            minFractionDigits={2}
            maxFractionDigits={2}
            min={0}
            max={20}
            suffix="%"
          />
        </InputGroup>

        <InputGroup>
          <label>Simulation Runs</label>
          <Dropdown
            value={form.simulationSettings.numSimulations}
            options={simRunOptions}
            onChange={(e) =>
              setForm({ ...form, simulationSettings: { ...form.simulationSettings, numSimulations: e.value } })
            }
          />
        </InputGroup>
      </Form>
    </Dialog>
  );
};

export default ModelingDialog;
