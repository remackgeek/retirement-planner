import React, { useState, useEffect } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputNumber } from 'primereact/inputnumber';
import { Checkbox } from 'primereact/checkbox';
import type { Scenario } from '../types/Scenario';
import type { ContributionLimits } from '../types/UserData';
import { getContributionLimits } from '../utils/contributionLimits';
import { fontSize, dialogWidth } from '../styles/theme';
import {
  Form,
  Section,
  SectionHeader,
  FieldRow,
  InputGroup,
  AssetRow,
  HelpText,
} from './SettingsDialogPrimitives';
import { pctField } from './SettingsDialogFields';

interface TaxAndIrsDialogProps {
  visible: boolean;
  onHide: () => void;
  scenario: Scenario;
  onSave: (updated: Scenario) => void;
}

interface FormState {
  longTermCapGainsRate: number;
  useStackedLtcgBrackets: boolean;
  enableIRMAA: boolean;
  enableNIIT: boolean;
  priorWorkingMagi: number;
  contributionLimits: ContributionLimits;
}

const TaxAndIrsDialog: React.FC<TaxAndIrsDialogProps> = ({
  visible,
  onHide,
  scenario,
  onSave,
}) => {
  const formFromScenario = (s: Scenario): FormState => ({
    longTermCapGainsRate: s.longTermCapGainsRate,
    useStackedLtcgBrackets: s.useStackedLtcgBrackets === true,
    enableIRMAA: s.enableIRMAA !== false,
    enableNIIT: s.enableNIIT !== false,
    priorWorkingMagi: s.priorWorkingMagi ?? 0,
    contributionLimits: getContributionLimits(s),
  });

  const [form, setForm] = useState<FormState>(() => formFromScenario(scenario));

  useEffect(() => {
    if (visible) setForm(formFromScenario(scenario));
    // Initialize form state only when the dialog opens (false→true).
    // `scenario` is deliberately NOT a dep: the automatic ~1s
    // lastSuccessProbability write-back replaces the scenario object identity
    // while the dialog is open, and re-running this effect then would wipe the
    // user's in-progress edits. Same pattern as ModelingDialog / ScenarioDialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleSave = () => {
    onSave({
      ...scenario,
      longTermCapGainsRate: form.longTermCapGainsRate,
      useStackedLtcgBrackets: form.useStackedLtcgBrackets ? true : undefined,
      enableIRMAA: form.enableIRMAA,
      enableNIIT: form.enableNIIT,
      priorWorkingMagi: form.priorWorkingMagi > 0 ? form.priorWorkingMagi : undefined,
      contributionLimits: form.contributionLimits,
    });
    onHide();
  };

  const dialogFooter = (
    <div>
      <Button label="Cancel" icon="pi pi-times" onClick={onHide} className="p-button-text" />
      <Button label="Save" icon="pi pi-check" onClick={handleSave} />
    </div>
  );

  return (
    <Dialog
      header="Tax & IRS"
      visible={visible}
      style={dialogWidth('30rem')}
      onHide={onHide}
      footer={dialogFooter}
    >
      <Form onSubmit={(e) => e.preventDefault()}>

        <Section>
          <SectionHeader>Capital Gains</SectionHeader>
          <AssetRow>
            <Checkbox
              inputId="stacked-ltcg"
              checked={form.useStackedLtcgBrackets}
              onChange={(e) => setForm({ ...form, useStackedLtcgBrackets: !!e.checked })}
            />
            <label htmlFor="stacked-ltcg" style={{ fontSize: fontSize.sm, cursor: 'pointer' }}>
              Use 0/15/20% bracket stacking (federal)
            </label>
          </AssetRow>
          {!form.useStackedLtcgBrackets && (
            <InputGroup>
              <label>Long-term Capital Gains Rate (federal)</label>
              {pctField(form.longTermCapGainsRate, (v) => setForm({ ...form, longTermCapGainsRate: v }), 40)}
            </InputGroup>
          )}
          <HelpText>
            {form.useStackedLtcgBrackets
              ? 'Federal LTCG is taxed by the 0/15/20% brackets, stacked on top of your ordinary taxable income (the flat rate is ignored). State tax on capital gains is applied automatically at the resident state’s rate.'
              : 'A flat federal rate is applied to brokerage gains. State tax on capital gains is applied automatically at the resident state’s rate.'}
          </HelpText>
        </Section>

        <Section>
          <SectionHeader>Medicare IRMAA</SectionHeader>
          <AssetRow>
            <Checkbox
              inputId="enable-irmaa"
              checked={form.enableIRMAA}
              onChange={(e) => setForm({ ...form, enableIRMAA: !!e.checked })}
            />
            <label htmlFor="enable-irmaa" style={{ fontSize: fontSize.sm, cursor: 'pointer' }}>
              Apply Medicare IRMAA surcharges (age 65+)
            </label>
          </AssetRow>
          <HelpText>
            Part B + Part D premium surcharges from MAGI 2 years prior. Per Medicare-enrolled
            person. 2024 tiers, inflation-indexed forward.
          </HelpText>
          {form.enableIRMAA && (
            <InputGroup>
              <label>
                Last working year MAGI{scenario.filingStatus === 'mfj' ? ' (joint)' : ''}
              </label>
              <InputNumber
                value={form.priorWorkingMagi}
                onValueChange={(e) => setForm({ ...form, priorWorkingMagi: e.value ?? 0 })}
                mode="currency"
                currency="USD"
                min={0}
                inputStyle={{ width: '10rem' }}
              />
              <HelpText>
                Used only for the first two retirement years, when the in-sim history
                doesn't cover the IRS 2-year IRMAA lookback.{' '}
                {scenario.filingStatus === 'mfj'
                  ? "Enter the joint MAGI from the household's last working year."
                  : "Enter the MAGI from your last working year."}
                {' '}Leave 0 to assume no IRMAA in those years.
              </HelpText>
            </InputGroup>
          )}
        </Section>

        <Section>
          <SectionHeader>Net Investment Income Tax</SectionHeader>
          <AssetRow>
            <Checkbox
              inputId="enable-niit"
              checked={form.enableNIIT}
              onChange={(e) => setForm({ ...form, enableNIIT: !!e.checked })}
            />
            <label htmlFor="enable-niit" style={{ fontSize: fontSize.sm, cursor: 'pointer' }}>
              Apply 3.8% Net Investment Income Tax
            </label>
          </AssetRow>
          <HelpText>
            3.8% on the lesser of investment income or MAGI above $200k (single) / $250k (MFJ).
            Thresholds are statutory and not inflation-indexed.
          </HelpText>
        </Section>

        <Section>
          <SectionHeader>Contribution Limits</SectionHeader>
          <FieldRow>
            <InputGroup>
              <label>401(k) Elective</label>
              <InputNumber
                value={form.contributionLimits.elective401k}
                onValueChange={(e) =>
                  setForm({
                    ...form,
                    contributionLimits: { ...form.contributionLimits, elective401k: e.value ?? 0 },
                  })
                }
                mode="currency"
                currency="USD"
                min={0}
                inputStyle={{ width: '8rem' }}
              />
            </InputGroup>
            <InputGroup>
              <label>IRA Limit</label>
              <InputNumber
                value={form.contributionLimits.iraLimit}
                onValueChange={(e) =>
                  setForm({
                    ...form,
                    contributionLimits: { ...form.contributionLimits, iraLimit: e.value ?? 0 },
                  })
                }
                mode="currency"
                currency="USD"
                min={0}
                inputStyle={{ width: '8rem' }}
              />
            </InputGroup>
          </FieldRow>
          <FieldRow>
            <InputGroup>
              <label>Catch-up Age</label>
              <InputNumber
                value={form.contributionLimits.catchUpAge}
                onValueChange={(e) =>
                  setForm({
                    ...form,
                    contributionLimits: { ...form.contributionLimits, catchUpAge: e.value ?? 50 },
                  })
                }
                min={0}
                max={100}
                inputStyle={{ width: '6rem' }}
              />
            </InputGroup>
            <InputGroup>
              <label>401(k) Catch-up</label>
              <InputNumber
                value={form.contributionLimits.catchUp401k}
                onValueChange={(e) =>
                  setForm({
                    ...form,
                    contributionLimits: { ...form.contributionLimits, catchUp401k: e.value ?? 0 },
                  })
                }
                mode="currency"
                currency="USD"
                min={0}
                inputStyle={{ width: '8rem' }}
              />
            </InputGroup>
            <InputGroup>
              <label>401(k) Catch-up (60–63)</label>
              <InputNumber
                value={form.contributionLimits.superCatchUp401k}
                onValueChange={(e) =>
                  setForm({
                    ...form,
                    contributionLimits: { ...form.contributionLimits, superCatchUp401k: e.value ?? 0 },
                  })
                }
                mode="currency"
                currency="USD"
                min={0}
                inputStyle={{ width: '8rem' }}
              />
            </InputGroup>
            <InputGroup>
              <label>IRA Catch-up</label>
              <InputNumber
                value={form.contributionLimits.catchUpIra}
                onValueChange={(e) =>
                  setForm({
                    ...form,
                    contributionLimits: { ...form.contributionLimits, catchUpIra: e.value ?? 0 },
                  })
                }
                mode="currency"
                currency="USD"
                min={0}
                inputStyle={{ width: '8rem' }}
              />
            </InputGroup>
          </FieldRow>
          <AssetRow>
            <Checkbox
              inputId="contribution-limits-inflation"
              checked={form.contributionLimits.inflationAdjusted}
              onChange={(e) =>
                setForm({
                  ...form,
                  contributionLimits: {
                    ...form.contributionLimits,
                    inflationAdjusted: !!e.checked,
                  },
                })
              }
            />
            <label
              htmlFor="contribution-limits-inflation"
              style={{ fontSize: fontSize.sm, cursor: 'pointer' }}
            >
              Adjust caps for inflation each year
            </label>
          </AssetRow>
          <HelpText>
            Caps are enforced per-owner per-kind. Excess contributions are not deposited;
            the dollars remain in spendable cash via the originating wage event.
            The 60–63 catch-up is the SECURE 2.0 enhanced 401(k) amount; at 64 the regular
            catch-up resumes. IRAs have no enhanced catch-up. The 60–63 band itself is fixed
            by statute, but it still starts no earlier than the catch-up age above — set that
            past 63 and no enhanced catch-up applies.
          </HelpText>
        </Section>

      </Form>
    </Dialog>
  );
};

export default TaxAndIrsDialog;
