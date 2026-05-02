import React, { useState, useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import type { IncomeEvent } from '../types/IncomeEvent';
import type { UserData } from '../types/UserData';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, border, fontSize } from '../styles/theme';
import { buildAgeOptions, buildEndAgeOptions, incomeEventAgeRanges } from '../utils/ageOptions';
import { generateDefaultIncomeEventName, eventTypeIcons } from '../utils/defaultName';
import { resolveOwnerAge } from '../utils/ownerAge';
import { estimateConversionImpact } from '../services/conversionImpact';

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

const Disclaimer = styled.div`
  margin-top: ${spacing.sm};
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
  color: ${colors.textMuted};
  font-size: ${fontSize.xs};
  line-height: 1.4;
`;

const DisclaimerLabel = styled.strong`
  color: ${colors.textSecondary};
  font-weight: 600;
`;

const TrashButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: ${spacing.xs};
  border-radius: ${border.radius};
  color: ${colors.danger};
  font-size: ${fontSize.xl};
  line-height: 1;
  display: flex;
  align-items: center;

  &:hover {
    color: ${colors.dangerHover};
    background: ${colors.bgMedium};
  }
`;

const ImpactPanel = styled.div`
  margin-top: ${spacing.sm};
  padding: ${spacing.sm} ${spacing.md};
  background: ${colors.bgLight};
  border: ${border.light};
  border-radius: ${border.radius};
`;

const ImpactHeader = styled.div`
  font-weight: bold;
  font-size: ${fontSize.sm};
  color: ${colors.textPrimary};
  margin-bottom: ${spacing.xs};
`;

const ImpactGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing.xs} ${spacing.md};
`;

const ImpactLabel = styled.span`
  color: ${colors.textSecondary};
  font-size: ${fontSize.xs};
`;

const ImpactValue = styled.span`
  color: ${colors.textPrimary};
  font-size: ${fontSize.sm};
  font-weight: 600;
  text-align: right;
`;

interface RothConversionDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (event: Omit<IncomeEvent, 'id'>) => void;
  onDelete?: () => void;
  editEvent?: IncomeEvent;
  existingEvents: IncomeEvent[];
  userData: UserData;
}

const makeDefaultFormData = () => ({
  name: '',
  owner: 'self' as 'self' | 'spouse',
  amount: 0,
  startAge: 65,
  endAge: undefined as number | undefined,
  isOneTime: false,
  colaType: 'fixed' as 'fixed' | 'inflation_adjusted',
});

