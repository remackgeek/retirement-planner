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
import type { BracketTarget, StrategyObjective, PerYearStrategyDecision } from '../services/strategies/types';
import { confirmDialog } from 'primereact/confirmdialog';
import { spacing, colors, border, fontSize, dialogWidth } from '../styles/theme';
import { buildAgeOptions, buildEndAgeOptions, incomeEventAgeRanges } from '../utils/ageOptions';
import { generateDefaultIncomeEventName, eventTypeIcons } from '../utils/defaultName';
import { resolveOwnerAge } from '../utils/ownerAge';
import {
  estimateConversionImpact,
  exceedsSpendingHeuristic,
  crossesMultipleBracketsHeuristic,
  exceedsMostOfTradHeuristic,
} from '../services/conversionImpact';
import { strategyComputeClient, StrategyCancelledError } from '../services/StrategyComputeClient';

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

const ModeTabBar = styled.div`
  display: flex;
  gap: ${spacing.xs};
  border-bottom: ${border.light};
  margin-bottom: ${spacing.sm};
`;

const ModeTab = styled.button<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? colors.bgLight : 'transparent')};
  border: none;
  border-bottom: 2px solid ${({ $active }) => ($active ? colors.primary : 'transparent')};
  padding: ${spacing.xs} ${spacing.md};
  font-size: ${fontSize.sm};
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  color: ${({ $active }) => ($active ? colors.textPrimary : colors.textSecondary)};
  cursor: pointer;
  &:hover { color: ${colors.textPrimary}; }
`;

const WizardTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${fontSize.xs};
  margin-top: ${spacing.sm};
  th, td {
    padding: ${spacing.xs} ${spacing.sm};
    text-align: left;
    border-bottom: ${border.light};
  }
  th {
    color: ${colors.textSecondary};
    font-weight: 600;
    background: ${colors.bgLight};
  }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
`;

const WizardMessage = styled.div`
  padding: ${spacing.sm};
  background: ${colors.bgLight};
  border-radius: ${border.radius};
  font-size: ${fontSize.xs};
  line-height: 1.4;
  color: ${colors.textPrimary};
`;

const OpenLoopCaveat = styled.div`
  margin-top: ${spacing.sm};
  padding: ${spacing.xs} ${spacing.sm};
  background: ${colors.bgLight};
  border-left: 3px solid ${colors.primary};
  color: ${colors.textSecondary};
  font-size: ${fontSize.xs};
  line-height: 1.4;
`;

interface RothConversionDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (event: Omit<IncomeEvent, 'id'>) => void;
  onDelete?: () => void;
  editEvent?: IncomeEvent;
  existingEvents: IncomeEvent[];
  userData: UserData;
  /** Apply a generator-produced batch of conversion events. Caller is
   *  responsible for replacing existing generator-tagged events and
   *  preserving manual ones. When undefined, the wizard tab is hidden. */
  onApplyBatch?: (events: Omit<IncomeEvent, 'id'>[]) => void;
}

type WizardMethod = 'fill_to_bracket' | 'auto_bracket' | 'optimize';
type Mode = 'single' | 'wizard';

const METHOD_OPTIONS: { label: string; value: WizardMethod }[] = [
  { label: 'Fill to bracket', value: 'fill_to_bracket' },
  { label: 'Auto bracket (grid search)', value: 'auto_bracket' },
  { label: 'Optimize (coordinate descent)', value: 'optimize' },
];

const BRACKET_OPTIONS: { label: string; value: BracketTarget }[] = [
  { label: '12% bracket', value: '12_percent' },
  { label: '22% bracket', value: '22_percent' },
  { label: '24% bracket', value: '24_percent' },
  { label: 'No conversions', value: 'none' },
];

const OBJECTIVE_OPTIONS: { label: string; value: StrategyObjective }[] = [
  { label: 'Max median terminal wealth', value: 'max_median_terminal_wealth' },
  { label: 'Min lifetime tax', value: 'min_lifetime_tax' },
];

