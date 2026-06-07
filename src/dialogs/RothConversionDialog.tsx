import React, { useState, useEffect, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import type { IncomeEvent } from '../types/IncomeEvent';
import type { UserData } from '../types/UserData';
import type { StrategyObjective, PerYearStrategyDecision } from '../services/strategies/types';
import { DEFAULT_END_AGE_CAP } from '../services/strategies/types';
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
import { simulationClient, SupersededError } from '../services/SimulationClient';
import { runDeterministicProjection } from '../services/SimulationService';
import { buildStrategyConversionEvents, isGeneratorProducedConversion } from '../services/strategies/syntheticEvents';
import PlanComparisonChart from './PlanComparisonChart';
import { useUIState } from '../context/UIStateContext';

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

const SuccessLine = styled.div<{ $positive: boolean }>`
  padding: ${spacing.xs} ${spacing.sm};
  border-radius: ${border.radius};
  font-size: ${fontSize.xs};
  font-weight: 600;
  line-height: 1.4;
  background: ${colors.bgLight};
  color: ${({ $positive }) => ($positive ? colors.income : colors.textSecondary)};
`;

// Footer container for the wizard mode — has 3–4 buttons that don't fit in one
// row at narrow dialog widths (the dialog clamps to 95vw on phones). Default
// PrimeReact `.p-dialog-footer` is inline-flex without wrap, so a 4th button
// overlaps the 3rd. Force flex-wrap + a gap so buttons stack cleanly without
// overlap, and justify to the right to match the standard footer convention.
const WizardFooter = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.xs};
  justify-content: flex-end;
  align-items: center;
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

type Mode = 'single' | 'wizard';

const OBJECTIVE_OPTIONS: { label: string; value: StrategyObjective }[] = [
  { label: 'Max terminal wealth (real $)', value: 'max_median_terminal_wealth' },
  { label: 'Min lifetime tax (real $)', value: 'min_lifetime_tax' },
];

// Plan-window options: end-age cap for the conversion schedule. Default 80
// reflects practitioner consensus — past ~80 the math shifts from
// owner-lifetime tax arbitrage to estate planning, which is a different
// objective the wizard doesn't model.
// Base END_AGE_OPTIONS — the fixed-age choices. The 'through life expectancy
// (advanced)' option is appended at render time because its value depends on
// userData.lifeExpectancy. Surfacing it as the last option keeps the default-
// case UX clean while giving heir-rate-arbitrage users an explicit escape
// hatch (vs. having to pick 90 as a workaround).
const BASE_END_AGE_OPTIONS: { label: string; value: number }[] = [
  { label: 'through age 73 (RMD start)', value: 73 },
  { label: 'through age 75', value: 75 },
  { label: 'through age 80 (default)', value: DEFAULT_END_AGE_CAP },
  { label: 'through age 85', value: 85 },
  { label: 'through age 90', value: 90 },
];

export const buildPlanWindowOptions = (lifeExpectancy: number): { label: string; value: number }[] => {
  // Keep fixed-age options up to AND INCLUDING lifeExpectancy (no point
  // offering "through age 90" when the plan ends at 85). Append a separate
  // "through life expectancy" option ONLY when lifeExpectancy doesn't
  // already equal one of the fixed values — otherwise we'd duplicate the
  // value (e.g. for lifeExpectancy=80, "through age 80 (default)" and
  // "through life expectancy (age 80, advanced)" would both have value=80,
  // and the dropdown would show whichever label rendered last as the
  // selected state, confusingly relabeling the default as "advanced").
  const fixed = BASE_END_AGE_OPTIONS.filter((o) => o.value <= lifeExpectancy);
  const alreadyCovered = BASE_END_AGE_OPTIONS.some((o) => o.value === lifeExpectancy);
  return alreadyCovered
    ? fixed
    : [...fixed, { label: `through life expectancy (age ${lifeExpectancy}, advanced)`, value: lifeExpectancy }];
};

/** Initial / reset value for `wizEndAgeCap`. Clamps the default (80) to the
 *  scenario's `lifeExpectancy` so users with a short plan don't end up with
 *  a state value that doesn't match any option in the dropdown. */
