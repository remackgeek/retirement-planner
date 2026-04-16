import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import type { Account, AccountType } from '../types/Account';
import { spacing, colors, fontSize } from '../styles/theme';
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

interface AccountDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (account: Omit<Account, 'id'>) => void;
  accountType: AccountType;
  editAccount?: Account;
  existingAccounts: Account[];
}

const AccountDialog: React.FC<AccountDialogProps> = ({
  visible,
  onHide,
  onSave,
  accountType,
  editAccount,
  existingAccounts,
}) => {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    if (visible) {
      if (editAccount) {
        setName(editAccount.name);
        setBalance(editAccount.balance);
      } else {
        setName(generateDefaultAccountName(accountType, existingAccounts));
        setBalance(0);
      }
    }
  }, [visible, editAccount, accountType, existingAccounts]);

  const isValid = name.trim().length > 0 && balance >= 0;

  const handleSave = () => {
    if (!isValid) return;
    onSave({ type: accountType, name: name.trim(), balance });
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

  return (
    <Dialog
      header={
        <>
          <i className={typeIcon} style={{ marginRight: spacing.sm, color: colors.primary }} />
          {editAccount ? `Edit ${typeLabel}` : `New ${typeLabel}`}
        </>
      }
      visible={visible}
      style={{ width: '24rem' }}
      onHide={onHide}
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
