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
            onClick={() => handleTypeSelect(type as IncomeEventType)}
            className='p-button-outlined'
          />
        ))}
      </GridContainer>
    </Dialog>
  );
};

export default EventTypeSelectionDialog;
