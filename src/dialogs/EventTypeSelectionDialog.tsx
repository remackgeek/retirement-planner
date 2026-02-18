import React from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import type { IncomeEventType } from '../types/IncomeEvent';
import { spacing, colors, border, fontSize } from '../styles/theme';

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
  color: ${colors.income};
  border: 1px solid ${colors.income};
  background: white;
  border-radius: ${border.radius};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: ${spacing.xs};

  &:hover {
    color: white;
    background-color: ${colors.income};
    border-color: ${colors.income};
  }

  &:hover .icon-circle {
    background-color: rgba(255, 255, 255, 0.2);
    color: inherit;
  }
`;

const IconCircle = styled.span`
  color: ${colors.income};
  background-color: ${colors.incomeBg};
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
      <GridContainer>
        {Object.entries(eventTypeLabels).map(([type, label]) => (
          <TypeButton
            key={type}
            onClick={() => handleTypeSelect(type as IncomeEventType)}
          >
            <IconCircle className='icon-circle'>
              <i className={eventTypeSymbols[type as IncomeEventType]} />
            </IconCircle>
            {label}
          </TypeButton>
        ))}
      </GridContainer>
    </Dialog>
  );
};

export default EventTypeSelectionDialog;