const prettyBracket = (b: BracketTarget): string =>
  b === '12_percent' ? '12%'
    : b === '22_percent' ? '22%'
      : b === '24_percent' ? '24%'
        : 'none';

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
  onApplyBatch,
}) => {
  const isEditing = !!editEvent;
  const isMfj = userData.filingStatus === 'mfj';
  const [formData, setFormData] = useState(makeDefaultFormData());
  // Wizard mode is hidden when editing (it adds new events) and when no
  // onApplyBatch callback was supplied (caller opted out).
  const wizardAvailable = !isEditing && !!onApplyBatch;
  const [mode, setMode] = useState<Mode>('single');
  const [wizMethod, setWizMethod] = useState<WizardMethod>('fill_to_bracket');
  const [wizBracket, setWizBracket] = useState<BracketTarget>('12_percent');
  const [wizObjective, setWizObjective] = useState<StrategyObjective>('max_median_terminal_wealth');
  const [wizSchedule, setWizSchedule] = useState<PerYearStrategyDecision[] | null>(null);
  const [wizRunning, setWizRunning] = useState(false);
  const [wizMessage, setWizMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) {
      setMode('single');
      setWizSchedule(null);
      setWizMessage(null);
      // Reset wizard params too — a fresh open should always start at
      // Fill-to-bracket/12%/Max-terminal-wealth, not whatever the user
      // selected last session.
      setWizMethod('fill_to_bracket');
      setWizBracket('12_percent');
      setWizObjective('max_median_terminal_wealth');
    }
  }, [visible]);

  // Defensive: if the parent flips editEvent while the dialog is open and the
  // wizard tab is showing, the tab bar disappears (wizardAvailable becomes
  // false) but mode would still be 'wizard'. Reset to 'single' so the form
  // renders correctly. In practice IncomeEventsManager doesn't trigger this,
  // but defensive code is cheap and covers re-rendered parent state.
  useEffect(() => {
    if (editEvent && mode === 'wizard') setMode('single');
  }, [editEvent, mode]);

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
    // Edit-detaches-from-schedule: when editing a generator-tagged event, flip
    // meta.generatedBy to 'user'. The user explicitly touched this entry, so
    // it's no longer part of the regenerable schedule. Keeps generatorRunId
    // for audit but exempts the row from the next "Replace generated" pass.
    let meta = editEvent?.meta;
    if (meta && meta.generatedBy && meta.generatedBy !== 'user') {
      meta = { ...meta, generatedBy: 'user' };
    }
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
      ...(meta ? { meta } : {}),
    });
    onHide();
  };

  // ---------- Wizard handlers ----------

  // Build a UserData shape suitable for the compute backends. The engine
  // ignores `taxStrategy`, so we don't need to set it. The backends accept
  // a TaxStrategy argument explicitly.
  const wizardUserData: UserData = userData;

  const handleWizCompute = async () => {
    setWizRunning(true);
    // Show a visible "Computing…" message during the worker run so the
    // dialog doesn't look frozen during a 3–7 s Optimize. The result message
    // overwrites this on completion (or it clears on Cancel).
    const runningMessage =
      wizMethod === 'optimize'
        ? 'Optimizing… this takes a few seconds.'
        : wizMethod === 'auto_bracket'
          ? 'Auto-bracket grid search…'
          : 'Computing schedule…';
    setWizMessage(runningMessage);
    setWizSchedule(null);
    const t0 = performance.now();
    try {
      if (wizMethod === 'fill_to_bracket') {
        const schedule = await strategyComputeClient.computeFill(wizardUserData, {
          name: 'fill_to_bracket', bracketTarget: wizBracket,
        });
        const nonZero = schedule.filter((d) => d.conversionAmount > 0);
        setWizSchedule(schedule);
        setWizMessage(
          nonZero.length === 0
            ? `Fill-to-bracket(${prettyBracket(wizBracket)}): no conversions fit inside the bracket headroom for this scenario.`
            : `Generated ${nonZero.length} conversion year${nonZero.length === 1 ? '' : 's'} (Fill-to-bracket · ${prettyBracket(wizBracket)}). Click Apply to add to your plan.`
        );
      } else if (wizMethod === 'auto_bracket') {
        const result = await strategyComputeClient.computeAuto(wizardUserData, {
          name: 'auto_bracket', objective: wizObjective,
        });
        setWizSchedule(result.perYearDecisions);
        const baselineScore = result.candidateScores.find((c) => c.bracket === 'none')?.score
          ?? result.winnerScore;
        const delta = result.winnerScore - baselineScore;
        const pct = baselineScore !== 0 ? (delta / Math.abs(baselineScore)) * 100 : 0;
        const nonZero = result.perYearDecisions.filter((d) => d.conversionAmount > 0).length;
        if (result.chosenBracket === 'none') {
          setWizMessage(
            `Auto-bracket: keeping your current setup beats all bracket-fill options. Nothing to apply.`
          );
        } else if (delta > 0) {
          setWizMessage(
            `Auto-bracket chose the ${prettyBracket(result.chosenBracket)} schedule. ` +
            `Generated ${nonZero} conversion year${nonZero === 1 ? '' : 's'}. ` +
            `vs your current setup: +$${Math.round(delta).toLocaleString()} (+${pct.toFixed(2)}%) at end of plan.`
          );
        } else {
          setWizMessage(
            `Auto-bracket chose the ${prettyBracket(result.chosenBracket)} schedule. ` +
            `Generated ${nonZero} conversion year${nonZero === 1 ? '' : 's'}.`
          );
        }
      } else {
        const result = await strategyComputeClient.optimize(wizardUserData, {
          name: 'optimize', objective: wizObjective,
        });
        const elapsed = (performance.now() - t0) / 1000;
        setWizSchedule(result.perYearDecisions);
        const delta = result.finalScore - result.baselineScore;
        const pct = result.baselineScore !== 0 ? (delta / Math.abs(result.baselineScore)) * 100 : 0;
        const nonZero = result.perYearDecisions.filter((d) => d.conversionAmount > 0).length;
        if (delta > 0) {
          setWizMessage(
            `Optimized in ${elapsed.toFixed(1)}s (${result.projectionCount} projections). ` +
            `vs your current setup: +$${Math.round(delta).toLocaleString()} (+${pct.toFixed(2)}%) ` +
            `at end of plan, from ${nonZero} conversion year${nonZero === 1 ? '' : 's'}.`
          );
        } else {
          setWizMessage(
            `Optimized in ${elapsed.toFixed(1)}s. The optimizer couldn't improve on your current setup. ` +
            `Apply will add a zero-conversion schedule (effectively nothing).`
          );
        }
      }
    } catch (err) {
      // Cancellation is the normal "user clicked Cancel / closed dialog"
      // exit; don't show an error.
      if (!(err instanceof StrategyCancelledError)) {
        setWizMessage('Error: ' + (err as Error).message);
      }
    } finally {
      setWizRunning(false);
    }
  };

  // Cancel any in-flight compute. Wired to the Cancel button (shown only
  // while running) and to `onHide` so closing the dialog mid-run doesn't
  // leave a worker chewing through projections off-screen.
  const handleWizCancel = () => {
    strategyComputeClient.cancel();
    setWizRunning(false);
    setWizMessage(null);
  };

  const handleHide = () => {
    if (wizRunning) {
      strategyComputeClient.cancel();
      // Snap wizRunning false synchronously so a fast re-open doesn't briefly
      // mount with the Cancel-run button. The finally block in handleWizCompute
      // will also run as a microtask, but the explicit sync write here closes
      // the race window.
      setWizRunning(false);
    }
    onHide();
  };

  const handleWizApply = () => {
    if (!wizSchedule || !onApplyBatch) return;
    const nonZero = wizSchedule.filter((d) => d.conversionAmount > 0);
    if (nonZero.length === 0) {
      confirmDialog({
        message: 'The computed schedule has no non-zero conversion years — nothing to apply.',
        header: 'Empty schedule',
        icon: 'pi pi-info-circle',
        acceptLabel: 'OK',
        reject: undefined,
      });
      return;
    }
    const generatorName: NonNullable<IncomeEvent['meta']>['generatedBy'] =
      wizMethod === 'fill_to_bracket' ? 'fill_to_bracket'
        : wizMethod === 'auto_bracket' ? 'auto_bracket'
          : 'optimize';
    const generatedAt = new Date().toISOString().slice(0, 10);
    const generatorRunId = crypto.randomUUID();
    const batch: Omit<IncomeEvent, 'id'>[] = nonZero.map((d) => {
      const startAge = userData.currentAge + (d.year - userData.referenceYear);
      return {
        type: 'roth_conversion',
        name: `Roth conversion ${d.year}`,
        amount: d.conversionAmount,
        startAge,
        endAge: startAge,
        isOneTime: true,
        taxStatus: 'before_tax',
        colaType: 'fixed',
        meta: { generatedBy: generatorName, generatedAt, generatorRunId },
      };
    });
    // Replace-confirm fires only when there are existing generator-tagged
    // conversions to overwrite (manual events are always preserved by the
    // parent's handler). Per the plan, manual events are untouched.
    const hasGenerated = existingEvents.some(
      (e) => e.type === 'roth_conversion' && e.meta?.generatedBy && e.meta.generatedBy !== 'user'
    );
    const commit = () => {
      onApplyBatch(batch);
    };
    if (hasGenerated) {
      const genCount = existingEvents.filter(
        (e) => e.type === 'roth_conversion' && e.meta?.generatedBy && e.meta.generatedBy !== 'user'
      ).length;
      confirmDialog({
        message: `Replace ${genCount} previously generated Roth conversion${genCount === 1 ? '' : 's'} with the new schedule? Your manual conversions are preserved.`,
        header: 'Replace generated conversions?',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Replace',
        rejectLabel: 'Cancel',
        accept: commit,
      });
    } else {
      commit();
    }
  };

  const ownerOptions = [
    { label: 'Self', value: 'self' },
    { label: 'Spouse', value: 'spouse' },
  ];

  const dialogFooter = mode === 'wizard' ? (
    <div>
      <Button label='Close' icon='pi pi-times' onClick={handleHide} className='p-button-text' />
      {wizRunning ? (
        <Button
          label='Cancel run'
          icon='pi pi-stop-circle'
          onClick={handleWizCancel}
          className='p-button-secondary'
        />
      ) : (
        <Button
          label='Compute'
          icon='pi pi-play'
          onClick={handleWizCompute}
          className='p-button-secondary'
        />
      )}
      <Button
        label='Apply'
        icon='pi pi-check'
        onClick={handleWizApply}
        disabled={!wizSchedule || wizRunning || !wizSchedule.some((d) => d.conversionAmount > 0)}
      />
    </div>
  ) : (
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
      style={dialogWidth('34rem')}
      onHide={handleHide}
      closable={false}
      closeOnEscape={true}
      footer={dialogFooter}
    >
      {wizardAvailable && (
        <ModeTabBar>
          <ModeTab type='button' $active={mode === 'single'} onClick={() => setMode('single')}>
            Single conversion
          </ModeTab>
          <ModeTab type='button' $active={mode === 'wizard'} onClick={() => setMode('wizard')}>
            Plan a multi-year schedule
          </ModeTab>
        </ModeTabBar>
      )}
      {mode === 'wizard' ? (
        <Form as='div'>
          <InputGroup>
            <label>Method</label>
            <Dropdown
              value={wizMethod}
              options={METHOD_OPTIONS}
              onChange={(e) => { setWizMethod(e.value); setWizSchedule(null); setWizMessage(null); }}
            />
            <HelpText>
              <strong>Fill to bracket</strong> sizes each year's conversion to fill a target federal bracket.
              {' '}<strong>Auto bracket</strong> grid-searches all four bracket targets and picks the best.
              {' '}<strong>Optimize</strong> runs coordinate descent on the per-year vector (~3–5 s).
            </HelpText>
          </InputGroup>
          {wizMethod === 'fill_to_bracket' && (
            <InputGroup>
              <label>Target bracket</label>
              <Dropdown
                value={wizBracket}
                options={BRACKET_OPTIONS}
                onChange={(e) => { setWizBracket(e.value); setWizSchedule(null); setWizMessage(null); }}
              />
            </InputGroup>
          )}
          {(wizMethod === 'auto_bracket' || wizMethod === 'optimize') && (
            <InputGroup>
              <label>Objective</label>
              <Dropdown
                value={wizObjective}
                options={OBJECTIVE_OPTIONS}
                onChange={(e) => { setWizObjective(e.value); setWizSchedule(null); setWizMessage(null); }}
              />
            </InputGroup>
          )}
          {wizMessage && <WizardMessage>{wizMessage}</WizardMessage>}
          {wizSchedule && wizSchedule.some((d) => d.conversionAmount > 0) && (
            <div style={{ maxHeight: '14rem', overflowY: 'auto' }}>
              <WizardTable>
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Age</th>
                    <th style={{ textAlign: 'right' }}>Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {wizSchedule
                    .filter((d) => d.conversionAmount > 0)
                    .map((d) => (
                      <tr key={d.year}>
                        <td>{d.year}</td>
                        <td>{userData.currentAge + (d.year - userData.referenceYear)}</td>
                        <td className='num'>{currency(d.conversionAmount)}</td>
                      </tr>
                    ))}
                </tbody>
              </WizardTable>
            </div>
          )}
          <OpenLoopCaveat>
            This schedule is built against expected market conditions and the
            deterministic baseline projection. Actual results will differ as
            markets play out — the Monte Carlo runs reflect the range. Editing
            any generated event (or saving it without changes) detaches it
            from the schedule, so it survives future re-runs.
          </OpenLoopCaveat>
        </Form>
      ) : (
      <Form onSubmit={handleSubmit}>
        {isEditing && editEvent?.meta?.generatedBy && editEvent.meta.generatedBy !== 'user' && (
          <HelpText style={{ color: colors.warning, lineHeight: 1.4 }}>
            <i className='pi pi-info-circle' style={{ marginRight: spacing.xs }} />
            This event was generated by{' '}
            <strong>
              {editEvent.meta.generatedBy === 'fill_to_bracket' ? 'Fill to bracket'
                : editEvent.meta.generatedBy === 'auto_bracket' ? 'Auto bracket'
                  : 'Optimize'}
            </strong>
            . Saving any change — or saving with no change at all — detaches it from
            the schedule, so it survives the next re-run.
          </HelpText>
        )}
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
      )}
    </Dialog>
  );
};

export default RothConversionDialog;
