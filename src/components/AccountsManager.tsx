import React, { useState } from 'react';
import styled from 'styled-components';
import AccountTypeSelectionDialog from '../dialogs/AccountTypeSelectionDialog';
import AccountDialog from '../dialogs/AccountDialog';
import type { Account, AccountType } from '../types/Account';
import { spacing, colors, border, fontSize } from '../styles/theme';
import { accountTypeShortLabels, accountTypeIcons } from '../utils/defaultName';

const Container = styled.div``;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${spacing.sm};
  h3 {
    margin: 0;
  }
`;

const AccountItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: ${spacing.sm};
  border: ${border.standard};
  margin-bottom: ${spacing.sm};
  border-radius: ${border.radius};
`;

const AccountInfo = styled.div`
  flex: 1;
`;

const Actions = styled.div`
  display: flex;
  gap: ${spacing.xs};
  align-self: flex-end;
`;

const Button = styled.button`
  padding: ${spacing.xs} ${spacing.sm};
  border: none;
  border-radius: ${border.radius};
  cursor: pointer;
  background: ${colors.primary};
  color: white;
  font-size: ${fontSize.sm};

  &:hover {
    background: ${colors.primaryHover};
  }
`;

const LargeButton = styled(Button)`
  padding: ${spacing.sm} ${spacing.lg};
  font-size: ${fontSize.xl};
`;

const DeleteButton = styled(Button)`
  background: ${colors.danger};

  &:hover {
    background: ${colors.dangerHover};
  }
`;

const IconCircle = styled.span`
  margin-right: ${spacing.xs};
  color: ${colors.primary};
  background-color: ${colors.bgMedium};
  border-radius: ${border.radiusCircle};
  padding: ${spacing.xs};
  font-size: ${fontSize.md};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  font-weight: bold;
`;

interface AccountsManagerProps {
  accounts: Account[];
  onAdd: (account: Omit<Account, 'id'>) => void;
  onUpdate: (id: string, account: Partial<Account>) => void;
  onDelete: (id: string) => void;
}

export const AccountsManager: React.FC<AccountsManagerProps> = ({
  accounts,
  onAdd,
  onUpdate,
  onDelete,
}) => {
  const [selectionDialogVisible, setSelectionDialogVisible] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<AccountType>('traditional');
  const [editingAccount, setEditingAccount] = useState<Account | undefined>(undefined);

  const handleTypeSelect = (type: AccountType) => {
    setSelectedType(type);
    setEditingAccount(undefined);
    setDialogVisible(true);
  };

  const handleSave = (account: Omit<Account, 'id'>) => {
    if (editingAccount) {
      onUpdate(editingAccount.id, account);
    } else {
      onAdd(account);
    }
    setDialogVisible(false);
    setEditingAccount(undefined);
  };

  const startEdit = (account: Account) => {
    setEditingAccount(account);
    setSelectedType(account.type);
    setDialogVisible(true);
  };

  return (
    <Container>
      <Header>
        <h3>Accounts</h3>
        <LargeButton onClick={() => setSelectionDialogVisible(true)}>
          Add Account
        </LargeButton>
      </Header>

      {accounts.map((account) => (
        <AccountItem key={account.id}>
          <AccountInfo>
            <div style={{ marginBottom: spacing.xs }}>
              <strong>
                <IconCircle>
                  <i className={accountTypeIcons[account.type]} />
                </IconCircle>
                {account.name}
              </strong>
            </div>
            ${account.balance.toLocaleString()} • {accountTypeShortLabels[account.type]}
          </AccountInfo>
          <Actions>
            <Button onClick={() => startEdit(account)}>Edit</Button>
            <DeleteButton onClick={() => onDelete(account.id)}>
              Delete
            </DeleteButton>
          </Actions>
        </AccountItem>
      ))}

      <AccountTypeSelectionDialog
        visible={selectionDialogVisible}
        onHide={() => setSelectionDialogVisible(false)}
        onSelectType={handleTypeSelect}
      />

      <AccountDialog
        visible={dialogVisible}
        onHide={() => {
          setDialogVisible(false);
          setEditingAccount(undefined);
        }}
        onSave={handleSave}
        accountType={editingAccount?.type ?? selectedType}
        editAccount={editingAccount}
        existingAccounts={accounts}
      />
    </Container>
  );
};
