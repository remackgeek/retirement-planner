import React, { useState } from 'react';
import styled from 'styled-components';
import AccountTypeSelectionDialog from '../dialogs/AccountTypeSelectionDialog';
import AccountDialog from '../dialogs/AccountDialog';
import type { Account, AccountType } from '../types/Account';
import { colors, fontSize } from '../styles/theme';
import { accountTypeShortLabels, accountTypeIcons } from '../utils/defaultName';
import { ManagerRow, SlatList, AddButton, Header, HeaderLeft } from './ManagerRow';

const Container = styled.div``;

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

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

  return (
    <Container>
      <Header>
        <HeaderLeft>
          <h3>Accounts</h3>
          <div style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
            ${totalBalance.toLocaleString()}
          </div>
        </HeaderLeft>
        <AddButton onClick={() => setSelectionDialogVisible(true)}>Add</AddButton>
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