const currency = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const RothConversionDialog: React.FC<RothConversionDialogProps> = ({
  visible,
  onHide,
  onSave,
  onDelete,
  editEvent,
  existingEvents,
  userData,
}) => {
  const isEditing = !!editEvent;
  const isMfj = userData.filingStatus === 'mfj';
  const [formData, setFormData] = useState(makeDefaultFormData());

  const ownerAge = resolveOwnerAge(formData.owner, userData.currentAge, userData.spouseAge);
  const range = incomeEventAgeRanges['roth_conversion'];
  const effectiveMin = Math.min(range.min, formData.startAge);
  const effectiveEndMin = formData.endAge ? Math.min(range.min, formData.endAge) : range.min;
  const startAgeOptions = buildAgeOptions(userData.referenceYear, ownerAge, effectiveMin, range.max);
  const endAgeOptions = buildEndAgeOptions(userData.referenceYear, ownerAge, effectiveEndMin, range.max);

  useEffect(() => {
    if (!visible) return;
    if (editEvent) {
      setFormData({
        name: editEvent.name,
        owner: editEvent.owner ?? 'self',
        amount: editEvent.amount,
        startAge: editEvent.startAge,
        endAge: editEvent.endAge,
        isOneTime: editEvent.isOneTime ?? false,
        colaType: editEvent.colaType,
      });
    } else {
      setFormData({
        ...makeDefaultFormData(),
        name: generateDefaultIncomeEventName('roth_conversion', existingEvents),
      });
    }
  }, [visible, editEvent, existingEvents]);

  const impact = useMemo(() => {
    if (!formData.amount || formData.amount <= 0) return null;
    const draft: Omit<IncomeEvent, 'id'> = {
      type: 'roth_conversion',
      name: formData.name || 'Draft',
      owner: formData.owner,
      amount: formData.amount,
      startAge: formData.startAge,
      endAge: formData.isOneTime ? undefined : formData.endAge,
      isOneTime: formData.isOneTime,
      taxStatus: 'before_tax',
      colaType: formData.colaType,
    };
    return estimateConversionImpact(userData, { id: 'preview', ...draft });
  }, [userData, formData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      type: 'roth_conversion',
      name: formData.name,
      owner: formData.owner,
      amount: formData.amount,
      startAge: formData.startAge,
      endAge: formData.isOneTime ? undefined : formData.endAge,
      isOneTime: formData.isOneTime,
      taxStatus: 'before_tax',
      colaType: formData.colaType,
    });
    onHide();
  };

  const ownerOptions = [
    { label: 'Self', value: 'self' },
    { label: 'Spouse', value: 'spouse' },
  ];

  const dialogFooter = (
    <div>
      <Button label='Cancel' icon='pi pi-times' onClick={onHide} className='p-button-text' />
      <Button
        label={isEditing ? 'Save Changes' : 'Add Conversion'}
        icon='pi pi-check'
        onClick={handleSubmit}
        type='submit'
      />
    </div>
  );

  const handleDeleteClick = () => {
    confirmDialog({
      message: `Are you sure you want to delete "${formData.name}"?`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      accept: onDelete,
    });
  };

  return (
    <Dialog
      header={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>
            <i className={eventTypeIcons['roth_conversion']} style={{ marginRight: spacing.sm, color: colors.primary }} />
            {isEditing ? 'Edit Roth Conversion' : 'Add Roth Conversion'}
          </span>
          {onDelete && (
            <TrashButton onClick={handleDeleteClick} title="Delete">
              <i className="pi pi-trash" />
            </TrashButton>
          )}
        </div>
      }
      visible={visible}
      style={{ width: '34rem' }}
      onHide={onHide}
      closable={false}
      closeOnEscape={true}
      footer={dialogFooter}
    >
      <Form onSubmit={handleSubmit}>
        <InputGroup>
          <label>Name</label>
          <InputText
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
        </InputGroup>

        {isMfj && (
          <InputGroup>
            <label>Account Owner</label>
            <Dropdown
              value={formData.owner}
              options={ownerOptions}
              onChange={(e) => setFormData({ ...formData, owner: e.value })}
            />
          </InputGroup>
        )}

        <InputGroup>
          <label>Annual Conversion Amount</label>
          <InputNumber
            value={formData.amount}
            onValueChange={(e) => setFormData({ ...formData, amount: e.value || 0 })}
            mode='currency'
            currency='USD'
            required
          />
          <HelpText>
            Gross amount moved from Traditional to Roth each year (today's dollars).
            Taxed as ordinary income; tax is paid from taxable accounts first via the
            usual withdrawal waterfall.
          </HelpText>
        </InputGroup>

        <CheckboxGroup>
          <Checkbox
            inputId='rothConvOneTime'
            checked={formData.isOneTime}
            onChange={(e) => setFormData({ ...formData, isOneTime: e.checked || false })}
          />
          <label htmlFor='rothConvOneTime'>One-time conversion (single year only)</label>
        </CheckboxGroup>

        <FieldRow>
          <InputGroup>
            <label>Start Age</label>
            <Dropdown
              value={formData.startAge}
              options={startAgeOptions}
              onChange={(e) => setFormData({ ...formData, startAge: e.value })}
            />
          </InputGroup>

          {!formData.isOneTime && (
            <InputGroup>
              <label>End Age (optional)</label>
              <Dropdown
                value={formData.endAge ?? 0}
                options={endAgeOptions}
                onChange={(e) =>
                  setFormData({ ...formData, endAge: e.value === 0 ? undefined : e.value })
                }
              />
            </InputGroup>
          )}
        </FieldRow>

        <CheckboxGroup>
          <Checkbox
            inputId='rothConvCola'
            checked={formData.colaType === 'inflation_adjusted'}
            onChange={(e) =>
              setFormData({
                ...formData,
                colaType: e.checked ? 'inflation_adjusted' : 'fixed',
              })
            }
          />
          <label htmlFor='rothConvCola'>Inflation-adjusted amount</label>
        </CheckboxGroup>

        {impact && (
          <ImpactPanel>
            <ImpactHeader>
              <i className='pi pi-chart-line' style={{ marginRight: spacing.xs }} />
              Impact Preview
            </ImpactHeader>
            <ImpactGrid>
              <ImpactLabel>Estimated tax in first year</ImpactLabel>
              <ImpactValue>{currency(impact.firstYearTax)}</ImpactValue>
              {!formData.isOneTime && (
                <>
                  <ImpactLabel>Total tax over conversion period</ImpactLabel>
                  <ImpactValue>{currency(impact.totalTaxOverConversion)}</ImpactValue>
                </>
              )}
              <ImpactLabel>RMD reduction at age 73</ImpactLabel>
              <ImpactValue>{currency(impact.rmdReductionAt73)}</ImpactValue>
              <ImpactLabel>Tax-free Roth at life expectancy</ImpactLabel>
              <ImpactValue>{currency(impact.projectedRothAtEndOfPlan)}</ImpactValue>
            </ImpactGrid>
            <Disclaimer>
              <div>
                <DisclaimerLabel>What this estimate includes:</DisclaimerLabel>{' '}
                federal and state ordinary income tax on the converted amount, RMD
                reduction at age 73, and projected tax-free Roth growth at the plan's
                blended return.
              </div>
              <div>
                <DisclaimerLabel>What it doesn't include:</DisclaimerLabel>{' '}
                Medicare IRMAA surcharges (cliff-based, two-year lookback — can add
                thousands per year), Social Security taxability interactions, the
                3.8% Net Investment Income Tax, ACA premium tax credit effects before
                65, and the surviving-spouse shift from joint to single brackets.
                Each of these can materially change whether a conversion is
                worthwhile.
              </div>
              <div>
                Treat this as a starting point, not a recommendation. Talk to a tax
                professional before executing a real conversion.
              </div>
            </Disclaimer>
          </ImpactPanel>
        )}
      </Form>
    </Dialog>
  );
};

export default RothConversionDialog;
