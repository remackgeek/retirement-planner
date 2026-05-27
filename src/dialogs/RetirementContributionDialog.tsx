import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import { confirmDialog } from 'primereact/confirmdialog';
import type { IncomeEvent, ContributionType } from '../types/IncomeEvent';
import type { Account, AccountType } from '../types/Account';
import { spacing, colors, fontSize, border, dialogWidth } from '../styles/theme';
import { buildAgeOptions, buildEndAgeOptions, incomeEventAgeRanges } from '../utils/ageOptions';
import { generateDefaultIncomeEventName, eventTypeIcons } from '../utils/defaultName';
import { resolveOwnerAge } from '../utils/ownerAge';

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

const AmountRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 9rem;
  gap: ${spacing.sm};
  align-items: start;
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

interface RetirementContributionDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (event: Omit<IncomeEvent, 'id'>) => void;
  onDelete?: () => void;
  editEvent?: IncomeEvent;
  existingEvents: IncomeEvent[];
  accounts: Account[];
  currentAge: number;
  spouseAge: number | null;
  filingStatus: 'single' | 'mfs' | 'mfj' | 'hoh';
  referenceYear: number;
}

const accountTypeForContribution: Record<ContributionType, AccountType> = {
  pre_tax: 'traditional',
  roth: 'roth',
  after_tax: 'brokerage',
};

const makeDefaultFormData = () => ({
  name: '',
  owner: 'self' as 'self' | 'spouse',
  contributionType: 'pre_tax' as ContributionType,
  displayAmount: 0,
  amountPeriod: 'annual' as 'monthly' | 'annual',
  startAge: 40,
  endAge: 65 as number | undefined,
  colaType: 'inflation_adjusted' as 'fixed' | 'inflation_adjusted',
  accountId: undefined as string | undefined,
  employerMatchEnabled: false,
  employerMatchPercent: 100,
  employerMatchCeilingPercent: 6,
  wageEventId: undefined as string | undefined,
});

