import React, { useState } from 'react';
import styled from 'styled-components';
import AccountTypeSelectionDialog from '../dialogs/AccountTypeSelectionDialog';
import AccountDialog from '../dialogs/AccountDialog';
import type { Account, AccountType } from '../types/Account';
import { colors, fontSize } from '../styles/theme';
import { accountTypeShortLabels, accountTypeIcons } from '../utils/defaultName';
import { PORTFOLIO_PRESETS } from '../utils/portfolioPresets';
import { ManagerRow, RightAmount, SlatList, PlusButton, Header, HeaderLeft, HeaderRight } from './ManagerRow';

const Container = styled.div``;

const AllocationText = styled.span`
  color: ${colors.textSecondary};
  font-size: ${fontSize.xs};
  margin-left: 0.35rem;
`;

interface AccountsManagerProps {
  accounts: Account[];
  onAdd: (account: Omit<Account, 'id'>) => void;
  onUpdate: (id: string, account: Partial<Account>) => void;
  onDelete: (id: string) => void;
  spouseAge: number | null;
  cashYieldRate: number;
}

export const AccountsManager: React.FC<AccountsManagerProps> = ({
  accounts,
  onAdd,
  onUpdate,
  onDelete,
  spouseAge,
  cashYieldRate,
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
          <h3>
            Accounts{' '}
            <span style={{ fontSize: fontSize.sm, fontWeight: 'normal', color: colors.textSecondary }}>
              (<span style={{ fontWeight: 600 }}>${totalBalance.toLocaleString()}</span> total)
            </span>
          </h3>
        </HeaderLeft>
        <HeaderRight>
          <PlusButton onClick={() => setSelectionDialogVisible(true)}>
            <i className="pi pi-plus" />
          </PlusButton>
        </HeaderRight>
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
                {accountTypeShortLabels[account.type]}
                {account.type === 'traditional' && account.owner === 'spouse' && spouseAge !== null && (
                  <> • Spouse</>
                )}
                <AllocationText>
                  {account.type === 'cash'
                    ? `${(cashYieldRate * 100).toFixed(2)}% yield`
                    : PORTFOLIO_PRESETS[account.portfolioBalance].label.split(' ')[0]}
                </AllocationText>
              </>
            }
            right={<RightAmount>${account.balance.toLocaleString()}</RightAmount>}
            onEdit={() => startEdit(account)}
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
        onDelete={editingAccount ? () => { onDelete(editingAccount.id); setDialogVisible(false); setEditingAccount(undefined); } : undefined}
        accountType={editingAccount?.type ?? selectedType}
        editAccount={editingAccount}
        existingAccounts={accounts}
        spouseAge={spouseAge}
        cashYieldRate={cashYieldRate}
      />
    </Container>
  );
};
