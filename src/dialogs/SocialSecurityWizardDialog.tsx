import React, { useState, useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import { confirmDialog } from 'primereact/confirmdialog';
import type { Scenario } from '../types/Scenario';
import type { IncomeEvent } from '../types/IncomeEvent';
import { DEFAULT_SS_HAIRCUT_YEAR, DEFAULT_SS_HAIRCUT_PERCENT } from '../types/IncomeEvent';
import { spacing, colors, border, fontSize, dialogWidth } from '../styles/theme';
import { eventTypeIcons } from '../utils/defaultName';
import { resolveOwnerAge } from '../utils/ownerAge';
import {
  computeFraMonths,
  piaFromBenefit,
  benefitAtAge,
  formatFra,
  MIN_CLAIM_AGE,
  MAX_CLAIM_AGE,
} from '../services/socialSecurity';
import {
  optimizeClaimingAge,
  buildClaimingEvent,
  findCrossoverAge,
} from '../services/socialSecurityOptimizer';
import PlanComparisonChart from './PlanComparisonChart';
import {
  FormFullWidth as Form,
  InputGroupPlain as InputGroup,
} from './SettingsDialogPrimitives';

const BenefitRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm};

  /* Override the Form's global width:100% so the controls share one line. */
  .p-inputnumber { flex: 1 1 9rem; width: auto; }
  .p-dropdown { width: auto; }
`;

const AtConnector = styled.span`
  font-size: ${fontSize.sm};
  color: ${colors.textMuted};
`;

const Label = styled.label`
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
`;

const CheckboxRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  font-size: ${fontSize.sm};
`;

const HaircutRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.md};
  flex-wrap: wrap;

  .p-inputnumber {
    width: 7rem;
  }
`;

const LabeledField = styled.label`
  display: flex;
  align-items: center;
  gap: ${spacing.xs};
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
`;

const HelpText = styled.small`
  color: ${colors.textMuted};
  font-size: ${fontSize.xs};
  line-height: 1.4;
`;

const WarnNote = styled.div`
  color: ${colors.warning};
  background: ${colors.warningBg};
  border-radius: ${border.radius};
  padding: ${spacing.xs} ${spacing.sm};
  font-size: ${fontSize.xs};
  line-height: 1.4;
`;

const LockNote = styled.div`
  color: ${colors.textSecondary};
  background: ${colors.bgMedium};
  border: ${border.light};
  border-radius: ${border.radius};
  padding: ${spacing.sm} ${spacing.md};
  font-size: ${fontSize.sm};
  line-height: 1.5;
`;

const Hero = styled.div`
  background: ${colors.successBg};
  border: 1px solid ${colors.success};
  border-radius: ${border.radius};
  padding: ${spacing.sm} ${spacing.md};
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

const HeroHeadline = styled.div`
  font-size: ${fontSize.md};
  font-weight: 600;
  color: ${colors.textPrimary};
`;

const HeroDelta = styled.span`
  color: ${colors.success};
  font-weight: 700;
`;

const HeroCaveat = styled.div`
  font-size: ${fontSize.xs};
  color: ${colors.textSecondary};
`;

const BreakevenLine = styled.div`
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${fontSize.xs};

  th, td {
    padding: ${spacing.xs} ${spacing.sm};
    text-align: right;
    border-bottom: ${border.light};
  }
  th:first-child, td:first-child {
    text-align: left;
  }
  th {
    color: ${colors.textSecondary};
    font-weight: 600;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: ${colors.bgHover};
  }
`;

interface Props {
  visible: boolean;
  onHide: () => void;
  scenario: Scenario;
  onSave: (updated: Scenario) => void;
}

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtSigned = (n: number) => `${n >= 0 ? '+' : '-'}${fmtUSD(Math.abs(n))}`;

type AtAge = 'fra' | number;

