import React from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import type { IncomeEventType } from '../types/IncomeEvent';

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
  color: green;
  border: 1px solid green;
  background: white;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;

  &:hover {
    color: white;
    background-color: green;
    border-color: green;
  }

  &:hover .icon-circle {
    background-color: rgba(255, 255, 255, 0.2);
  }
`;

const IconCircle = styled.span`
  color: green;
  background-color: rgba(0, 128, 0, 0.1);
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

interface EventTypeSelectionDialogProps {
  visible: boolean;
  onHide: () => void;
  onSelectType: (type: IncomeEventType) => void;
}

const eventTypeLabels: Record<IncomeEventType, string> = {
  social_security: 'Social Security',
  annuity_income: 'Annuity Income',
  inheritance: 'Inheritance',
  pension_income: 'Pension Income',
  rental_income: 'Rental Income',
  sale_of_property: 'Sale of Property/Downsize',
  work_during_retirement: 'Work During Retirement',
  other_income: 'Other Income',
};

const eventTypeSymbols: Record<IncomeEventType, string> = {
  social_security: 'pi pi-shield',
  annuity_income: 'pi pi-money-bill',
  inheritance: 'pi pi-gift',
  pension_income: 'pi pi-briefcase',
  rental_income: 'pi pi-home',
  sale_of_property: 'pi pi-arrow-right-arrow-left',
  work_during_retirement: 'pi pi-cog',
  other_income: 'pi pi-ellipsis-h',
};

const EventTypeSelectionDialog: React.FC<EventTypeSelectionDialogProps> = ({
  visible,
  onHide,
  onSelectType,
}) => {
  const handleTypeSelect = (type: IncomeEventType) => {
    onSelectType(type);
    onHide();
  };

  return (
    <Dialog
      header='Add Income Event'
      visible={visible}
      style={{ width: '50vw' }}
      onHide={onHide}
    >
      <p>Select the type of income event to add:</p>
      <GridContainer>
        {Object.entries(eventTypeLabels).map(([type, label]) => (
          <TypeButton
            key={type}
            onClick={() => handleTypeSelect(type as IncomeEventType)}
          >
            <IconCircle className='icon-circle'>
              <i className={eventTypeSymbols[type as IncomeEventType]} />
            </IconCircle>
            Add {label}
          </TypeButton>
        ))}
      </GridContainer>
    </Dialog>
  );
};

export default EventTypeSelectionDialog;
