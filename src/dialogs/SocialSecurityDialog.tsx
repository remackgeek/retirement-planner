import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import type { IncomeEvent } from '../types/IncomeEvent';
import { spacing, colors, fontSize } from '../styles/theme';
import { generateDefaultIncomeEventName } from '../utils/defaultName';

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  padding: ${spacing.sm} 0;

  .p-inputtext,
  .p-dropdown,
  .p-inputnumber {
    width: 100%;
  }
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing.md};
`;

const CheckboxGroup = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
`;

const HelpText = styled.small`
  color: ${colors.textMuted};
  font-size: ${fontSize.xs};
`;

interface SocialSecurityDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (event: Omit<IncomeEvent, 'id'>) => void;
  editEvent?: IncomeEvent;
  filingStatus: 'single' | 'mfs' | 'mfj' | 'hoh';
  spouseName: string | null;
  existingSSEvents: IncomeEvent[];
}

const makeDefaultFormData = () => ({
  name: '',
  owner: 'self' as 'self' | 'spouse',
  amount: 0,
  startAge: 67,
  ssAmountBasis: 'today' as 'today' | 'future',
  ssHaircutEnabled: true,
  ssHaircutPercent: 23,
});

const SocialSecurityDialog: React.FC<SocialSecurityDialogProps> = ({
  visible,
  onHide,
  onSave,
  editEvent,
  filingStatus,
  spouseName,
  existingSSEvents,
}) => {
  const isEditing = !!editEvent;
  const [formData, setFormData] = useState(makeDefaultFormData());

  const isMfj = filingStatus === 'mfj';

  // Determine which owner slots are already taken (excluding the event being edited)
  const takenOwners = existingSSEvents
    .filter((e) => !editEvent || e.id !== editEvent.id)
    .map((e) => e.owner ?? 'self');

  const selfTaken = takenOwners.includes('self');
  const spouseTaken = takenOwners.includes('spouse');

  useEffect(() => {
    if (!visible) return;
    if (editEvent) {
      setFormData({
        name: editEvent.name,
        owner: editEvent.owner ?? 'self',
        amount: editEvent.amount,
        startAge: editEvent.startAge,
        ssAmountBasis: editEvent.ssAmountBasis ?? 'today',
        ssHaircutEnabled: editEvent.ssHaircutEnabled !== false,
        ssHaircutPercent: editEvent.ssHaircutPercent ?? 23,
      });
    } else {
      // Auto-select the available slot
      const defaultOwner: 'self' | 'spouse' = isMfj && selfTaken && !spouseTaken ? 'spouse' : 'self';
      const defaults = { ...makeDefaultFormData(), owner: defaultOwner };
      defaults.name = generateDefaultIncomeEventName('social_security', existingSSEvents);
      setFormData(defaults);
    }
  }, [visible, editEvent, isMfj, selfTaken, spouseTaken, existingSSEvents]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      type: 'social_security',
      name: formData.name,
      owner: isMfj ? formData.owner : 'self',
      amount: formData.amount,
      startAge: formData.startAge,
      taxStatus: 'before_tax',
      colaType: 'inflation_adjusted',
      ssAmountBasis: formData.ssAmountBasis,
      ssHaircutEnabled: formData.ssHaircutEnabled,
      ssHaircutPercent: formData.ssHaircutPercent,
    });
    onHide();
  };

  const amountBasisOptions = [
    { label: "Today's Dollars", value: 'today' },
    { label: 'Adjusted for Future Inflation', value: 'future' },
  ];

  const ownerOptions = [
    { label: 'Self', value: 'self', disabled: selfTaken },
    { label: spouseName || 'Spouse', value: 'spouse', disabled: spouseTaken },
  ];

  const dialogFooter = (
    <div>
      <Button
        label='Cancel'
        icon='pi pi-times'
        onClick={onHide}
        className='p-button-text'
      />
      <Button
        label={isEditing ? 'Save Changes' : 'Add Event'}
        icon='pi pi-check'
        onClick={handleSubmit}
        type='submit'
      />
    </div>
  );

  return (
    <Dialog
      header={isEditing ? 'Edit Social Security' : 'Add Social Security'}
      visible={visible}
      style={{ width: '32rem' }}
      onHide={onHide}
      footer={dialogFooter}
    >
      <Form onSubmit={handleSubmit}>
        <InputGroup>
          <label>Name</label>
          <InputText
            value={formData.name}
            onChange={(e) =>
              setFormData({ ...formData, name: e.target.value })
            }
            required
          />
        </InputGroup>

        {isMfj && (
          <InputGroup>
            <label>Benefit Owner</label>
            <Dropdown
              value={formData.owner}
              options={ownerOptions}
              onChange={(e) => setFormData({ ...formData, owner: e.value })}
            />
          </InputGroup>
        )}

        <InputGroup>
          <label>Annual Benefit</label>
          <InputNumber
            value={formData.amount}
            onValueChange={(e) =>
              setFormData({ ...formData, amount: e.value || 0 })
            }
            mode='currency'
            currency='USD'
            required
          />
          <HelpText>
            {formData.ssAmountBasis === 'future'
              ? 'Projected nominal amount at claiming age — COLA applied after claiming'
              : 'Amount from your SSA statement — will be adjusted for inflation'}
          </HelpText>
        </InputGroup>

        <FieldRow>
          <InputGroup>
            <label>Claiming Age</label>
            <InputNumber
              value={formData.startAge}
              onValueChange={(e) =>
                setFormData({ ...formData, startAge: e.value || 67 })
              }
              min={62}
              max={70}
              required
            />
          </InputGroup>

          <InputGroup>
            <label>Amount Type</label>
            <Dropdown
              value={formData.ssAmountBasis}
              options={amountBasisOptions}
              onChange={(e) => setFormData({ ...formData, ssAmountBasis: e.value })}
            />
          </InputGroup>
        </FieldRow>

        <CheckboxGroup>
          <Checkbox
            inputId='ssHaircutEnabled'
            checked={formData.ssHaircutEnabled}
            onChange={(e) =>
              setFormData({ ...formData, ssHaircutEnabled: e.checked || false })
            }
          />
          <label htmlFor='ssHaircutEnabled'>
            Apply trust fund reduction (from 2034)
          </label>
        </CheckboxGroup>

        {formData.ssHaircutEnabled && (
          <InputGroup>
            <label>Reduction Percentage</label>
            <InputNumber
              value={formData.ssHaircutPercent}
              onValueChange={(e) =>
                setFormData({ ...formData, ssHaircutPercent: e.value ?? 23 })
              }
              suffix='%'
              min={0}
              max={100}
            />
            <HelpText>
              Current trustees estimate: 23% reduction when trust fund is exhausted
            </HelpText>
          </InputGroup>
        )}
      </Form>
    </Dialog>
  );
};

export default SocialSecurityDialog;