const SocialSecurityWizardDialog: React.FC<Props> = ({ visible, onHide, scenario, onSave }) => {
  // The wizard is a today's-dollars (real, year-0) tool throughout — it matches the
  // optimizer's real-terminal scoring and the SSA today's-dollar benefit input. We do NOT
  // follow the app-wide Today's $/Future $ toggle here (that would mix units against the
  // fixed-today's hero + table). The comparison chart is pinned to 'real' below.
  const isMfj = scenario.filingStatus === 'mfj';
  const hasSpouse = isMfj && scenario.spouseAge !== null;

  const [owner, setOwner] = useState<'self' | 'spouse'>('self');
  const [displayBenefit, setDisplayBenefit] = useState(0);
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [atAge, setAtAge] = useState<AtAge>('fra');
  const [debouncedAnnual, setDebouncedAnnual] = useState(0);
  const [haircutEnabled, setHaircutEnabled] = useState(true);
  const [haircutPercent, setHaircutPercent] = useState(DEFAULT_SS_HAIRCUT_PERCENT);
  const [debouncedHaircutPercent, setDebouncedHaircutPercent] = useState(DEFAULT_SS_HAIRCUT_PERCENT);
  const [haircutYear, setHaircutYear] = useState(DEFAULT_SS_HAIRCUT_YEAR);
  const [debouncedHaircutYear, setDebouncedHaircutYear] = useState(DEFAULT_SS_HAIRCUT_YEAR);
  const [applyAge, setApplyAge] = useState<number | null>(null);

  const templateFor = (o: 'self' | 'spouse'): IncomeEvent | undefined =>
    scenario.incomeEvents.find((e) => e.type === 'social_security' && (e.owner ?? 'self') === o);

  const eligibilityFor = (o: 'self' | 'spouse') => {
    const age = resolveOwnerAge(o, scenario.currentAge, scenario.spouseAge);
    const tmpl = templateFor(o);
    const alreadyClaiming = !!tmpl && tmpl.startAge <= age;
    const ageMin = Math.max(MIN_CLAIM_AGE, Math.ceil(age));
    const ageMax = MAX_CLAIM_AGE;
    let locked = false;
    let reason = '';
    if (alreadyClaiming) {
      locked = true;
      reason = `Already claiming at age ${tmpl!.startAge} — the claiming age can't be changed.`;
    } else if (ageMin > ageMax) {
      locked = true;
      reason = `Past age ${MAX_CLAIM_AGE} — there's nothing left to optimize (benefits don't grow after 70).`;
    }
    return { age, tmpl, ageMin, ageMax, locked, reason };
  };

  // Pick the default owner (first eligible) when the dialog opens.
  useEffect(() => {
    if (!visible) return;
    const selfElig = eligibilityFor('self');
    const spouseElig = hasSpouse ? eligibilityFor('spouse') : null;
    setOwner(!selfElig.locked || !spouseElig ? 'self' : !spouseElig.locked ? 'spouse' : 'self');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Pre-fill benefit + at-age from the selected owner's existing SS event.
  useEffect(() => {
    if (!visible) return;
    const tmpl = templateFor(owner);
    if (tmpl) {
      const p = tmpl.amountPeriod ?? 'annual';
      setPeriod(p);
      // The wizard works in today's dollars. A saved 'future'-basis amount is a
      // nominal-at-claim figure, so deflate it back to today's dollars before
      // reconstructing PIA — otherwise we'd overstate the benefit at every age.
      let todayAnnual = tmpl.amount;
      if (tmpl.ssAmountBasis === 'future') {
        const ownerAge = resolveOwnerAge(owner, scenario.currentAge, scenario.spouseAge);
        const startYear = scenario.referenceYear + (tmpl.startAge - ownerAge);
        const yearsAhead = Math.max(0, startYear - scenario.referenceYear);
        todayAnnual = tmpl.amount / Math.pow(1 + scenario.inflationRate, yearsAhead);
      }
      setDisplayBenefit(p === 'monthly' ? Math.round(todayAnnual / 12) : Math.round(todayAnnual));
      setAtAge(tmpl.startAge >= MIN_CLAIM_AGE && tmpl.startAge <= MAX_CLAIM_AGE ? tmpl.startAge : 'fra');
      setHaircutEnabled(tmpl.ssHaircutEnabled ?? true);
      setHaircutPercent(tmpl.ssHaircutPercent ?? DEFAULT_SS_HAIRCUT_PERCENT);
      setHaircutYear(tmpl.ssHaircutYear ?? DEFAULT_SS_HAIRCUT_YEAR);
    } else {
      setPeriod('monthly');
      setDisplayBenefit(0);
      setAtAge('fra');
      setHaircutEnabled(true);
      setHaircutPercent(DEFAULT_SS_HAIRCUT_PERCENT);
      setHaircutYear(DEFAULT_SS_HAIRCUT_YEAR);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, owner]);

  const annualImmediate = period === 'monthly' ? displayBenefit * 12 : displayBenefit;

  // Debounce the numeric inputs so the sweep doesn't recompute on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedAnnual(annualImmediate), 250);
    return () => clearTimeout(t);
  }, [annualImmediate]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedHaircutPercent(haircutPercent), 250);
    return () => clearTimeout(t);
  }, [haircutPercent]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedHaircutYear(haircutYear), 250);
    return () => clearTimeout(t);
  }, [haircutYear]);

  const elig = eligibilityFor(owner);
  const fraMonths = computeFraMonths(scenario.referenceYear - elig.age);
  const enteredAgeMonths = atAge === 'fra' ? fraMonths : atAge * 12;
  const pia = debouncedAnnual > 0 ? piaFromBenefit(debouncedAnnual, fraMonths, enteredAgeMonths) : 0;

  const sweep = useMemo(() => {
    if (elig.locked || pia <= 0) return null;
    return optimizeClaimingAge(scenario, {
      owner,
      pia,
      fraMonths,
      ageMin: elig.ageMin,
      ageMax: elig.ageMax,
      template: elig.tmpl,
      haircutEnabled,
      haircutPercent: debouncedHaircutPercent,
      haircutYear: debouncedHaircutYear,
    });
  }, [scenario, owner, pia, fraMonths, elig.locked, elig.ageMin, elig.ageMax, elig.tmpl, haircutEnabled, debouncedHaircutPercent, debouncedHaircutYear]);

  // Default the apply-age to the recommended best whenever the sweep changes.
  useEffect(() => {
    if (sweep?.bestAge != null) setApplyAge(sweep.bestAge);
  }, [sweep]);

  const monthlyBenefit = annualImmediate / 12;
  const sanityNote =
    annualImmediate > 0 && monthlyBenefit < 400
      ? 'This looks unusually low for a full-career benefit — double-check your SSA statement.'
      : annualImmediate > 0 && monthlyBenefit > 6000
        ? 'This looks unusually high — double-check whether the figure is monthly vs. annual.'
        : null;

  const atAgeOptions: { label: string; value: AtAge }[] = [
    { label: 'Full retirement age', value: 'fra' },
    ...Array.from({ length: MAX_CLAIM_AGE - MIN_CLAIM_AGE + 1 }, (_, i) => {
      const a = MIN_CLAIM_AGE + i;
      return { label: `Age ${a}`, value: a as AtAge };
    }),
  ];

  // --- Recommendation framing ---
  const framing = useMemo(() => {
    if (!sweep || sweep.bestAge == null || sweep.results.length === 0) return null;
    const best = sweep.results.find((r) => r.age === sweep.bestAge)!;
    // Reference = the swept candidate at the current claim age (when it's in range),
    // else the earliest swept age. Using a candidate (not a separate baseline run)
    // keeps the per-age deltas consistent: the reference row reads exactly $0.
    const inRange =
      sweep.currentClaimAge != null &&
      sweep.results.some((r) => r.age === sweep.currentClaimAge);
    const hasCurrent = inRange;
    const compareAge = inRange ? sweep.currentClaimAge! : sweep.results[0].age;
    const reference = sweep.results.find((r) => r.age === compareAge) ?? sweep.results[0];
    const compareTerminal = reference.terminalReal;
    const comparePath = reference.path;
    const delta = best.terminalReal - compareTerminal;
    return {
      best,
      compareAge,
      hasCurrent,
      compareTerminal,
      comparePath,
      delta,
      isAlreadyOptimal: Math.abs(delta) < 1 || best.age === compareAge,
    };
  }, [sweep]);

  const handleApply = () => {
    if (!sweep || applyAge == null) return;
    const annualBenefit = benefitAtAge(pia, fraMonths, applyAge);
    const meta = {
      generatedBy: 'ss_optimizer' as const,
      generatedAt: new Date().toISOString().slice(0, 10),
      generatorRunId: crypto.randomUUID(),
    };
    const newEvent: IncomeEvent = {
      ...buildClaimingEvent(elig.tmpl, owner, applyAge, annualBenefit, {
        haircutEnabled,
        haircutPercent,
        haircutYear,
        meta,
      }),
      id: elig.tmpl?.id ?? crypto.randomUUID(),
    };
    const survivors = scenario.incomeEvents.filter(
      (e) => !(e.type === 'social_security' && (e.owner ?? 'self') === owner),
    );
    const updated: Scenario = { ...scenario, incomeEvents: [...survivors, newEvent] };

    const isManual = elig.tmpl && (elig.tmpl.meta?.generatedBy === undefined || elig.tmpl.meta?.generatedBy === 'user');
    if (isManual) {
      confirmDialog({
        message: `Replace your Social Security entry for ${owner === 'spouse' ? 'spouse' : 'self'} with claiming at age ${applyAge} (${fmtUSD(annualBenefit)}/yr in today's dollars)?`,
        header: 'Update Social Security',
        icon: 'pi pi-exclamation-triangle',
        accept: () => {
          onSave(updated);
          onHide();
        },
      });
    } else {
      onSave(updated);
      onHide();
    }
  };

  const otherOwner: 'self' | 'spouse' = owner === 'self' ? 'spouse' : 'self';
  const otherEligible = hasSpouse && !eligibilityFor(otherOwner).locked;

  const footer = (
    <div>
      <Button label="Cancel" icon="pi pi-times" onClick={onHide} className="p-button-text" />
      <Button
        label={applyAge != null ? `Apply age ${applyAge}` : 'Apply'}
        icon="pi pi-check"
        onClick={handleApply}
        disabled={!sweep || applyAge == null}
      />
    </div>
  );

  return (
    <Dialog
      header={
        <span>
          <i className={eventTypeIcons['social_security']} style={{ marginRight: spacing.sm, color: colors.primary }} />
          Social Security — best time to claim
        </span>
      }
      visible={visible}
      style={dialogWidth('38rem')}
      onHide={onHide}
      closable={false}
      closeOnEscape
      footer={footer}
    >
      {/* as="div": this wizard isn't a submitting form — keep the original
          <div> element while sharing FormFullWidth's styling. */}
      <Form as="div">
        {hasSpouse && (
          <InputGroup>
            <Label>Optimizing for</Label>
            <Dropdown
              value={owner}
              options={[
                { label: 'Self', value: 'self' },
                { label: 'Spouse', value: 'spouse' },
              ]}
              onChange={(e) => setOwner(e.value)}
            />
            <HelpText>
              The other person's Social Security is held fixed; second-order tax interaction
              between the two is not optimized in this version.
            </HelpText>
          </InputGroup>
        )}

        <InputGroup>
          <Label>Your estimated benefit</Label>
          <BenefitRow>
            <InputNumber
              value={displayBenefit}
              onValueChange={(e) => setDisplayBenefit(e.value || 0)}
              mode="currency"
              currency="USD"
              min={0}
            />
            <Dropdown
              value={period}
              options={[
                { label: 'Monthly', value: 'monthly' },
                { label: 'Annual', value: 'annual' },
              ]}
              onChange={(e) => setPeriod(e.value)}
              style={{ flex: '0 0 7rem' }}
            />
            <AtConnector>at</AtConnector>
            <Dropdown
              value={atAge}
              options={atAgeOptions}
              onChange={(e) => setAtAge(e.value)}
              style={{ flex: '1 1 10rem' }}
            />
          </BenefitRow>
          <HelpText>
            From your Social Security statement (ssa.gov/myaccount): enter your estimated benefit
            at full retirement age ({formatFra(fraMonths)}) in today's dollars. If your statement
            shows the figure at another age (e.g. 62 or 70), pick that age instead.
          </HelpText>
          {elig.tmpl?.ssAmountBasis === 'future' && (
            <HelpText>
              Your saved entry was in future (inflated) dollars — converted to today's dollars here.
            </HelpText>
          )}
        </InputGroup>

        <InputGroup>
          <HaircutRow>
            <CheckboxRow>
              <Checkbox
                inputId="ssHaircut"
                checked={haircutEnabled}
                onChange={(e) => setHaircutEnabled(e.checked ?? false)}
              />
              <label htmlFor="ssHaircut">Apply trust-fund reduction</label>
            </CheckboxRow>
            {haircutEnabled && (
              <>
                <LabeledField>
                  Starting
                  <InputNumber
                    value={haircutYear}
                    onValueChange={(e) => setHaircutYear(e.value ?? DEFAULT_SS_HAIRCUT_YEAR)}
                    useGrouping={false}
                    min={2025}
                    max={2100}
                  />
                </LabeledField>
                <LabeledField>
                  Cut
                  <InputNumber
                    value={haircutPercent}
                    onValueChange={(e) => setHaircutPercent(e.value ?? DEFAULT_SS_HAIRCUT_PERCENT)}
                    suffix="%"
                    min={0}
                    max={100}
                  />
                </LabeledField>
              </>
            )}
          </HaircutRow>
          <HelpText>
            Latest trustees estimate (2026 report): a ~{DEFAULT_SS_HAIRCUT_PERCENT}% benefit cut
            around {DEFAULT_SS_HAIRCUT_YEAR} if the trust fund isn't shored up. Edit the year/percent
            to model your own assumption, or toggle to compare claiming ages with and without it.
          </HelpText>
        </InputGroup>

        {sanityNote && <WarnNote>{sanityNote}</WarnNote>}

        {elig.locked ? (
          <LockNote>
            {elig.reason}
            {otherEligible && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => setOwner(otherOwner)}
                  style={{ background: 'none', border: 'none', color: colors.primary, cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
                >
                  Optimize {otherOwner === 'spouse' ? 'spouse' : 'self'} instead
                </button>
              </>
            )}
          </LockNote>
        ) : !sweep || !framing ? (
          <HelpText>Enter your estimated benefit above to see the best time to claim.</HelpText>
        ) : (
          <>
            <Hero>
              <HeroHeadline>
                {framing.isAlreadyOptimal ? (
                  <>Claiming at {framing.best.age} is already about optimal for your plan.</>
                ) : (
                  <>
                    Claim at {framing.best.age} →{' '}
                    <HeroDelta>{fmtSigned(framing.delta)} plan value (today's $)</HeroDelta>{' '}
                    vs {framing.hasCurrent ? `your current ${framing.compareAge}` : `claiming at ${framing.compareAge}`}.
                  </>
                )}
              </HeroHeadline>
              <HeroCaveat>
                Assumes living to your plan's life expectancy of {scenario.lifeExpectancy}. Claiming
                later trades fewer years of benefits for larger checks — your longevity drives which wins.
              </HeroCaveat>
            </Hero>

            {(() => {
              // The chart + breakeven follow the *selected* row (applyAge); the
              // hero above stays on the recommendation (best).
              const selected = sweep.results.find((r) => r.age === applyAge) ?? framing.best;
              const selectedBreakeven =
                selected.age > framing.compareAge
                  ? findCrossoverAge(selected.path, framing.comparePath, scenario.currentAge)
                  : null;
              return (
              <>
                <PlanComparisonChart
                  currentPath={framing.comparePath}
                  proposedPath={selected.path}
                  inflationFactors={sweep.inflationFactors}
                  currentAge={scenario.currentAge}
                  displayCurrency="real"
                  currentLabel={framing.hasCurrent ? `Current (claim at ${framing.compareAge})` : `Claim at ${framing.compareAge}`}
                  proposedLabel={`Claim at ${selected.age}`}
                  referencePath={sweep.enteredPlanPath}
                  referenceLabel="Your saved plan"
                />
                <HelpText style={{ display: 'block', textAlign: 'center' }}>
                  All figures in today's (year-0) dollars.
                </HelpText>

                {selectedBreakeven != null && (
                  <BreakevenLine>
                    Breakeven of claiming at {selected.age} vs {framing.compareAge}: age{' '}
                    {selectedBreakeven} — delaying pulls ahead from then on.
                  </BreakevenLine>
                )}

                <Table>
                  <thead>
                    <tr>
                      <th>Claim age</th>
                      <th>Annual benefit</th>
                      <th>Plan final value</th>
                      <th>Δ vs {framing.compareAge}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sweep.results.map((r) => {
                      const isBest = r.age === sweep.bestAge;
                      const isApply = r.age === applyAge;
                      const rowDelta = r.terminalReal - framing.compareTerminal;
                      return (
                        <tr
                          key={r.age}
                          onClick={() => setApplyAge(r.age)}
                          style={{
                            background: isApply ? colors.activeRow : undefined,
                            fontWeight: isBest ? 600 : undefined,
                          }}
                        >
                          <td>
                            {isApply ? '▸ ' : ''}
                            {r.age}
                            {isBest ? ' ★' : ''}
                            {r.age === sweep.currentClaimAge ? ' (current)' : ''}
                          </td>
                          <td>{fmtUSD(r.annualBenefit)}</td>
                          <td>{fmtUSD(r.terminalReal)}</td>
                          <td style={{ color: rowDelta >= 0 ? colors.success : colors.danger }}>
                            {rowDelta === 0 ? '—' : fmtSigned(rowDelta)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                <HelpText>
                  Click a row to choose which claiming age to apply. ★ = recommended.
                </HelpText>
                {haircutEnabled &&
                  scenario.referenceYear + (scenario.lifeExpectancy - scenario.currentAge) >= haircutYear && (
                    <HelpText>
                      Annual benefit is the gross check; with the trust-fund reduction on,
                      benefits from {haircutYear} onward are ~{haircutPercent}% lower — Plan final value
                      already reflects this.
                    </HelpText>
                  )}
              </>
              );
            })()}
          </>
        )}
      </Form>
    </Dialog>
  );
};

export default SocialSecurityWizardDialog;
