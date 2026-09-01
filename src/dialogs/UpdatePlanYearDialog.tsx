import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import type { Scenario } from '../types/Scenario';
import { spacing, colors, fontSize, border, dialogWidth } from '../styles/theme';
import { rollScenarioToYear } from '../utils/rollScenarioYear';

/**
 * Confirm for the explicit "Update to current year" action. Previews exactly
 * what the roll changes (plan year, ages, any life-expectancy bump, items that
 * fall into the past) and what stays put, then offers Update (rewrite in place)
 * or Clone & update (keep the old plan as a checkpoint, activate the updated
 * copy). Shared by the stale-plan banner and the sidebar's calendar action.
 *
 * The previewed target year is handed back through `onConfirm` so the applied
 * roll is exactly the one the user saw (no second clock read on confirm).
 */

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
  font-size: ${fontSize.sm};
  color: ${colors.textPrimary};
  line-height: 1.4;

  p {
    margin: 0;
  }
`;

const ChangeList = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: ${spacing.md};
  row-gap: ${spacing.xs};
  padding: ${spacing.sm};
  background: ${colors.bgMedium};
  border: ${border.light};
  border-radius: ${border.radius};
  font-variant-numeric: tabular-nums;

  dt {
    color: ${colors.textSecondary};
  }
  dd {
    margin: 0;
    font-weight: 600;
  }
`;

const PastList = styled.ul`
  margin: 0;
  padding-left: ${spacing.lg};
  font-size: ${fontSize.xs};
  color: ${colors.textSecondary};
`;

const Muted = styled.p`
  font-size: ${fontSize.xs};
  color: ${colors.textMuted};
`;

interface UpdatePlanYearDialogProps {
  visible: boolean;
  scenario: Scenario | null;
  onHide: () => void;
  onConfirm: (mode: 'in_place' | 'clone', toYear: number) => void;
}

const UpdatePlanYearDialog: React.FC<UpdatePlanYearDialogProps> = ({
  visible,
  scenario,
  onHide,
  onConfirm,
}) => {
  // Cheap shallow transform; recomputed per render so the preview can never be
  // stale relative to the scenario it describes.
  const changes = scenario ? rollScenarioToYear(scenario).changes : null;
  if (!scenario || !changes) return null;

  const arrow = (from: number, to: number) => `${from} → ${to}`;
  const choose = (mode: 'in_place' | 'clone') => {
    onConfirm(mode, changes.toYear);
    onHide();
  };

  const footer = (
    <div style={{ display: 'flex', gap: spacing.xs, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <Button label="Cancel" icon="pi pi-times" onClick={onHide} className="p-button-text" />
      <Button
        label="Update"
        icon="pi pi-calendar"
        onClick={() => choose('in_place')}
        className="p-button-outlined"
        tooltip="Rewrite this scenario in place"
        tooltipOptions={{ position: 'top' }}
      />
      <Button
        label="Clone & update"
        icon="pi pi-copy"
        onClick={() => choose('clone')}
        autoFocus
        tooltip={`Keep "${scenario.name}" unchanged as a checkpoint and work in an updated copy`}
        tooltipOptions={{ position: 'top' }}
      />
    </div>
  );

  return (
    <Dialog
      header={
        <>
          <i className="pi pi-calendar" style={{ marginRight: spacing.sm, color: colors.primary }} />
          Update plan to {changes.toYear}
        </>
      }
      visible={visible}
      style={dialogWidth('30rem')}
      onHide={onHide}
      footer={footer}
    >
      <Body>
        <p>
          <strong>{scenario.name}</strong> is set up for {changes.fromYear}. Updating moves
          "today" forward {changes.delta === 1 ? 'one year' : `${changes.delta} years`}:
        </p>
        <ChangeList>
          <dt>Plan year</dt>
          <dd>{arrow(changes.fromYear, changes.toYear)}</dd>
          <dt>Your age</dt>
          <dd>{arrow(changes.currentAge.from, changes.currentAge.to)}</dd>
          {changes.spouseAge && (
            <>
              <dt>Spouse age</dt>
              <dd>{arrow(changes.spouseAge.from, changes.spouseAge.to)}</dd>
            </>
          )}
          <dt>Life expectancy</dt>
          <dd>
            {changes.lifeExpectancyBumped
              ? `${arrow(changes.lifeExpectancyBumped.from, changes.lifeExpectancyBumped.to)} (raised to stay above your age)`
              : `${scenario.lifeExpectancy} (unchanged)`}
          </dd>
          {changes.spouseLifeExpectancyBumped && (
            <>
              <dt>Spouse life exp.</dt>
              <dd>
                {arrow(changes.spouseLifeExpectancyBumped.from, changes.spouseLifeExpectancyBumped.to)} (raised)
              </dd>
            </>
          )}
          {changes.historicalStartYear && (
            <>
              <dt>Historical start</dt>
              <dd>
                {arrow(changes.historicalStartYear.from, changes.historicalStartYear.to)} (keeps the same
                historical year under each calendar year)
              </dd>
            </>
          )}
        </ChangeList>
        <p>
          Income, spending, and Roth conversions are tied to ages, so they stay on the same
          calendar years. Relocation years, stress-test years, and account balances are left
          exactly as entered.
        </p>
        {changes.pastItems.length > 0 && (
          <div>
            <p>These end before {changes.toYear} and will no longer contribute:</p>
            <PastList>
              {changes.pastItems.map((p) => (
                <li key={p.id}>
                  {p.name} ({p.kind === 'income' ? 'income' : 'spending'}, through {p.lastYear})
                </li>
              ))}
            </PastList>
          </div>
        )}
        <Muted>
          Afterwards, review account balances and any "today's dollars" amounts — they are
          now read as {changes.toYear} figures — and the "last working year MAGI" under
          Settings → Tax &amp; IRS, which the first two years' IRMAA lookback uses. Choose{' '}
          <strong>Clone &amp; update</strong> to keep the {changes.fromYear} plan as a record
          you can still compare against.
        </Muted>
      </Body>
    </Dialog>
  );
};

export default UpdatePlanYearDialog;