const RetirementContributionDialog: React.FC<RetirementContributionDialogProps> = ({
  visible,
  onHide,
  onSave,
  onDelete,
  editEvent,
  existingEvents,
  accounts,
  currentAge,
  spouseAge,
  filingStatus,
  referenceYear,
}) => {
  const isEditing = !!editEvent;
  const isMfj = filingStatus === 'mfj';
  const [formData, setFormData] = useState(makeDefaultFormData());

  const ownerAge = resolveOwnerAge(formData.owner, currentAge, spouseAge);
  const range = incomeEventAgeRanges['retirement_contribution'];
  const effectiveMin = Math.min(range.min, formData.startAge);
  const effectiveEndMin = Math.max(range.min, formData.startAge + 1);
  const startAgeOptions = buildAgeOptions(referenceYear, ownerAge, effectiveMin, range.max);
  const endAgeOptions = buildEndAgeOptions(referenceYear, ownerAge, effectiveEndMin, range.max);

  useEffect(() => {
    if (!visible) return;
    if (editEvent) {
      const period = editEvent.amountPeriod ?? 'annual';
      const displayAmount = period === 'monthly' ? editEvent.amount / 12 : editEvent.amount;
      setFormData({
        name: editEvent.name,
        owner: editEvent.owner ?? 'self',
        contributionType: editEvent.contributionType ?? 'pre_tax',
        displayAmount,
        amountPeriod: period,
        startAge: editEvent.startAge,
        endAge: editEvent.endAge,
        colaType: editEvent.colaType,
        accountId: editEvent.accountId,
        employerMatchEnabled: (editEvent.employerMatchPercent ?? 0) > 0,
        employerMatchPercent: editEvent.employerMatchPercent ?? 100,
        employerMatchCeilingPercent: editEvent.employerMatchCeilingPercent ?? 6,
        wageEventId: editEvent.wageEventId,
      });
    } else {
      setFormData({
        ...makeDefaultFormData(),
        startAge: currentAge,
        endAge: Math.min(range.max, currentAge + 20),
        name: generateDefaultIncomeEventName('retirement_contribution', existingEvents),
      });
    }
  }, [visible, editEvent, existingEvents, currentAge]);

  const requiredAccountType = accountTypeForContribution[formData.contributionType];
  const eligibleAccounts = accounts.filter((a) => a.type === requiredAccountType);
  const wageEvents = existingEvents.filter(
    (e) => e.type === 'wage_income' && (!editEvent || e.id !== editEvent.id)
  );

  const handlePeriodChange = (newPeriod: 'monthly' | 'annual') => {
    if (newPeriod === formData.amountPeriod) return;
    const converted =
      newPeriod === 'monthly'
        ? formData.displayAmount / 12
        : formData.displayAmount * 12;
    setFormData({
      ...formData,
      amountPeriod: newPeriod,
      displayAmount: Math.round(converted * 100) / 100,
    });
  };

  const handleContributionTypeChange = (newType: ContributionType) => {
    // Clear accountId when switching type so it doesn't point at an account of the wrong type.
    setFormData({ ...formData, contributionType: newType, accountId: undefined });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const annualAmount =
      formData.amountPeriod === 'monthly'
        ? formData.displayAmount * 12
        : formData.displayAmount;
    onSave({
      type: 'retirement_contribution',
      name: formData.name,
      owner: formData.owner,
      amount: annualAmount,
      amountPeriod: formData.amountPeriod,
      startAge: formData.startAge,
      endAge: formData.endAge,
      taxStatus: 'before_tax', // structurally unused by retirement_contribution; keep field set.
      colaType: formData.colaType,
      contributionType: formData.contributionType,
      accountId: formData.accountId,
      employerMatchPercent: formData.employerMatchEnabled ? formData.employerMatchPercent : undefined,
      employerMatchCeilingPercent: formData.employerMatchEnabled ? formData.employerMatchCeilingPercent : undefined,
      wageEventId: formData.wageEventId,
    });
    onHide();
  };

  const periodOptions = [
    { label: 'Monthly', value: 'monthly' },
    { label: 'Annual', value: 'annual' },
  ];

  const ownerOptions = [
    { label: 'Self', value: 'self' },
    { label: 'Spouse', value: 'spouse' },
  ];

  const contributionTypeOptions = [
    { label: 'Pre-tax (Traditional 401k/IRA)', value: 'pre_tax' },
    { label: 'Roth (Roth 401k/IRA)', value: 'roth' },
    { label: 'After-tax (Brokerage)', value: 'after_tax' },
  ];

  const dialogFooter = (
    <div>
      <Button label='Cancel' icon='pi pi-times' onClick={onHide} className='p-button-text' />
      <Button
        label={isEditing ? 'Save Changes' : 'Add Event'}
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
            <i className={eventTypeIcons['retirement_contribution']} style={{ marginRight: spacing.sm, color: colors.primary }} />
            {isEditing ? 'Edit Retirement Contribution' : 'Add Retirement Contribution'}
          </span>
          {onDelete && (
            <TrashButton onClick={handleDeleteClick} title="Delete">
              <i className="pi pi-trash" />
            </TrashButton>
          )}
        </div>
      }
      visible={visible}
      style={dialogWidth('34rem')}
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

        <InputGroup>
          <label>Contribution Type</label>
          <Dropdown
            value={formData.contributionType}
            options={contributionTypeOptions}
            onChange={(e) => handleContributionTypeChange(e.value)}
          />
          <HelpText>
            {formData.contributionType === 'pre_tax' &&
              'Pre-tax contributions reduce this year’s taxable income and grow tax-deferred. Withdrawals are taxed as ordinary income.'}
            {formData.contributionType === 'roth' &&
              'Roth contributions are made with after-tax dollars. Growth and qualified withdrawals are tax-free.'}
            {formData.contributionType === 'after_tax' &&
              'After-tax contributions go to a brokerage account. Growth is taxed (LTCG on withdrawal in this model).'}
          </HelpText>
        </InputGroup>

        {isMfj && (
          <InputGroup>
            <label>Owner</label>
            <Dropdown
              value={formData.owner}
              options={ownerOptions}
              onChange={(e) => setFormData({ ...formData, owner: e.value })}
            />
          </InputGroup>
        )}

        <InputGroup>
          <label>Contribution Amount</label>
          <AmountRow>
            <InputNumber
              value={formData.displayAmount}
              onValueChange={(e) => setFormData({ ...formData, displayAmount: e.value || 0 })}
              mode='currency'
              currency='USD'
              required
            />
            <Dropdown
              value={formData.amountPeriod}
              options={periodOptions}
              onChange={(e) => handlePeriodChange(e.value)}
            />
          </AmountRow>
          <CheckboxGroup>
            <Checkbox
              inputId='colaType'
              checked={formData.colaType === 'inflation_adjusted'}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  colaType: e.checked ? 'inflation_adjusted' : 'fixed',
                })
              }
            />
            <label htmlFor='colaType'>Inflation adjusted</label>
          </CheckboxGroup>
        </InputGroup>

        <FieldRow>
          <InputGroup>
            <label>Start Age</label>
            <Dropdown
              value={formData.startAge}
              options={startAgeOptions}
              onChange={(e) => setFormData({
                ...formData,
                startAge: e.value,
                endAge: formData.endAge && formData.endAge <= e.value ? undefined : formData.endAge,
              })}
            />
          </InputGroup>
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
        </FieldRow>

        <InputGroup>
          <label>Target Account</label>
          <Dropdown
            value={formData.accountId ?? ''}
            options={[
              { label: `Default (first ${requiredAccountType})`, value: '' },
              ...eligibleAccounts.map((a) => ({ label: a.name, value: a.id })),
            ]}
            onChange={(e) => setFormData({ ...formData, accountId: e.value || undefined })}
          />
          {eligibleAccounts.length === 0 && (
            <HelpText>
              No {requiredAccountType} accounts exist. Create one in the Accounts section, or the
              contribution will fall back to the first available account.
            </HelpText>
          )}
        </InputGroup>

        {wageEvents.length > 0 && (
          <InputGroup>
            <label>Linked Wage Event (optional)</label>
            <Dropdown
              value={formData.wageEventId ?? ''}
              options={[
                { label: 'None — match base = contribution amount', value: '' },
                ...wageEvents.map((w) => ({ label: w.name, value: w.id })),
              ]}
              onChange={(e) =>
                setFormData({ ...formData, wageEventId: e.value || undefined })
              }
            />
            <HelpText>
              When set, employer match ceiling is computed against this wage event’s annual
              amount instead of the contribution amount.
            </HelpText>
          </InputGroup>
        )}

        <CheckboxGroup>
          <Checkbox
            inputId='employerMatchEnabled'
            checked={formData.employerMatchEnabled}
            onChange={(e) =>
              setFormData({ ...formData, employerMatchEnabled: e.checked || false })
            }
          />
          <label htmlFor='employerMatchEnabled'>Employer match</label>
        </CheckboxGroup>

        {formData.employerMatchEnabled && (
          <FieldRow>
            <InputGroup>
              <label>Match %</label>
              <InputNumber
                value={formData.employerMatchPercent}
                onValueChange={(e) =>
                  setFormData({ ...formData, employerMatchPercent: e.value || 0 })
                }
                suffix='%'
                min={0}
                max={500}
              />
            </InputGroup>
            <InputGroup>
              <label>Up to (% of wages)</label>
              <InputNumber
                value={formData.employerMatchCeilingPercent}
                onValueChange={(e) =>
                  setFormData({ ...formData, employerMatchCeilingPercent: e.value || 0 })
                }
                suffix='%'
                min={0}
                max={100}
              />
            </InputGroup>
          </FieldRow>
        )}
      </Form>
    </Dialog>
  );
};

export default RetirementContributionDialog;
