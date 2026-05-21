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
import {
  estimateConversionImpact,
  exceedsSpendingHeuristic,
  crossesMultipleBracketsHeuristic,
  exceedsMostOfTradHeuristic,
} from '../services/conversionImpact';

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

const WarningHint = styled.div`
  color: ${colors.warning};
  background: ${colors.warningBg};
  border-radius: ${border.radius};
  padding: ${spacing.xs} ${spacing.sm};
  font-size: ${fontSize.xs};
  line-height: 1.4;
`;

const WarningList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
  margin-top: ${spacing.xs};
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
  colaType: 'inflation_adjusted' as 'fixed' | 'inflation_adjusted',
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
  const effectiveEndMin = Math.max(range.min, formData.startAge + 1);
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
        startAge: Math.max(incomeEventAgeRanges['roth_conversion'].min, userData.currentAge),
        name: generateDefaultIncomeEventName('roth_conversion', existingEvents),
      });
    }
  }, [visible, editEvent, existingEvents, userData.currentAge]);

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
    return estimateConversionImpact(userData, {
      id: editEvent?.id ?? 'preview',
      ...draft,
    });
  }, [userData, formData, editEvent?.id]);

  const warnings = useMemo(() => {
    if (!formData.amount || formData.amount <= 0) return [] as string[];
    const draft: IncomeEvent = {
      id: editEvent?.id ?? 'preview',
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
    const list: string[] = [];
    if (exceedsSpendingHeuristic(userData, draft)) {
      list.push(
        'This conversion is large relative to your spending — it may force significant additional Traditional withdrawals to cover the conversion tax.',
      );
    }
    if (crossesMultipleBracketsHeuristic(userData, draft)) {
      list.push(
        'This conversion crosses multiple federal tax brackets. Smaller annual amounts often produce better outcomes.',
      );
    }
    if (exceedsMostOfTradHeuristic(userData, draft)) {
      list.push(
        'This will convert most of your Traditional balance. Consider whether a smaller schedule would better balance early tax cost against future RMD savings.',
      );
    }
    return list;
  }, [userData, formData, editEvent?.id]);

  const sourcingWarnings = useMemo(() => {
    if (!impact) return [] as string[];
    const list: string[] = [];
    if (impact.conversionWithheldYears > 0) {
      const years = impact.conversionWithheldYears;
      const dollars = impact.conversionWithheldDollars;
      list.push(
        `Withholding kicks in in ${years} year${years === 1 ? '' : 's'} ` +
          `(${currency(dollars)} total withheld) because your Taxable balance (and any ` +
          `RMD-excess cash) can't cover the conversion's marginal ordinary tax. The conversion ` +
          `still executes — but the Roth deposit shrinks by the withheld amount. This is IRS-allowed ` +
          `(Form 1099-R Box 4 withholding) but reduces the conversion's long-term benefit vs. ` +
          `paying tax from Taxable. Add Taxable funds or reduce the conversion to avoid withholding.`
      );
    }
    if (impact.conversionShortfallYears > 0) {
      const years = impact.conversionShortfallYears;
      const dollars = impact.conversionShortfallDollars;
      list.push(
        `In ${years} year${years === 1 ? '' : 's'}, your Traditional balance is too small to ` +
          `support the full requested conversion. Total shortfall: ${currency(dollars)}.`
      );
    }
    return list;
  }, [impact]);

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
            Gross amount moved from Traditional to Roth each year, in today's dollars.
            With <em>Inflation-adjusted amount</em> on (default), the nominal amount
            grows each year so the real-dollar conversion stays constant; turn it off
            for a fixed-nominal schedule. Taxed as ordinary income. Tax sourcing:
            RMD-excess → Taxable → withheld from the conversion itself
            (IRS Form 1099-R Box 4) if neither covers the marginal tax. Never pulled
            from Traditional-above-RMD or Roth — that would defeat the conversion.
            Withholding always lets the conversion execute, but reduces the Roth
            deposit and gives up some of the tax arbitrage vs. paying from Taxable.
          </HelpText>
          {(warnings.length > 0 || sourcingWarnings.length > 0) && (
            <WarningList>
              {sourcingWarnings.map((w, i) => (
                <WarningHint key={`src-${i}`}>{w}</WarningHint>
              ))}
              {warnings.map((w, i) => (
                <WarningHint key={i}>{w}</WarningHint>
              ))}
            </WarningList>
          )}
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
              onChange={(e) => setFormData({
                ...formData,
                startAge: e.value,
                endAge: formData.endAge && formData.endAge <= e.value ? undefined : formData.endAge,
              })}
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
              <ImpactLabel>Net impact on plan value</ImpactLabel>
              <ImpactValue
                style={{
                  color: impact.netPlanValueImpact >= 0 ? colors.income : colors.danger,
                }}
              >
                {currency(impact.netPlanValueImpact)}
              </ImpactValue>
            </ImpactGrid>
            <Disclaimer>
              <div>
                <DisclaimerLabel>Tax rows above (first-year, total):</DisclaimerLabel>{' '}
                quick incremental-tax estimates against your baseline ordinary
                income, including the SS provisional-income bump. They don't
                include IRMAA or NIIT — those effects are folded into the Net
                impact row and the live success probability.
              </div>
              <div>
                <DisclaimerLabel>What it still doesn't include:</DisclaimerLabel>{' '}
                ACA premium tax credit effects before 65, the surviving-spouse
                shift from joint to single brackets, and federal 0/15/20% LTCG
                bracket stacking. Each can materially change whether a conversion
                is worthwhile.
              </div>
              <div>
                <DisclaimerLabel>Net impact reflects the engine's full behavior:</DisclaimerLabel>{' '}
                when you add a conversion, the engine also auto-switches the
                spending waterfall to <em>bracket-aware</em> mode (pulling
                Traditional cheaply in low-bracket years to preserve Taxable).
                That switch contributes to the Net impact alongside the
                conversion itself. To isolate the conversion alone, set
                <code style={{ fontSize: 'inherit' }}> spendingWithdrawalOrder</code> explicitly on the scenario
                JSON so both before/after use the same waterfall.
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
