import React from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import type { SpendingGoal } from '../types/SpendingGoal';
import { spacing, colors, border, fontSize, dialogWidth } from '../styles/theme';
import { goalTypeLabels, goalTypeIcons } from '../utils/defaultName';

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
  color: ${colors.spending};
  border: 1px solid ${colors.spending};
  background: white;
  border-radius: ${border.radius};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: ${spacing.xs};

  &:hover {
    color: white;
    background-color: ${colors.spending};
    border-color: ${colors.spending};
  }

  &:hover .icon-circle {
    background-color: ${colors.overlayLight};
    color: inherit;
  }
`;

const IconCircle = styled.span`
  color: ${colors.spending};
  background-color: ${colors.spendingBg};
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

interface SpendingGoalTypeSelectionDialogProps {
  visible: boolean;
  onHide: () => void;
  onSelectType: (type: SpendingGoal['type']) => void;
}



const SpendingGoalTypeSelectionDialog: React.FC<
  SpendingGoalTypeSelectionDialogProps
> = ({ visible, onHide, onSelectType }) => {
  const handleTypeSelect = (type: SpendingGoal['type']) => {
    onSelectType(type);
    onHide();
  };

  return (
    <Dialog
      header='Add Spending Goal'
      visible={visible}
      style={dialogWidth('50rem')}
      onHide={onHide}
    >
      <GridContainer>
        {Object.entries(goalTypeLabels).map(([type, label]) => (
          <TypeButton
            key={type}
            onClick={() => handleTypeSelect(type as SpendingGoal['type'])}
          >
            <IconCircle className='icon-circle'>
              <i className={goalTypeIcons[type as SpendingGoal['type']]} />
            </IconCircle>
            {label}
          </TypeButton>
        ))}
      </GridContainer>
    </Dialog>
  );
};

export default SpendingGoalTypeSelectionDialog;