export const defaultPlanWindow = (lifeExpectancy: number): number =>
  Math.min(DEFAULT_END_AGE_CAP, lifeExpectancy);

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
  // Mirror the main chart's view selector so the inline what-if chart shows
  // matching units (Today's $ when the main chart is on 'real', Future $ when
  // it's on 'nominal').
  const { displayCurrency } = useUIState();
  const [formData, setFormData] = useState(makeDefaultFormData());
  // Wizard mode is hidden when editing (it adds new events) and when no
  // onApplyBatch callback was supplied (caller opted out).
  const wizardAvailable = !isEditing && !!onApplyBatch;
  // Wizard mode is the default for first-time visits (the multi-year schedule
  // is the conceptually correct answer for most users); we fall back to
  // 'single' only when the wizard is unavailable.
  const [mode, setMode] = useState<Mode>(wizardAvailable ? 'wizard' : 'single');
  const [wizEndAgeCap, setWizEndAgeCap] = useState<number>(defaultPlanWindow(userData.lifeExpectancy));
  const [wizRespectCliffs, setWizRespectCliffs] = useState<boolean>(userData.respectIrmaaNiitCliffs !== false);
  const [wizObjective, setWizObjective] = useState<StrategyObjective>('max_median_terminal_wealth');
  const [wizShowAdvanced, setWizShowAdvanced] = useState<boolean>(false);
  const [wizSchedule, setWizSchedule] = useState<PerYearStrategyDecision[] | null>(null);
  const [wizRunning, setWizRunning] = useState(false);
  const [wizMessage, setWizMessage] = useState<string | null>(null);
  const [wizCurrentPath, setWizCurrentPath] = useState<number[] | null>(null);
  const [wizProposedPath, setWizProposedPath] = useState<number[] | null>(null);
  const [wizInflationFactors, setWizInflationFactors] = useState<number[] | null>(null);
  // Monte Carlo success probability of the generated schedule vs the no-schedule
  // baseline. The schedule table is deterministic-optimized; this line tells the
  // user how the schedule actually fares across the MC range before they Apply.
  const [wizSuccess, setWizSuccess] = useState<{ candidate: number; baseline: number } | null>(null);
  const [wizSuccessRunning, setWizSuccessRunning] = useState(false);
  // Monotonic token to discard stale/superseded MC results — the simulationClient
  // is a shared singleton, so a newer compute (or the main chart's run) can preempt.
  const wizSuccessToken = useRef(0);
  useEffect(() => {
    if (!visible) {
      setMode(wizardAvailable ? 'wizard' : 'single');
      setWizSchedule(null);
      setWizMessage(null);
      setWizSuccess(null);
      setWizSuccessRunning(false);
      setWizCurrentPath(null);
      setWizProposedPath(null);
      setWizInflationFactors(null);
      setWizShowAdvanced(false);
      wizSuccessToken.current++;
      // Reset wizard params too — a fresh open should always start at the
      // defaults (80 cap, cliffs on, terminal-wealth objective).
      setWizEndAgeCap(defaultPlanWindow(userData.lifeExpectancy));
      setWizRespectCliffs(userData.respectIrmaaNiitCliffs !== false);
      setWizObjective('max_median_terminal_wealth');
    }
  }, [visible, wizardAvailable, userData.respectIrmaaNiitCliffs, userData.lifeExpectancy]);

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

  // Build a UserData shape suitable for the compute backends. The cliff
  // toggle lives on the wizard (not on the scenario), so we override the
  // field locally for the compute call without persisting back.
  const wizardUserData: UserData = useMemo(
    () => ({ ...userData, respectIrmaaNiitCliffs: wizRespectCliffs }),
    [userData, wizRespectCliffs],
  );

  // Materialize a schedule's non-zero years into roth_conversion events (mirrors
  // handleWizApply's batch builder, minus the provenance meta the engine ignores).
  const scheduleToEvents = (schedule: PerYearStrategyDecision[]): IncomeEvent[] =>
    schedule
      .filter((d) => d.conversionAmount > 0)
      .map((d) => {
        const startAge = userData.currentAge + (d.year - userData.referenceYear);
        return {
          id: crypto.randomUUID(),
          type: 'roth_conversion',
          name: `Roth conversion ${d.year}`,
          amount: d.conversionAmount,
          startAge,
          endAge: startAge,
          isOneTime: true,
          taxStatus: 'before_tax',
          colaType: 'fixed',
        } as IncomeEvent;
      });

  // Run two MC sims — baseline (current plan minus any prior generated batch) and
  // candidate (baseline + this schedule) — and surface both success probabilities.
  // Fire-and-forget: the deterministic schedule table renders immediately; this
  // fills in when the workers return. Guarded by wizSuccessToken so a superseded
  // run (newer compute, or the chart's own run preempting the shared client) is
  // silently dropped rather than showing a stale number.
  //
  // Note: when the spending order is on Auto, the candidate run auto-flips to
  // bracket_aware (a conversion now exists) while the baseline stays
  // brokerage_first. So this delta deliberately BUNDLES the conversion effect
  // with the withdrawal-order switch — unlike the Net-impact decomposition,
  // which separates them. That's intentional here: this line answers "what's my
  // success if I click Apply?", and Apply does flip the order.
  const runScheduleSuccess = async (schedule: PerYearStrategyDecision[]) => {
    const token = ++wizSuccessToken.current;
    setWizSuccess(null);
    setWizSuccessRunning(true);
    try {
      // Baseline mirrors the Apply replace policy: strip generator-tagged
      // conversions, keep manual ones and all other events.
      const survivors = userData.incomeEvents.filter(
        (e) => e.type !== 'roth_conversion' || !e.meta?.generatedBy || e.meta.generatedBy === 'user',
      );
      const baselineData: UserData = { ...userData, incomeEvents: survivors };
      const candidateData: UserData = {
        ...userData,
        incomeEvents: [...survivors, ...scheduleToEvents(schedule)],
      };
      const baselineRes = await simulationClient.run(baselineData);
      const candidateRes = await simulationClient.run(candidateData);
      if (token !== wizSuccessToken.current) return; // superseded by a newer request
      setWizSuccess({ candidate: candidateRes.probability, baseline: baselineRes.probability });
    } catch (err) {
      // Shared client got preempted (or sim errored) — just leave the line hidden.
      if (!(err instanceof SupersededError)) {
        console.warn('[RothConversionDialog] schedule success MC failed:', err);
      }
    } finally {
      if (token === wizSuccessToken.current) setWizSuccessRunning(false);
    }
  };

  // Run the two deterministic projections that feed the inline what-if chart:
  // (a) the current plan with generator-tagged conversions stripped, (b) the
  // current plan with the new schedule appended. Mirrors `runScheduleSuccess`'s
  // event-survivor logic so the chart matches what Apply would produce.
  const updateComparisonChart = (schedule: PerYearStrategyDecision[]) => {
    const survivors = userData.incomeEvents.filter((e) => !isGeneratorProducedConversion(e));
    const baselineData: UserData = { ...userData, incomeEvents: survivors };
    const candidateData: UserData = {
      ...userData,
      incomeEvents: [...survivors, ...buildStrategyConversionEvents(userData, schedule)],
    };
    const baselineProj = runDeterministicProjection(baselineData);
    const candidateProj = runDeterministicProjection(candidateData);
    setWizCurrentPath(baselineProj.path);
    setWizProposedPath(candidateProj.path);
    // **Assumption check:** for deterministic projections both runs use the
    // same scenario inflation rate, so `inflation[i] = (1 + r)^i` is identical
    // across baselineProj and candidateProj. If this function ever switches
    // to stochastic MC results, both `inflation` arrays would diverge per-run
    // and we'd need to pass them separately to the chart (or re-think the
    // re-inflation contract). Single-array assumption is captured here so
    // a future refactor doesn't silently produce mismatched scales between
    // the two displayed lines.
    // Inflation factors are identical across the two runs (same scenario
    // inflation); just take the baseline's. Used by the inline chart to
    // re-inflate real paths when the main view is 'nominal' / Future $.
    setWizInflationFactors(baselineProj.inflation);
  };

  // Generate the schedule via coordinate-descent optimization (seeded internally
  // from an Auto-bracket grid search). ~3–5 s — the wizard's only compute path.
  // Honors the plan-window cap and cliff-awareness toggle. Cancelled by Close,
  // parameter changes, or an in-flight cancellation request.
  const handleWizGenerate = async () => {
    setWizRunning(true);
    setWizMessage('Optimizing… this takes a few seconds.');
    setWizSchedule(null);
    setWizCurrentPath(null);
    setWizProposedPath(null);
    setWizInflationFactors(null);
    wizSuccessToken.current++;
    setWizSuccess(null);
    setWizSuccessRunning(false);
    const t0 = performance.now();
    try {
      const result = await strategyComputeClient.optimize(wizardUserData, {
        name: 'optimize', objective: wizObjective, endAgeCap: wizEndAgeCap,
      });
      const elapsed = (performance.now() - t0) / 1000;
      setWizSchedule(result.perYearDecisions);
      const delta = result.finalScore - result.baselineScore;
      const nonZero = result.perYearDecisions.filter((d) => d.conversionAmount > 0).length;
      if (delta > 0) {
        setWizMessage(
          `Generated in ${elapsed.toFixed(1)}s. Projected gain vs your current plan: ` +
          `+${currency(delta)} (real dollars at end of plan), from ${nonZero} conversion year${nonZero === 1 ? '' : 's'}.`
        );
      } else {
        setWizMessage(
          `Generated in ${elapsed.toFixed(1)}s. The optimizer couldn't improve on your current plan — ` +
          `Apply would add a zero-conversion schedule.`
        );
      }
      if (result.perYearDecisions.some((d) => d.conversionAmount > 0)) {
        updateComparisonChart(result.perYearDecisions);
        void runScheduleSuccess(result.perYearDecisions);
      }
    } catch (err) {
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
    wizSuccessToken.current++;
    setWizSuccess(null);
    setWizSuccessRunning(false);
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
    const generatorName: NonNullable<IncomeEvent['meta']>['generatedBy'] = 'optimize';
    const generatedAt = new Date().toISOString().slice(0, 10);
    const generatorRunId = crypto.randomUUID();
    const batch: Omit<IncomeEvent, 'id'>[] = nonZero.map((d) => {
      const startAge = userData.currentAge + (d.year - userData.referenceYear);
      return {
        type: 'roth_conversion',
        name: `Roth conversion ${d.year}`,
        // Explicit self-ownership. The wizard doesn't currently produce
        // per-owner schedules — the optimizer treats the household as a
        // single Trad bucket and the endAgeCap is checked against self's age
        // (see FillToBracketStrategy / OptimizeStrategy). Surfacing the
        // default explicitly: (a) makes the intent visible in the saved
        // event, (b) decouples behavior from any future change to the
        // engine's owner-default, (c) is the right anchor when we eventually
        // thread per-owner schedules through PerYearStrategyDecision.
        owner: 'self',
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
    <WizardFooter>
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
          label={wizSchedule ? 'Re-generate' : 'Generate plan'}
          icon='pi pi-play'
          onClick={handleWizGenerate}
          className='p-button-secondary'
        />
      )}
      <Button
        label='Apply'
        icon='pi pi-check'
        onClick={handleWizApply}
        disabled={!wizSchedule || wizRunning || !wizSchedule.some((d) => d.conversionAmount > 0)}
      />
    </WizardFooter>
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
          <HelpText style={{ lineHeight: 1.4 }}>
            Roth conversions make sense when your <em>current</em> marginal tax rate
            is lower than your <em>future</em> rate — typically the gap years between
            retirement and your first RMD. The generator sizes a per-year schedule
            inside that window. Click <strong>Generate plan</strong> to see what it
            recommends, compare it to your current plan, then <strong>Apply</strong>.
          </HelpText>
          <FieldRow>
            <InputGroup>
              <label>Plan window</label>
              <Dropdown
                value={wizEndAgeCap}
                options={buildPlanWindowOptions(userData.lifeExpectancy)}
                onChange={(e) => { setWizEndAgeCap(e.value); setWizSchedule(null); setWizMessage(null); setWizSuccess(null); setWizCurrentPath(null); setWizProposedPath(null); setWizInflationFactors(null); wizSuccessToken.current++; }}
              />
            </InputGroup>
            <InputGroup>
              <label>&nbsp;</label>
              <CheckboxGroup>
                <Checkbox
                  inputId='wizCliffs'
                  checked={wizRespectCliffs}
                  onChange={(e) => { setWizRespectCliffs(e.checked || false); setWizSchedule(null); setWizMessage(null); setWizSuccess(null); setWizCurrentPath(null); setWizProposedPath(null); setWizInflationFactors(null); wizSuccessToken.current++; }}
                />
                <label htmlFor='wizCliffs' style={{ fontSize: fontSize.sm, cursor: 'pointer' }}>
                  Cap under IRMAA / NIIT cliffs
                </label>
              </CheckboxGroup>
            </InputGroup>
          </FieldRow>
          <div>
            <button
              type='button'
              onClick={() => setWizShowAdvanced((v) => !v)}
              style={{
                background: 'none', border: 'none', padding: 0,
                color: colors.textSecondary, fontSize: fontSize.xs, cursor: 'pointer',
              }}
            >
              <i className={`pi ${wizShowAdvanced ? 'pi-chevron-down' : 'pi-chevron-right'}`} style={{ marginRight: spacing.xs, fontSize: fontSize.xs }} />
              Advanced
            </button>
            {wizShowAdvanced && (
              <InputGroup style={{ marginTop: spacing.xs }}>
                <label>Objective</label>
                <Dropdown
                  value={wizObjective}
                  options={OBJECTIVE_OPTIONS}
                  onChange={(e) => { setWizObjective(e.value); setWizSchedule(null); setWizMessage(null); setWizSuccess(null); setWizCurrentPath(null); setWizProposedPath(null); setWizInflationFactors(null); wizSuccessToken.current++; }}
                />
                <HelpText>
                  Default maximizes the deterministic terminal portfolio in real
                  (today's) dollars. Min lifetime tax minimizes the real-dollar
                  sum of federal + state tax across the plan. Differences are
                  usually small.
                </HelpText>
              </InputGroup>
            )}
          </div>
          {wizMessage && <WizardMessage>{wizMessage}</WizardMessage>}
          {wizSchedule && wizSchedule.some((d) => d.conversionAmount > 0) && (wizSuccessRunning || wizSuccess) && (
            <SuccessLine $positive={!!wizSuccess && wizSuccess.candidate >= wizSuccess.baseline}>
              {wizSuccess
                ? `Projected success with this schedule: ${wizSuccess.candidate}% ` +
                  `(vs ${wizSuccess.baseline}% baseline)`
                : 'Estimating Monte Carlo success probability…'}
            </SuccessLine>
          )}
          {wizCurrentPath && wizProposedPath && wizInflationFactors && (
            <div>
              <PlanComparisonChart
                currentPath={wizCurrentPath}
                proposedPath={wizProposedPath}
                inflationFactors={wizInflationFactors}
                currentAge={userData.currentAge}
                displayCurrency={displayCurrency}
              />
              <HelpText style={{ display: 'block', textAlign: 'center', marginTop: spacing.xs }}>
                Deterministic projection in {displayCurrency === 'nominal' ? 'future' : "today's"} dollars
                (matches the main chart's view). Live MC band on the main chart shows the full range.
              </HelpText>
            </div>
          )}
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
        {!wizardAvailable && !isEditing && (
          <HelpText style={{ lineHeight: 1.4 }}>
            <i className='pi pi-info-circle' style={{ marginRight: spacing.xs }} />
            Planning several years of conversions? Use{' '}
            <strong>Tools → Roth Conversions</strong> for a multi-year schedule.
          </HelpText>
        )}
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
            min={0}
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
                <DisclaimerLabel>Net impact reflects the engine's full behavior:</DisclaimerLabel>{' '}
                including the per-scenario auto-selected spending policy (the
                engine picks whichever of brokerage-first or bracket-aware
                gives the higher real terminal balance, for both the with-
                and without-conversion projections). So this is the honest
                marginal effect of this conversion on top of the engine
                already doing its best.
              </div>
              <div>
                <DisclaimerLabel>What's still not included:</DisclaimerLabel>{' '}
                ACA premium tax credit effects before 65, the surviving-spouse
                shift from joint to single brackets, and federal 0/15/20% LTCG
                bracket stacking. Each can materially change whether a conversion
                is worthwhile.
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
