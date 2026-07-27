import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Tooltip as PrimeTooltip } from 'primereact/tooltip';
import type { Account, AccountType, AccountKind } from '../types/Account';
import type { PortfolioType } from '../types/IncomeEvent';
import { PORTFOLIO_PRESETS } from '../utils/portfolioPresets';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, fontSize, border, dialogWidth } from '../styles/theme';
import {
  accountTypeLabels,
  accountTypeIcons,
  generateDefaultAccountName,
} from '../utils/defaultName';
import { InputGroup, TrashButton } from './SettingsDialogPrimitives';

// Local Form: deliberately omits the .p-dropdown width rule — the Owner /
// account-kind dropdowns here size to content, unlike the entity dialogs.
const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  padding: ${spacing.sm} 0;

  .p-inputtext,
  .p-inputnumber {
    width: 100%;
  }
`;

const AllocationRow = styled.div`
  display: flex;
  gap: ${spacing.xs};
`;

const PresetBtn = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: ${spacing.xs} 0;
  font-size: ${fontSize.sm};
  border: ${border.standard};
  border-radius: ${border.radius};
  cursor: pointer;
  background: ${({ $active }) => ($active ? colors.primary : colors.bgLight)};
  color: ${({ $active }) => ($active ? colors.onPrimary : colors.textPrimary)};
  font-weight: ${({ $active }) => ($active ? 600 : 400)};

  &:hover {
    background: ${({ $active }) => ($active ? colors.primary : colors.bgMedium)};
  }
`;

interface AccountDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (account: Omit<Account, 'id'>) => void;
  onDelete?: () => void;
  accountType: AccountType;
  editAccount?: Account;
  existingAccounts: Account[];
  spouseAge: number | null;
  // Scenario-level cash yield (from portfolioAssumptions.cashYieldRate).
  // Shown for cash accounts. Editable inline when onCashYieldChange is provided
  // (writes back to the scenario immediately, independent of account Save);
  // otherwise read-only.
  cashYieldRate: number;
  onCashYieldChange?: (rate: number) => void;
}

const ownerOptions = [
  { label: 'Self', value: 'self' },
  { label: 'Spouse', value: 'spouse' },
];

const accountKindOptions: { label: string; value: AccountKind }[] = [
  { label: 'IRA', value: 'ira' },
  { label: '401(k)/403(b)/TSP', value: '401k' },
];

