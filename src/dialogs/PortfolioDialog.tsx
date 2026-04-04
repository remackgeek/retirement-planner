import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import type { Scenario } from '../types/Scenario';
import type { PortfolioAssumptions } from '../types/IncomeEvent';
import { PORTFOLIO_PRESETS } from '../utils/portfolioPresets';
import { spacing, colors, fontSize } from '../styles/theme';

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  padding: ${spacing.sm} 0;

  .p-dropdown {
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

const HelpText = styled.small`
  color: ${colors.textMuted};
  font-size: ${fontSize.xs};
`;

const riskOptions = [
  { label: 'Conservative', value: 'conservative' },
  { label: 'Balanced', value: 'balanced' },
  { label: 'Aggressive', value: 'aggressive' },
  { label: 'Custom', value: 'custom' },
];

interface PortfolioDialogProps {
  visible: boolean;
  onHide: () => void;
  scenario: Scenario;
  onSave: (updated: Scenario) => void;
}

const PortfolioDialog: React.FC<PortfolioDialogProps> = ({
  visible,
  onHide,
  scenario,
  onSave,
}) => {
  const [form, setForm] = useState<PortfolioAssumptions>({ ...scenario.portfolioAssumptions });

  useEffect(() => {
    if (visible) {
      setForm({ ...scenario.portfolioAssumptions });
    }
  }, [visible, scenario]);

  const handleRiskLevelChange = (value: PortfolioAssumptions['riskLevel']) => {
    if (value !== 'custom' && value in PORTFOLIO_PRESETS) {
      const preset = PORTFOLIO_PRESETS[value as keyof typeof PORTFOLIO_PRESETS];
      setForm({ riskLevel: value, ...preset });
    } else {
      setForm({ ...form, riskLevel: value });
    }
  };

  const handleSave = () => {
    onSave({ ...scenario, portfolioAssumptions: form });
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
      header="Portfolio"
      visible={visible}
      style={{ width: '24rem' }}
      onHide={onHide}
      footer={dialogFooter}
    >
      <Form onSubmit={(e) => e.preventDefault()}>
        <InputGroup>
          <label>Risk Level</label>
          <Dropdown
            value={form.riskLevel}
            options={riskOptions}
            onChange={(e) => handleRiskLevelChange(e.value)}
          />
        </InputGroup>
        <HelpText>Sets the risk profile and populates default return and deviation assumptions in Modeling.</HelpText>
      </Form>
    </Dialog>
  );
};

export default PortfolioDialog;
