import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';
import type { Scenario } from '../types/Scenario';
import type { PortfolioAssumptions, PortfolioType } from '../types/IncomeEvent';
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

const balanceOptions = [
  { label: '80/20 (Stocks/Bonds)', value: '80_20' },
  { label: '60/40 (Stocks/Bonds)', value: '60_40' },
  { label: '50/50 (Stocks/Bonds)', value: '50_50' },
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

  const handleBalanceChange = (value: PortfolioType | 'custom') => {
    if (value !== 'custom' && value in PORTFOLIO_PRESETS) {
      const { stockAllocation } = PORTFOLIO_PRESETS[value];
      // Only update allocation — return/stddev fields are managed in Modeling
      setForm({ ...form, portfolioBalance: value, stockAllocation });
    } else {
      setForm({ ...form, portfolioBalance: value });
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
      header="Portfolio Balance"
      visible={visible}
      style={{ width: '24rem' }}
      onHide={onHide}
      footer={dialogFooter}
    >
      <Form onSubmit={(e) => e.preventDefault()}>
        <InputGroup>
          <label>Stock / Bond Split</label>
          <Dropdown
            value={form.portfolioBalance}
            options={balanceOptions}
            onChange={(e) => handleBalanceChange(e.value)}
          />
        </InputGroup>
        {form.portfolioBalance === 'custom' && (
          <InputGroup>
            <label>Stock Allocation (%)</label>
            <InputNumber
              value={Math.round(form.stockAllocation * 100)}
              onValueChange={(e) =>
                setForm({ ...form, stockAllocation: (e.value ?? 60) / 100 })
              }
              min={0}
              max={100}
              suffix="%"
            />
          </InputGroup>
        )}
        <HelpText>
          Sets the stock/bond split. Return and volatility assumptions are configured in Modeling.
        </HelpText>
      </Form>
    </Dialog>
  );
};

export default PortfolioDialog;
