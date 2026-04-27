import React, { useState } from 'react';
import styled from 'styled-components';
import { Dropdown } from 'primereact/dropdown';
import type { BlackSwanEvent } from '../types/IncomeEvent';
import {
  BLACK_SWAN_TEMPLATES,
  findTemplateForEvent,
  type BlackSwanTemplate,
} from '../data/blackSwanTemplates';
import { spacing, colors, fontSize, border } from '../styles/theme';

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

const HelpText = styled.div`
  font-size: ${fontSize.xs};
  color: ${colors.textSecondary};
  font-style: italic;
`;

const AddSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

const AddLabel = styled.span`
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
`;

const Warning = styled.span`
  font-size: ${fontSize.xs};
  color: ${colors.danger};
`;

const EventList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

const EventRow = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: ${spacing.sm};
  padding: ${spacing.xs} ${spacing.sm};
  border: ${border.standard};
  border-radius: ${border.radius};
  font-size: ${fontSize.sm};
`;

const EventName = styled.span`
  color: ${colors.textPrimary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const YearRange = styled.span`
  color: ${colors.textSecondary};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const DeleteButton = styled.button`
  background: none;
  border: none;
  color: ${colors.textMuted};
  cursor: pointer;
  font-size: ${fontSize.md};
  padding: 0 ${spacing.xs};
  line-height: 1;
  &:hover {
    color: ${colors.danger};
  }
`;

interface Props {
  events: BlackSwanEvent[];
  onChange: (next: BlackSwanEvent[]) => void;
  yearMin: number;
  yearMax: number;
  baseAge: number;
}

interface EventGroup {
  groupId: string | null;
  label: string;
  indices: number[];
  startYear: number;
  endYear: number;
}

const BlackSwanEventsEditor: React.FC<Props> = ({ events, onChange, yearMin, yearMax, baseAge }) => {
  const [pendingYear, setPendingYear] = useState<number>(yearMin);
  const [overlapWarning, setOverlapWarning] = useState(false);

  const yearOptions = Array.from({ length: yearMax - yearMin + 1 }, (_, i) => {
    const y = yearMin + i;
    return { label: `${y} (age ${baseAge + i})`, value: y };
  });

  const occupiedYears = new Set(events.map((e) => e.year));

  const handleTemplatePick = (template: BlackSwanTemplate | null) => {
    if (!template) return;
    const years = template.years.map((_, offset) => pendingYear + offset);
    if (years.some((y) => occupiedYears.has(y))) {
      setOverlapWarning(true);
      return;
    }
    setOverlapWarning(false);
    const groupId = crypto.randomUUID();
    const expanded: BlackSwanEvent[] = template.years.map((y, offset) => ({
      year: pendingYear + offset,
      stockMultiplier: y.stockMultiplier,
      bondMultiplier: y.bondMultiplier,
      groupId,
    }));
    onChange([...events, ...expanded]);
    const nextYear = pendingYear + template.years.length;
    if (nextYear <= yearMax) setPendingYear(nextYear);
  };

  const handleDeleteGroup = (indices: number[]) => {
    const indexSet = new Set(indices);
    onChange(events.filter((_, i) => !indexSet.has(i)));
  };

  // Build groups: events sharing a groupId → one group; ungrouped events → singleton groups
  const groups: EventGroup[] = [];
  const seen = new Map<string, number>(); // groupId → index in groups
  events.forEach((ev, i) => {
    if (ev.groupId) {
      const existing = seen.get(ev.groupId);
      if (existing !== undefined) {
        groups[existing].indices.push(i);
        groups[existing].endYear = Math.max(groups[existing].endYear, ev.year);
      } else {
        seen.set(ev.groupId, groups.length);
        groups.push({
          groupId: ev.groupId,
          label: findTemplateForEvent(ev)?.label ?? '—',
          indices: [i],
          startYear: ev.year,
          endYear: ev.year,
        });
      }
    } else {
      groups.push({
        groupId: null,
        label: findTemplateForEvent(ev)?.label ?? '—',
        indices: [i],
        startYear: ev.year,
        endYear: ev.year,
      });
    }
  });

  const formatYearRange = (g: EventGroup): string => {
    const startAge = baseAge + (g.startYear - yearMin);
    if (g.startYear === g.endYear) return `${g.startYear} (age ${startAge})`;
    const endAge = baseAge + (g.endYear - yearMin);
    return `${g.startYear}–${g.endYear} (age ${startAge}–${endAge})`;
  };

  return (
    <Wrapper>
      <HelpText>
        Apply historical market crises at specific points in your retirement to stress-test your
        plan. Each event replaces that year's simulated returns with real historical data.
      </HelpText>

      <AddSection>
        <AddLabel>Starting year</AddLabel>
        <Dropdown
          value={pendingYear}
          options={yearOptions}
          onChange={(e) => {
            setPendingYear(e.value as number);
            setOverlapWarning(false);
          }}
          style={{ width: '100%' }}
        />
        <Dropdown
          value={null}
          options={BLACK_SWAN_TEMPLATES}
          optionLabel="label"
          placeholder="Choose a historical crisis…"
          onChange={(e) => handleTemplatePick(e.value as BlackSwanTemplate | null)}
          style={{ width: '100%' }}
        />
        {overlapWarning && (
          <Warning>
            That year range overlaps an existing event. Choose a different starting year or remove
            the conflicting event first.
          </Warning>
        )}
      </AddSection>

      {groups.length > 0 && (
        <EventList>
          {groups.map((g, gi) => (
            <EventRow key={`group-${gi}`}>
              <EventName>{g.label}</EventName>
              <YearRange>{formatYearRange(g)}</YearRange>
              <DeleteButton
                type="button"
                aria-label="Remove event"
                onClick={() => handleDeleteGroup(g.indices)}
              >
                ×
              </DeleteButton>
            </EventRow>
          ))}
        </EventList>
      )}
    </Wrapper>
  );
};

export default BlackSwanEventsEditor;
