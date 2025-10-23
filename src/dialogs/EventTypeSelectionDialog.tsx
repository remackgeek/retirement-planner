import React from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import type { IncomeEventType } from '../types/IncomeEvent';

const GridContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  padding: 1rem 0;
`;

const TypeButton = styled(Button)`
  padding: 1rem;
  font-size: 1rem;
  white-space: normal;
  text-align: center;
  color: green !important;
  border-color: green !important;

  &:hover {
    color: white !important;
    background-color: green !important;
    border-color: green !important;
  }

  .p-button-icon {
    color: green !important;
    background-color: rgba(0, 128, 0, 0.1) !important;
    border-radius: 50% !important;
    padding: 0.3125rem !important;
    font-size: 0.8rem !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 1.5rem !important;
    height: 1.5rem !important;
    margin-right: 0.5rem !important;
  }

  .p-button-icon-only {
    margin: 0 !important;
  }
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

const eventTypeIcons: Record<IncomeEventType, string> = {
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
            label={`Add ${label}`}
            icon={eventTypeIcons[type as IncomeEventType]}
            onClick={() => handleTypeSelect(type as IncomeEventType)}
            className='p-button-outlined'
          />
        ))}
      </GridContainer>
    </Dialog>
  );
};

export default EventTypeSelectionDialog;
