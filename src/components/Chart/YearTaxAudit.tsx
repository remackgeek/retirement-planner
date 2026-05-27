import React from 'react';
import { Tooltip as PrimeTooltip } from 'primereact/tooltip';
import { spacing, colors, border, fontSize } from '../../styles/theme';
import { toDisplay, type DisplayCurrency } from '../../utils/displayCurrency';
import { fmtPctRound } from '../../utils/formatPercent';
import type { AnnualCashFlowBreakdown } from '../../services/SimulationService';

interface Props {
  breakdown: AnnualCashFlowBreakdown;
  pathFactor: number;
  displayCurrency: DisplayCurrency;
  year: number;
}

const fmtMoney = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: spacing.md }}>
    <div style={{
      fontWeight: 'bold' as const,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
      borderBottom: border.standard,
      paddingBottom: spacing.xs,
      marginBottom: spacing.xs,
    }}>{title}</div>
    {children}
  </div>
);

const Row: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  muted?: boolean;
  className?: string;
}> = ({ label, value, muted, className }) => (
  <div className={className} style={{
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: fontSize.xs,
    color: muted ? colors.textMuted : colors.textSecondary,
    padding: `2px 0`,
  }}>
    <span>{label}</span>
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
  </div>
);

const YearTaxAudit: React.FC<Props> = ({ breakdown, pathFactor, displayCurrency, year }) => {
  const audit = breakdown.audit;
  if (!audit) {
    return (
      <div style={{ padding: spacing.md, color: colors.textMuted, fontSize: fontSize.xs }}>
        Audit data not available for this year.
      </div>
    );
  }
  const d = (v: number) => toDisplay(v, pathFactor, displayCurrency);
  const ssZoneLabel: Record<string, string> = {
    'none': 'Below first threshold — 0% taxable',
    '50%': 'Between thresholds — up to 50% taxable',
    '85%': 'Above second threshold — up to 85% taxable',
    'mfs-flat': 'MFS — always 85% taxable',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))', gap: spacing.lg }}>
      {/* Ordinary Income Tax */}
      <div>
        <Section title="Ordinary Income Tax">
          <Row label={<>
            <span className="yt-tip-agi">AGI</span>
            <PrimeTooltip target=".yt-tip-agi" position="bottom" showDelay={150}>
              <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                Combined taxable income fed to the federal brackets:
                otherTaxableGross + Traditional withdrawal + SS taxable portion.
                This is the "gross income" input to the deduction step.
              </div>
            </PrimeTooltip>
          </>} value={`$${fmtMoney(d(audit.agi))}`} />
          <Row label="− Standard deduction" value={`$${fmtMoney(d(audit.standardDeduction))}`} />
          {audit.seniorAddOn > 0 && <Row label={`− Senior add-on (×${audit.numQualifyingSeniors})`} value={`$${fmtMoney(d(audit.seniorAddOn))}`} />}
          {audit.obbbReduction > 0 && <Row label={<>
            <span className="yt-tip-obbb">− OBBB senior bonus</span>
            <PrimeTooltip target=".yt-tip-obbb" position="bottom" showDelay={150}>
              <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                Temporary 2025–2028 enhanced senior deduction ($6,000 per qualifying senior,
                phased out 6¢ per $1 of gross above $75k single / $150k MFJ).
              </div>
            </PrimeTooltip>
          </>} value={`$${fmtMoney(d(audit.obbbReduction))}`} />}
          <Row label="Total deductions" value={`$${fmtMoney(d(audit.totalDeductions))}`} muted />
          <Row label="Taxable income" value={`$${fmtMoney(d(audit.taxableIncome))}`} />
          <Row label="Federal tax" value={`$${fmtMoney(d(audit.federalOrdinaryTax))}`} />
          <Row label="Marginal federal rate" value={fmtPctRound(audit.federalMarginalRate)} />
        </Section>

        <Section title={`State tax — ${audit.effectiveStateName}`}>
          {audit.stateNotes && (
            <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs, lineHeight: 1.4 }}>
              {audit.stateNotes}
            </div>
          )}
          {/* Components flow INTO the state ordinary base. Show each piece the
              user's state actually pulled or excluded, then arrive at the post-
              rule base, then subtract the state standard deduction, then walk
              the brackets. */}
          <Row label="Ordinary income" value={`$${fmtMoney(d(breakdown.otherTaxableGross))}`} muted />
          {breakdown.withdrawalFromTraditional > 0.5 && (
            <Row label="+ Traditional withdrawal" value={`$${fmtMoney(d(breakdown.withdrawalFromTraditional))}`} muted />
          )}
          {breakdown.ssTaxableAmount > 0.5 && (
            <Row label="+ SS taxable (federal portion)" value={`$${fmtMoney(d(breakdown.ssTaxableAmount))}`} muted />
          )}
          {audit.stateRetirementExclusionApplied > 0.5 && (
            <Row label="− State retirement-income exclusion" value={`$${fmtMoney(d(audit.stateRetirementExclusionApplied))}`} />
          )}
          {breakdown.ssTaxableAmount > 0.5 && audit.stateSsIncludedInState < breakdown.ssTaxableAmount - 0.5 && (
            <Row label="− SS exempted by state" value={`$${fmtMoney(d(breakdown.ssTaxableAmount - audit.stateSsIncludedInState))}`} />
          )}
          <Row label="= State ordinary base" value={`$${fmtMoney(d(audit.stateOrdinaryBaseGross))}`} />
          {audit.stateStdDeduction > 0.5 && (
            <Row label="− State standard deduction" value={`$${fmtMoney(d(audit.stateStdDeduction))}`} />
          )}
          <Row label="State ordinary tax" value={`$${fmtMoney(d(audit.stateOrdinaryTax))}`} />
          {audit.stateMarginalRate > 0 && (
            <Row label="State marginal rate" value={fmtPctRound(audit.stateMarginalRate)} muted />
          )}
          {audit.stateLocalitySurcharge > 0.5 && (
            <Row label="Locality surcharge (NYC)" value={`$${fmtMoney(d(audit.stateLocalitySurcharge))}`} />
          )}
        </Section>

        {audit.federalBrackets.length > 0 && audit.taxableIncome > 0 && (
          <Section title="Federal Brackets (this year)">
            <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs }}>
              Tax year {year} thresholds (inflation-indexed from 2026 base)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '3rem 1fr auto auto', columnGap: spacing.sm, rowGap: '2px', fontSize: fontSize.xs }}>
              <div style={{ fontWeight: 'bold' as const, color: colors.textSecondary }}>Rate</div>
              <div style={{ fontWeight: 'bold' as const, color: colors.textSecondary }}>Up to</div>
              <div style={{ fontWeight: 'bold' as const, color: colors.textSecondary, textAlign: 'right' }}>In bracket</div>
              <div style={{ fontWeight: 'bold' as const, color: colors.textSecondary, textAlign: 'right' }}>Tax</div>
              {audit.federalBrackets.map((b, i) => (
                <React.Fragment key={i}>
                  <div style={{
                    color: i === audit.federalBracketIndex ? colors.primary : colors.textSecondary,
                    fontWeight: i === audit.federalBracketIndex ? 'bold' as const : 'normal',
                  }}>{fmtPctRound(b.rate)}</div>
                  <div style={{ color: colors.textMuted }}>{b.upperScaled === Infinity ? '∞' : `$${fmtMoney(d(b.upperScaled))}`}</div>
                  <div style={{ textAlign: 'right', color: b.amountInBracket > 0 ? colors.textPrimary : colors.textMuted }}>${fmtMoney(d(b.amountInBracket))}</div>
                  <div style={{ textAlign: 'right', color: b.taxInBracket > 0 ? colors.textPrimary : colors.textMuted }}>${fmtMoney(d(b.taxInBracket))}</div>
                </React.Fragment>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* SS, IRMAA, NIIT, RMD */}
      <div>
        {breakdown.ssGross > 0 && (
          <Section title="Social Security Taxability">
            <Row label={<>
              <span className="yt-tip-pi">Provisional income</span>
              <PrimeTooltip target=".yt-tip-pi" position="bottom" showDelay={150}>
                <div style={{ maxWidth: '22rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                  IRS formula: other gross + ½ × SS gross. Compared against thresholds
                  frozen in law at $25k/$34k single, $32k/$44k MFJ (nominal dollars,
                  not inflation-indexed) to decide whether 0 / 50 / 85% of SS is taxable.
                  In Today's $ mode the displayed thresholds shrink with inflation —
                  the law value is fixed in future dollars, so it erodes in
                  today's-dollar terms. The arithmetic stays consistent: provisional
                  income and thresholds are deflated by the same factor.
                </div>
              </PrimeTooltip>
            </>} value={`$${fmtMoney(d(audit.ssProvisionalIncome))}`} />
            {audit.ssZone !== 'mfs-flat' && (
              <>
                <Row label="Threshold 1 (50% zone start)" value={`$${fmtMoney(d(audit.ssProvisionalThreshold1))}`} muted />
                <Row label="Threshold 2 (85% zone start)" value={`$${fmtMoney(d(audit.ssProvisionalThreshold2))}`} muted />
              </>
            )}
            <Row label="Zone hit" value={ssZoneLabel[audit.ssZone] ?? audit.ssZone} />
            <Row label="SS gross" value={`$${fmtMoney(d(breakdown.ssGross))}`} />
            <Row label="SS taxable portion" value={`$${fmtMoney(d(breakdown.ssTaxableAmount))}`} />
          </Section>
        )}

        {breakdown.irmaaSurcharge > 0.5 && (
          <Section title="IRMAA (Medicare Part B+D surcharge)">
            <Row label={<>
              <span className="yt-tip-irmaamagi">2-year-prior MAGI</span>
              <PrimeTooltip target=".yt-tip-irmaamagi" position="bottom" showDelay={150}>
                <div style={{ maxWidth: '20rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
                  IRS lookback rule: this year's IRMAA is set by MAGI from two years prior.
                  In the simulation: otherTaxableGross + Traditional withdrawal + SS taxable + taxable-account withdrawal from the year-2 breakdown.
                </div>
              </PrimeTooltip>
            </>} value={`$${fmtMoney(d(audit.irmaaLookbackMagi))}`} />
            <Row label={`Tier ${audit.irmaaTierIndex} upper bound`} value={audit.irmaaTierUpperScaled === Infinity ? '∞' : `$${fmtMoney(d(audit.irmaaTierUpperScaled))}`} muted />
            <Row label="Per-enrollee monthly surcharge" value={`$${(d(audit.irmaaMonthlySurcharge)).toFixed(2)}`} />
            <Row label="Per-enrollee annual" value={`$${fmtMoney(d(audit.irmaaPerEnrolleeAnnual))}`} muted />
            <Row label="Enrollees on Medicare (65+)" value={`${audit.irmaaEnrolleeCount}`} />
            <Row label="Total surcharge" value={`$${fmtMoney(d(breakdown.irmaaSurcharge))}`} />
          </Section>
        )}

        {breakdown.niitTax > 0.5 && (
          <Section title="NIIT (3.8% Net Investment Income Tax)">
            <Row label="MAGI" value={`$${fmtMoney(d(audit.niitMagi))}`} />
            <Row label="Threshold (frozen in law)" value={`$${fmtMoney(d(audit.niitThreshold))}`} muted />
            <Row label="MAGI excess" value={`$${fmtMoney(d(audit.niitMagiExcess))}`} />
            <Row label="Investment income proxy" value={`$${fmtMoney(d(audit.niitInvestmentIncome))}`} />
            <Row label="Taxable base = min(invest, excess)" value={`$${fmtMoney(d(audit.niitTaxableBase))}`} />
            <Row label="NIIT (× 3.8%)" value={`$${fmtMoney(d(breakdown.niitTax))}`} />
          </Section>
        )}

        {(audit.rmdSelf > 0 || audit.rmdSpouse > 0) && (
          <Section title="RMD (Required Minimum Distribution)">
            {audit.rmdSelf > 0 && (
              <>
                <Row label="Self — BoY Traditional balance" value={`$${fmtMoney(d(audit.rmdBoyBalanceSelf))}`} muted />
                <Row label={`Self — IRS uniform table divisor`} value={audit.rmdDivisorSelf.toFixed(1)} muted />
                <Row label="Self RMD" value={`$${fmtMoney(d(audit.rmdSelf))}`} />
              </>
            )}
            {audit.rmdSpouse > 0 && (
              <>
                <Row label="Spouse — BoY Traditional balance" value={`$${fmtMoney(d(audit.rmdBoyBalanceSpouse))}`} muted />
                <Row label="Spouse — IRS uniform table divisor" value={audit.rmdDivisorSpouse.toFixed(1)} muted />
                <Row label="Spouse RMD" value={`$${fmtMoney(d(audit.rmdSpouse))}`} />
              </>
            )}
            <Row label="Total RMD required" value={`$${fmtMoney(d(breakdown.rmdRequired))}`} />
            {breakdown.rmdExcess > 0.5 && <Row label="Excess reinvested to Brokerage" value={`$${fmtMoney(d(breakdown.rmdExcess))}`} muted />}
            {audit.rmdByAccount && audit.rmdByAccount.length > 0 && (
              <>
                <Row label="— Per-account distribution —" value="" muted />
                {audit.rmdByAccount.map((row) => (
                  <Row
                    key={row.accountId}
                    label={`From ${row.accountName}`}
                    value={`$${fmtMoney(d(row.withdrawal))}`}
                    muted
                  />
                ))}
              </>
            )}
          </Section>
        )}

        {(breakdown.federalCapGainsTax > 0.5 || breakdown.stateCapGainsTax > 0.5) && (
          <Section title="Capital Gains (brokerage account withdrawal)">
            <Row label="Brokerage withdrawal" value={`$${fmtMoney(d(breakdown.withdrawalFromBrokerage))}`} />
            <Row label="Federal LTCG (flat rate)" value={`$${fmtMoney(d(breakdown.federalCapGainsTax))}`} />
            {audit.stateLtcgThresholdApplied > 0 && (
              <Row label="State LTCG threshold (indexed)" value={`$${fmtMoney(d(audit.stateLtcgThresholdApplied))}`} muted />
            )}
            <Row label={`State LTCG (${audit.effectiveStateName})`} value={`$${fmtMoney(d(breakdown.stateCapGainsTax))}`} />
            {audit.stateLtcgTaxableAtState !== breakdown.withdrawalFromBrokerage && (
              <Row label="State-taxable LTCG portion" value={`$${fmtMoney(d(audit.stateLtcgTaxableAtState))}`} muted />
            )}
            <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 1.4 }}>
              Cost basis is not tracked — federal LTCG applies the flat <code>longTermCapGainsRate</code> to the full gross withdrawal.
              0/15/20% bracket stacking is not modeled. State treatment per profile (most: ordinary brackets; MO: exempt; WA: 7% above $270k indexed threshold).
            </div>
          </Section>
        )}
      </div>

      {/* Totals */}
      <div style={{ gridColumn: '1 / -1' }}>
        <Section title="Total Tax (this year)">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: spacing.md, rowGap: '2px', fontSize: fontSize.xs }}>
            <span>Federal ordinary</span><span style={{ textAlign: 'right' }}>${fmtMoney(d(audit.federalOrdinaryTax))}</span>
            <span>State ordinary</span><span style={{ textAlign: 'right' }}>${fmtMoney(d(audit.stateOrdinaryTax))}</span>
            {audit.stateLocalitySurcharge > 0.5 && (
              <>
                <span>Locality (NYC)</span><span style={{ textAlign: 'right' }}>${fmtMoney(d(audit.stateLocalitySurcharge))}</span>
              </>
            )}
            <span>Federal LTCG</span><span style={{ textAlign: 'right' }}>${fmtMoney(d(breakdown.federalCapGainsTax))}</span>
            <span>State LTCG</span><span style={{ textAlign: 'right' }}>${fmtMoney(d(breakdown.stateCapGainsTax))}</span>
            <span>NIIT</span><span style={{ textAlign: 'right' }}>${fmtMoney(d(breakdown.niitTax))}</span>
            <span>IRMAA</span><span style={{ textAlign: 'right' }}>${fmtMoney(d(breakdown.irmaaSurcharge))}</span>
            <span style={{ fontWeight: 'bold' as const, borderTop: border.standard, paddingTop: spacing.xs }}>Total</span>
            <span style={{ fontWeight: 'bold' as const, borderTop: border.standard, paddingTop: spacing.xs, textAlign: 'right' }}>${fmtMoney(d(breakdown.totalTax))}</span>
          </div>
        </Section>
      </div>
    </div>
  );
};

export default YearTaxAudit;
export { fmtMoney };
