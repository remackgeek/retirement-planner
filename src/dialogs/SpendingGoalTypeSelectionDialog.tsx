import React from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import type { SpendingGoal } from '../types/SpendingGoal';

const GridContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  padding: 1rem 0;
`;

const TypeButton = styled.button`
  padding: 1rem;
  font-size: 1rem;
  white-space: normal;
  text-align: center;
  color: #d2691e;
  border: 1px solid #d2691e;
  background: white;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;

  &:hover {
    color: white;
    background-color: #d2691e;
    border-color: #d2691e;
  }

  &:hover .icon-circle {
    background-color: rgba(255, 255, 255, 0.2);
  }
`;

const IconCircle = styled.span`
  color: #d2691e;
  background-color: rgba(210, 105, 30, 0.1);
  border-radius: 50%;
  padding: 0.25rem;
  font-size: 0.9rem;
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

const goalTypeLabels: Record<SpendingGoal['type'], string> = {
  monthly_retirement: 'Monthly Retirement',
  charity: 'Charity/Gift',
  dependent_support: 'Dependent Support',
  healthcare: 'Healthcare',
  home_purchase: 'Home Purchase/Upgrade',
  education: 'Education',
  renovation: 'Renovation',
  vacation: 'Vacation',
  vehicle: 'Vehicle',
  wedding: 'Wedding',
  other: 'Other Expense',
};

const goalTypeIcons: Record<SpendingGoal['type'], string> = {
  monthly_retirement: 'pi pi-dollar',
  charity: 'pi pi-heart',
  dependent_support: 'pi pi-users',
  healthcare: 'pi pi-heart-fill',
  home_purchase: 'pi pi-home',
  education: 'pi pi-book',
  renovation: 'pi pi-wrench',
  vacation: 'pi pi-plane',
  vehicle: 'pi pi-car',
  wedding: 'pi pi-heart',
  other: 'pi pi-circle',
};

const SpendingGoalTypeSelectionDialog: React.FC<
  SpendingGoalTypeSelectionDialogProps
> = ({ visible, onHide, onSelectType }) => {
  const handleTypeSelect = (type: SpendingGoal['type']) => {
    onSelectType(type);
    onHide();
  };

  return (
    <Dialog
      header='Select Spending Goal Type'
      visible={visible}
      style={{ width: '60vw' }}
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
            Add {label}
          </TypeButton>
        ))}
      </GridContainer>
    </Dialog>
  );
};

export default SpendingGoalTypeSelectionDialog;
