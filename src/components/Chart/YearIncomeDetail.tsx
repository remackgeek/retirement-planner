import React from 'react';
import { spacing, colors, border, fontSize } from '../../styles/theme';
import { toDisplay, type DisplayCurrency } from '../../utils/displayCurrency';
import { fmtPct } from '../../utils/formatPercent';
import type { AnnualCashFlowBreakdown } from '../../services/SimulationService';
import { fmtMoney } from './YearTaxAudit';

interface Props {
  breakdown: AnnualCashFlowBreakdown;
  pathFactor: number;
  displayCurrency: DisplayCurrency;
}

const headerCell = {
  fontWeight: 'bold' as const,
  fontSize: fontSize.xs,
  color: colors.textSecondary,
  padding: `${spacing.xs} ${spacing.sm}`,
  borderBottom: border.standard,
  textAlign: 'left' as const,
  whiteSpace: 'nowrap' as const,
};
const bodyCell = {
  fontSize: fontSize.xs,
  color: colors.textSecondary,
  padding: `2px ${spacing.sm}`,
  fontVariantNumeric: 'tabular-nums' as const,
};

const YearIncomeDetail: React.FC<Props> = ({ breakdown, pathFactor, displayCurrency }) => {
  const audit = breakdown.audit;
  if (!audit) {
    return (
      <div style={{ padding: spacing.md, color: colors.textMuted, fontSize: fontSize.xs }}>
        Audit data not available for this year.
      </div>
    );
  }
  const d = (v: number) => toDisplay(v, pathFactor, displayCurrency);
  const events = audit.incomeEventTaxBreakdown;

  // Reconciliation: sum of marginalTax should ~equal ordinaryTax.
  const sumMarginalTax = events.reduce((s, e) => s + e.marginalTax, 0);
  const reconciliationDelta = breakdown.ordinaryTax - sumMarginalTax;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* Per-event ordinary tax attribution */}
      <div>
        <div style={{
          fontWeight: 'bold' as const,
          fontSize: fontSize.sm,
          color: colors.textPrimary,
          borderBottom: border.standard,
          paddingBottom: spacing.xs,
          marginBottom: spacing.xs,
        }}>Per-event Ordinary Tax (marginal stack)</div>
        {events.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: fontSize.xs, padding: spacing.sm }}>No ordinary-income events this year.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headerCell}>Source</th>
                  <th style={headerCell}>Type</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Gross</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Taxable contribution</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Marginal tax</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Marginal rate</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.eventId}-${i}`}>
                    <td style={bodyCell}>{e.eventName}</td>
                    <td style={{ ...bodyCell, color: colors.textMuted }}>{e.eventType}</td>
                    <td style={{ ...bodyCell, textAlign: 'right' }}>${fmtMoney(d(e.gross))}</td>
                    <td style={{
                      ...bodyCell,
                      textAlign: 'right',
                      color: e.taxableContribution < 0 ? colors.income : colors.textSecondary,
                    }}>{e.taxableContribution < 0 ? '-' : ''}${fmtMoney(d(Math.abs(e.taxableContribution)))}</td>
                    <td style={{ ...bodyCell, textAlign: 'right', color: e.marginalTax < 0 ? colors.income : colors.textSecondary }}>
                      {e.marginalTax < 0 ? '-' : ''}${fmtMoney(d(Math.abs(e.marginalTax)))}
                    </td>
                    <td style={{ ...bodyCell, textAlign: 'right', color: colors.textMuted }}>{fmtPct(e.marginalRate)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} style={{ ...bodyCell, fontWeight: 'bold' as const, borderTop: border.standard }}>Total ordinary tax</td>
                  <td style={{ ...bodyCell, textAlign: 'right', fontWeight: 'bold' as const, borderTop: border.standard }}>${fmtMoney(d(breakdown.ordinaryTax))}</td>
                  <td style={{ ...bodyCell, borderTop: border.standard }}></td>
                </tr>
                {Math.abs(reconciliationDelta) > 1 && (
                  <tr>
                    <td colSpan={6} style={{ ...bodyCell, color: colors.textMuted, fontSize: fontSize.xs }}>
                      Reconciliation drift: {reconciliationDelta < 0 ? '-' : ''}${fmtMoney(d(Math.abs(reconciliationDelta)))} (rounding / floor-at-zero effects).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 1.4 }}>
          Each row's marginal tax is the incremental federal+state ordinary tax delta when that source is stacked
          on top of all sources above it. Pre-tax contributions appear as negative reductions. Capital gains, NIIT,
          and IRMAA are not attributed per-event — see the Tax Audit tab.
        </div>
      </div>

      {/* Per-account flows */}
      <div>
        <div style={{
          fontWeight: 'bold' as const,
          fontSize: fontSize.sm,
          color: colors.textPrimary,
          borderBottom: border.standard,
          paddingBottom: spacing.xs,
          marginBottom: spacing.xs,
        }}>Per-account Flows</div>
        {(!audit.accountFlows || audit.accountFlows.length === 0) ? (
          <div style={{ color: colors.textMuted, fontSize: fontSize.xs, padding: spacing.sm }}>No account movements this year.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headerCell}>Account</th>
                  <th style={headerCell}>Type</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Withdrawal</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Deposit</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {audit.accountFlows.map((row) => (
                  <tr key={row.accountId}>
                    <td style={bodyCell}>{row.accountName}</td>
                    <td style={{ ...bodyCell, color: colors.textMuted }}>{row.accountType}</td>
                    <td style={{ ...bodyCell, textAlign: 'right', color: row.withdrawal > 0 ? colors.spending : colors.textMuted }}>
                      {row.withdrawal > 0 ? `-$${fmtMoney(d(row.withdrawal))}` : '—'}
                    </td>
                    <td style={{ ...bodyCell, textAlign: 'right', color: row.deposit > 0 ? colors.income : colors.textMuted }}>
                      {row.deposit > 0 ? `+$${fmtMoney(d(row.deposit))}` : '—'}
                    </td>
                    <td style={{ ...bodyCell, textAlign: 'right' }}>
                      {(() => {
                        const net = row.deposit - row.withdrawal;
                        if (Math.abs(net) < 0.5) return '$0';
                        return `${net >= 0 ? '+' : '-'}$${fmtMoney(d(Math.abs(net)))}`;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 1.4 }}>
          Withdrawals are pro-rata across all accounts of each tax type (Taxable → Traditional → Roth waterfall).
          Deposits include Roth conversions, RMD excess reinvestment, retirement contributions, and surplus cash flow.
          Growth (return-driven balance changes) is not shown here — see the Summary tab.
        </div>
      </div>
    </div>
  );
};

export default YearIncomeDetail;
