import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, fontSize, border, dialogWidth } from '../styles/theme';
import type { Scenario } from '../types/Scenario';
import type { CashBucketPolicy } from '../types/UserData';
import type { Account } from '../types/Account';

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
  font-weight: 600;
  font-size: ${fontSize.sm};
  color: ${colors.textPrimary};
  border-bottom: 1px solid ${colors.borderLight};
  padding-bottom: ${spacing.xs};
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: ${spacing.sm};
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
  label {
    font-size: ${fontSize.xs};
    color: ${colors.textSecondary};
  }
`;

const HelpText = styled.small`
  color: ${colors.textMuted};
  font-size: ${fontSize.xs};
  line-height: 1.4;
`;

const triggerOptions: { label: string; value: CashBucketPolicy['refillTrigger']; description: string }[] = [
  {
    label: 'Gains only (Recommended)',
    value: 'gains_only',
    description: "Refill cash only in years with positive stock returns. Bear-aware — won't sell into a down market.",
  },
  {
    label: 'Above baseline',
    value: 'above_baseline',
    description: 'Refill only when the portfolio is ahead of the deterministic baseline. Strictest bear-aware.',
  },
  {
    label: 'Always',
    value: 'always',
    description: 'Refill every year there is surplus. Conservative but can lock in losses.',
  },
  {
    label: 'None (manual)',
    value: 'none',
    description: 'No auto-refill or auto-sweep. You manage cash by editing the account balance directly.',
  },
];

interface CashBucketDialogProps {
  visible: boolean;
  onHide: () => void;
  scenario: Scenario;
  onSave: (updated: Scenario) => void;
}

const DEFAULTS: CashBucketPolicy = {
  minAmount: 20000,
  targetAmount: 60000,
  maxAmount: 120000,
  refillTrigger: 'gains_only',
};

const CashBucketDialog: React.FC<CashBucketDialogProps> = ({
  visible,
  onHide,
  scenario,
  onSave,
}) => {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [minAmount, setMinAmount] = useState<number>(DEFAULTS.minAmount);
  const [targetAmount, setTargetAmount] = useState<number>(DEFAULTS.targetAmount);
  const [maxAmount, setMaxAmount] = useState<number>(DEFAULTS.maxAmount);
  const [refillTrigger, setRefillTrigger] = useState<CashBucketPolicy['refillTrigger']>(DEFAULTS.refillTrigger);

  useEffect(() => {
    if (!visible) return;
    const p = scenario.cashBucketPolicy;
    if (p) {
      setEnabled(true);
      setMinAmount(p.minAmount);
      setTargetAmount(p.targetAmount);
      setMaxAmount(p.maxAmount);
      setRefillTrigger(p.refillTrigger);
    } else {
      setEnabled(false);
      setMinAmount(DEFAULTS.minAmount);
      setTargetAmount(DEFAULTS.targetAmount);
      setMaxAmount(DEFAULTS.maxAmount);
      setRefillTrigger(DEFAULTS.refillTrigger);
    }
  }, [visible, scenario]);

  const hasCashAccount = scenario.accounts.some((a) => a.type === 'cash');

  const ordered = enabled && minAmount <= targetAmount && targetAmount <= maxAmount;

  const persist = (mutateAccounts?: (accounts: Account[]) => Account[]) => {
    const policy: CashBucketPolicy | undefined = enabled
      ? { minAmount, targetAmount, maxAmount, refillTrigger }
      : undefined;
    const accounts = mutateAccounts ? mutateAccounts(scenario.accounts) : scenario.accounts;
    onSave({ ...scenario, accounts, cashBucketPolicy: policy });
    onHide();
  };

  const handleSave = () => {
    // First-time nudge: enabling the policy without an existing cash account
    // prompts the user to create one (defaulting to $0). Dismissing the prompt
    // still persists the policy — the engine synthetic-account safety net
    // (ensureCashAccount) catches it. The visible-account nudge is just better UX.
    if (enabled && !hasCashAccount) {
      confirmDialog({
        message: "You're configuring a cash bucket but have no cash account. Create one with $0 starting balance?",
        header: 'Create cash account?',
        icon: 'pi pi-question-circle',
        acceptLabel: 'Create cash account',
        rejectLabel: 'Skip',
        accept: () => {
          persist((accounts) => [
            ...accounts,
            {
              id: `cash-${Date.now()}`,
              name: 'Cash',
              type: 'cash',
              balance: 0,
              stockAllocation: 0,
              portfolioBalance: '60_40',
            },
          ]);
        },
        reject: () => persist(),
      });
      return;
    }
    persist();
  };

  const dialogFooter = (
    <div>
      <Button label="Cancel" icon="pi pi-times" onClick={onHide} className="p-button-text" />
      <Button label="Save" icon="pi pi-check" onClick={handleSave} disabled={enabled && !ordered} />
    </div>
  );

  const trigger = triggerOptions.find((t) => t.value === refillTrigger);

  return (
    <Dialog
      header="Cash Bucket"
      visible={visible}
      style={dialogWidth('28rem')}
      onHide={onHide}
      footer={dialogFooter}
    >
      <Form onSubmit={(e) => e.preventDefault()}>
        <Section>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <Checkbox inputId="cash-bucket-enabled" checked={enabled} onChange={(e) => setEnabled(!!e.checked)} />
            <label htmlFor="cash-bucket-enabled" style={{ fontSize: fontSize.sm, cursor: 'pointer' }}>
              Manage my cash bucket
            </label>
          </div>
          <HelpText>
            When enabled, the engine keeps cash between a minimum and maximum band — refilling from
            this year's surplus when low (subject to the trigger) and sweeping back into Taxable
            when above the ceiling. Off = manual mode (no automatic movement).
          </HelpText>
        </Section>

        {enabled && (
          <>
            <Section>
              <SectionHeader>Cash band (dollar amounts)</SectionHeader>
              <FieldRow>
                <InputGroup>
                  <label>Min</label>
                  <InputNumber
                    value={minAmount}
                    onValueChange={(e) => setMinAmount(e.value ?? 0)}
                    mode="currency"
                    currency="USD"
                    locale="en-US"
                    maxFractionDigits={0}
                    min={0}
                    max={10000000}
                    step={5000}
                    showButtons
                    inputStyle={{ width: '100%' }}
                  />
                </InputGroup>
                <InputGroup>
                  <label>Target</label>
                  <InputNumber
                    value={targetAmount}
                    onValueChange={(e) => setTargetAmount(e.value ?? 0)}
                    mode="currency"
                    currency="USD"
                    locale="en-US"
                    maxFractionDigits={0}
                    min={0}
                    max={10000000}
                    step={5000}
                    showButtons
                    inputStyle={{ width: '100%' }}
                  />
                </InputGroup>
                <InputGroup>
                  <label>Max</label>
                  <InputNumber
                    value={maxAmount}
                    onValueChange={(e) => setMaxAmount(e.value ?? 0)}
                    mode="currency"
                    currency="USD"
                    locale="en-US"
                    maxFractionDigits={0}
                    min={0}
                    max={10000000}
                    step={5000}
                    showButtons
                    inputStyle={{ width: '100%' }}
                  />
                </InputGroup>
              </FieldRow>
              <HelpText>
                Each band is a fixed dollar amount (it does not inflate).
                Spending pulls Cash only down to <strong>Min</strong> (then falls through to Taxable).
                Surplus deposits fill up to <strong>Target</strong>. Cash above <strong>Max</strong> is
                swept back to Taxable.
              </HelpText>
              {!ordered && enabled && (
                <HelpText style={{ color: colors.danger }}>
                  Min must be ≤ Target must be ≤ Max.
                </HelpText>
              )}
            </Section>

            <Section>
              <SectionHeader>Refill trigger</SectionHeader>
              <Dropdown
                value={refillTrigger}
                options={triggerOptions.map((o) => ({ label: o.label, value: o.value }))}
                onChange={(e) => setRefillTrigger(e.value)}
                style={{ width: '100%' }}
              />
              <HelpText>{trigger?.description}</HelpText>
            </Section>

            {!hasCashAccount && (
              <Section>
                <HelpText style={{ color: colors.textPrimary, padding: spacing.sm, background: colors.bgLight, borderRadius: border.radius }}>
                  <strong>No cash account configured.</strong> You'll be prompted to create one with
                  a $0 starting balance when you save.
                </HelpText>
              </Section>
            )}
          </>
        )}
      </Form>
    </Dialog>
  );
};

export default CashBucketDialog;
