import React from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import type { AccountType } from '../types/Account';
import { spacing, colors, border, fontSize, dialogWidth } from '../styles/theme';
import { accountTypeLabels, accountTypeIcons } from '../utils/defaultName';

const GridContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 240px));
  gap: ${spacing.sm};
  padding: ${spacing.sm} 0;
`;

const TypeButton = styled.button`
  padding: ${spacing.xs} ${spacing.sm};
  font-size: ${fontSize.md};
  white-space: nowrap;
  text-align: left;
  color: ${colors.primary};
  border: 1px solid ${colors.primary};
  background: white;
  border-radius: ${border.radius};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: ${spacing.xs};

  &:hover {
    color: white;
    background-color: ${colors.primary};
    border-color: ${colors.primary};
  }

  &:hover .icon-circle {
    background-color: ${colors.overlayLight};
    color: inherit;
  }
`;

const IconCircle = styled.span`
  color: inherit;
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

interface AccountTypeSelectionDialogProps {
  visible: boolean;
  onHide: () => void;
  onSelectType: (type: AccountType) => void;
}

const accountTypes: AccountType[] = ['traditional', 'roth', 'brokerage', 'cash'];

const AccountTypeSelectionDialog: React.FC<AccountTypeSelectionDialogProps> = ({
  visible,
  onHide,
  onSelectType,
}) => {
  const handleTypeSelect = (type: AccountType) => {
    onSelectType(type);
    onHide();
  };

  return (
    <Dialog
      header="Add Account"
      visible={visible}
      style={dialogWidth('50rem')}
      onHide={onHide}
    >
      <GridContainer>
        {accountTypes.map((type) => (
          <TypeButton
            key={type}
            onClick={() => handleTypeSelect(type)}
          >
            <IconCircle className="icon-circle">
              <i className={accountTypeIcons[type]} />
            </IconCircle>
            {accountTypeLabels[type]}
          </TypeButton>
        ))}
      </GridContainer>
    </Dialog>
  );
};

export default AccountTypeSelectionDialog;
