import React, { useState } from 'react';
import styled from 'styled-components';
import AccountTypeSelectionDialog from '../dialogs/AccountTypeSelectionDialog';
import AccountDialog from '../dialogs/AccountDialog';
import type { Account, AccountType } from '../types/Account';
import { spacing, colors } from '../styles/theme';
import { accountTypeShortLabels, accountTypeIcons } from '../utils/defaultName';
import { ManagerRow, SlatList, AddButton } from './ManagerRow';

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

interface AccountsManagerProps {
  accounts: Account[];
  onAdd: (account: Omit<Account, 'id'>) => void;
  onUpdate: (id: string, account: Partial<Account>) => void;
  onDelete: (id: string) => void;
  spouseAge: number | null;
}

export const AccountsManager: React.FC<AccountsManagerProps> = ({
  accounts,
  onAdd,
  onUpdate,
  onDelete,
  spouseAge,
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
        <AddButton onClick={() => setSelectionDialogVisible(true)}>
          Add
        </AddButton>
      </Header>

      <SlatList>
        {accounts.map((account) => (
          <ManagerRow
            key={account.id}
            icon={<i className={accountTypeIcons[account.type]} />}
            iconBg={colors.bgMedium}
            iconColor={colors.primary}
            name={account.name}
            secondary={
              <>
                ${account.balance.toLocaleString()} • {accountTypeShortLabels[account.type]}
                {account.type === 'traditional' && account.owner === 'spouse' && spouseAge !== null && (
                  <> • Spouse</>
                )}
              </>
            }
            onEdit={() => startEdit(account)}
            onDelete={() => onDelete(account.id)}
          />
        ))}
      </SlatList>

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
        spouseAge={spouseAge}
      />
    </Container>
  );
};
