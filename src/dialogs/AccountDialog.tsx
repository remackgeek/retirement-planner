import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import type { Account, AccountType } from '../types/Account';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, fontSize, border } from '../styles/theme';
import {
  accountTypeLabels,
  accountTypeIcons,
  generateDefaultAccountName,
} from '../utils/defaultName';

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

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};

  label {
    font-size: ${fontSize.sm};
    color: ${colors.textPrimary};
  }
`;

const TrashButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: ${spacing.xs};
  border-radius: ${border.radius};
  color: ${colors.danger};
  font-size: ${fontSize.xl};
  line-height: 1;
  display: flex;
  align-items: center;

  &:hover {
    color: ${colors.dangerHover};
    background: ${colors.bgMedium};
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
}

const ownerOptions = [
  { label: 'Self', value: 'self' },
  { label: 'Spouse', value: 'spouse' },
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
}) => {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState<number>(0);
  const [owner, setOwner] = useState<'self' | 'spouse'>('self');

  const showOwnerField = accountType === 'traditional' && spouseAge !== null;

  useEffect(() => {
    if (visible) {
      if (editAccount) {
        setName(editAccount.name);
        setBalance(editAccount.balance);
        setOwner(editAccount.owner ?? 'self');
      } else {
        setName(generateDefaultAccountName(accountType, existingAccounts));
        setBalance(0);
        setOwner('self');
      }
    }
  }, [visible, editAccount, accountType, existingAccounts]);

  const isValid = name.trim().length > 0 && balance >= 0;

  const handleSave = () => {
    if (!isValid) return;
    const account: Omit<Account, 'id'> = {
      type: accountType,
      name: name.trim(),
      balance,
      ...(showOwnerField ? { owner } : {}),
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
      style={{ width: '24rem' }}
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
            <label>Owner</label>
            <Dropdown
              value={owner}
              options={ownerOptions}
              onChange={(e) => setOwner(e.value)}
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
      </Form>
    </Dialog>
  );
};

export default AccountDialog;