const AccountDialog: React.FC<AccountDialogProps> = ({
  visible,
  onHide,
  onSave,
  onDelete,
  accountType,
  editAccount,
  existingAccounts,
  spouseAge,
  cashYieldRate,
  onCashYieldChange,
}) => {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState<number>(0);
  const [owner, setOwner] = useState<'self' | 'spouse'>('self');
  const [portfolioBalance, setPortfolioBalance] = useState<PortfolioType>('60_40');
  const [accountKind, setAccountKind] = useState<AccountKind>('ira');

  const isCash = accountType === 'cash';
  // Owner field is deliberately hidden for cash in Phase 1. Cash accounts are
  // commonly joint, and per-owner RMD (the original reason the owner field
  // exists for Traditional) doesn't apply. Community-property nuance is
  // future work — when an MFS-related cash-specific tax distinction appears,
  // re-enable this field with the spouse-age gate.
  const showOwnerField = !isCash && accountType === 'traditional' && spouseAge !== null;
  const showAccountKindField = !isCash && (accountType === 'traditional' || accountType === 'roth');
  const showAllocationField = !isCash;

  useEffect(() => {
    if (visible) {
      if (editAccount) {
        setName(editAccount.name);
        setBalance(editAccount.balance);
        setOwner(editAccount.owner ?? 'self');
        setPortfolioBalance(editAccount.portfolioBalance ?? '60_40');
        setAccountKind(
          editAccount.accountKind ?? (editAccount.type === 'brokerage' ? 'brokerage' : 'ira')
        );
      } else {
        setName(generateDefaultAccountName(accountType, existingAccounts));
        setBalance(0);
        setOwner('self');
        setPortfolioBalance('60_40');
        setAccountKind(accountType === 'brokerage' ? 'brokerage' : 'ira');
      }
    }
  }, [visible, editAccount, accountType, existingAccounts]);

  const isValid = name.trim().length > 0 && balance >= 0;

  const handleSave = () => {
    if (!isValid) return;
    // Cash accounts have no meaningful stockAllocation (growth loop bypasses
    // the market factor entirely — see SimulationService growth-loop bypass).
    // Persist 0 so any consumer that reads stockAllocation gets a sensible
    // value, while the growth loop branches on `account.type === 'cash'`
    // before consulting allocation.
    const account: Omit<Account, 'id'> = {
      type: accountType,
      name: name.trim(),
      balance,
      portfolioBalance: isCash ? '60_40' : portfolioBalance,
      stockAllocation: isCash ? 0 : PORTFOLIO_PRESETS[portfolioBalance].stockAllocation,
      ...(showOwnerField ? { owner } : {}),
      ...(showAccountKindField ? { accountKind } : {}),
    };
    onSave(account);
    onHide();
  };

  const dialogFooter = (
    <div>
      <Button label="Cancel" icon="pi pi-times" onClick={onHide} className="p-button-text" />
      <Button label="Save" icon="pi pi-check" onClick={handleSave} disabled={!isValid} />
    </div>
  );

  const typeLabel = accountTypeLabels[accountType];
  const typeIcon = accountTypeIcons[accountType];

  const handleDeleteClick = () => {
    confirmDialog({
      message: `Are you sure you want to delete "${name}"?`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      accept: onDelete,
    });
  };

  return (
    <Dialog
      header={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>
            <i className={typeIcon} style={{ marginRight: spacing.sm, color: colors.primary }} />
            {editAccount ? `Edit ${typeLabel}` : `New ${typeLabel}`}
          </span>
          {onDelete && (
            <TrashButton onClick={handleDeleteClick} title="Delete">
              <i className="pi pi-trash" />
            </TrashButton>
          )}
        </div>
      }
      visible={visible}
      style={dialogWidth('24rem')}
      onHide={onHide}
      closable={false}
      closeOnEscape={true}
      footer={dialogFooter}
    >
      <Form onSubmit={(e) => e.preventDefault()}>
        <InputGroup>
          <label>Account Name</label>
          <InputText
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={name.trim().length === 0 ? 'p-invalid' : ''}
          />
        </InputGroup>
        {showOwnerField && (
          <InputGroup>
            <label>
              Owner{' '}
              <span className="owner-help-tip" style={{ color: colors.textMuted, cursor: 'help', fontWeight: 400 }}>(?)</span>
            </label>
            <PrimeTooltip target=".owner-help-tip" position="right" showDelay={150}>
              <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                Whose account this is. Required Minimum Distributions are computed
                per owner using each spouse's own age (Self uses your age, Spouse
                uses your spouse's), and Roth conversions stay within the same
                owner's accounts — so the owner here changes when and how much this
                account is forced to distribute.
              </div>
            </PrimeTooltip>
            <Dropdown
              value={owner}
              options={ownerOptions}
              onChange={(e) => setOwner(e.value)}
            />
          </InputGroup>
        )}
        {showAccountKindField && (
          <InputGroup>
            <label>Account Kind</label>
            <Dropdown
              value={accountKind}
              options={accountKindOptions}
              onChange={(e) => setAccountKind(e.value)}
            />
          </InputGroup>
        )}
        <InputGroup>
          <label>Current Balance</label>
          <InputNumber
            value={balance}
            onValueChange={(e) => setBalance(e.value ?? 0)}
            mode="currency"
            currency="USD"
            min={0}
          />
        </InputGroup>
        {showAllocationField && (
          <InputGroup style={{ marginTop: spacing.md }}>
            <label>Stocks / Bonds Mix</label>
            <AllocationRow>
              {(Object.keys(PORTFOLIO_PRESETS) as PortfolioType[]).map((key) => (
                <PresetBtn
                  key={key}
                  type="button"
                  $active={portfolioBalance === key}
                  onClick={() => setPortfolioBalance(key)}
                >
                  {PORTFOLIO_PRESETS[key].label.split(' ')[0]}
                </PresetBtn>
              ))}
            </AllocationRow>
            <small style={{ color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.xs }}>
              Sets how this account is split between stocks and bonds. Return and volatility assumptions apply to all accounts and are configured in Modeling.
            </small>
          </InputGroup>
        )}
        {isCash && (
          <InputGroup style={{ marginTop: spacing.md }}>
            <label>Yield (annual)</label>
            {onCashYieldChange ? (
              <InputNumber
                value={cashYieldRate * 100}
                onValueChange={(e) => onCashYieldChange((e.value ?? 0) / 100)}
                mode="decimal"
                minFractionDigits={2}
                maxFractionDigits={2}
                suffix="%"
                min={0}
                max={20}
              />
            ) : (
              <div
                style={{
                  padding: `${spacing.xs} ${spacing.sm}`,
                  background: colors.bgLight,
                  border: border.standard,
                  borderRadius: border.radius,
                  fontSize: fontSize.base,
                  color: colors.textSecondary,
                }}
              >
                {(cashYieldRate * 100).toFixed(2)}% annual (set in Modeling)
              </div>
            )}
            <small style={{ color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.xs }}>
              Cash accounts accrue a deterministic yield (treated as ordinary income) and are not subject to stock/bond market shocks. Interest counts toward IRMAA MAGI and the NIIT investment-income base. This rate is scenario-wide — changing it here applies to every cash account and saves immediately.
            </small>
          </InputGroup>
        )}
      </Form>
    </Dialog>
  );
};

export default AccountDialog;
