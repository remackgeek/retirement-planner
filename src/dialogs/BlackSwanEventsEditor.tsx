import React, { useState } from 'react';
import styled from 'styled-components';
import { InputNumber } from 'primereact/inputnumber';
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

const AddRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  flex-wrap: wrap;
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
  grid-template-columns: 3rem 1fr auto auto;
  align-items: center;
  gap: ${spacing.sm};
  padding: ${spacing.xs} ${spacing.sm};
  border: ${border.standard};
  border-radius: ${border.radius};
  font-size: ${fontSize.sm};
`;

const Year = styled.span`
  font-weight: 600;
  color: ${colors.textPrimary};
`;

const TemplateName = styled.span`
  color: ${colors.textPrimary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Multipliers = styled.span`
  color: ${colors.textSecondary};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const StockDelta = styled.span<{ $negative: boolean }>`
  color: ${(p) => (p.$negative ? colors.danger : colors.textSecondary)};
`;

const BondDelta = styled.span<{ $negative: boolean }>`
  color: ${(p) => (p.$negative ? colors.danger : colors.textSecondary)};
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
}

function formatPct(multiplier: number): string {
  const pct = (multiplier - 1) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

const BlackSwanEventsEditor: React.FC<Props> = ({ events, onChange, yearMin, yearMax }) => {
  const initialYear = events.length > 0 ? events[events.length - 1].year + 1 : yearMin;
  const [pendingYear, setPendingYear] = useState<number>(initialYear);

  const yearOutOfRange = pendingYear < yearMin || pendingYear > yearMax;

  const handleTemplatePick = (template: BlackSwanTemplate | null) => {
    if (!template) return;
    const expanded: BlackSwanEvent[] = template.years.map((y, offset) => ({
      year: pendingYear + offset,
      stockMultiplier: y.stockMultiplier,
      bondMultiplier: y.bondMultiplier,
    }));
    onChange([...events, ...expanded]);
    setPendingYear(pendingYear + template.years.length);
  };

  const handleDelete = (index: number) => {
    const next = events.filter((_, i) => i !== index);
    onChange(next);
  };

  return (
    <Wrapper>
      <HelpText>
        Multipliers scale the simulated return for that year — e.g. a stock multiplier of 0.63
        turns a typical +5% year into roughly &minus;34%.
      </HelpText>

      <AddRow>
        <AddLabel>Add:</AddLabel>
        <InputNumber
          value={pendingYear}
          onValueChange={(e) => setPendingYear(e.value ?? yearMin)}
          useGrouping={false}
          min={1900}
          max={2200}
          inputStyle={{ width: '5rem' }}
        />
        <Dropdown
          value={null}
          options={BLACK_SWAN_TEMPLATES}
          optionLabel="label"
          placeholder="Pick a template…"
          onChange={(e) => handleTemplatePick(e.value as BlackSwanTemplate | null)}
          style={{ flex: 1, minWidth: '12rem' }}
        />
      </AddRow>
      {yearOutOfRange && (
        <Warning>
          Year is outside the scenario range ({yearMin}–{yearMax}); event will not appear on the chart.
        </Warning>
      )}

      {events.length > 0 && (
        <EventList>
          {events.map((ev, i) => {
            const template = findTemplateForEvent(ev);
            const stockNeg = ev.stockMultiplier < 1;
            const bondNeg = ev.bondMultiplier < 1;
            return (
              <EventRow key={`${ev.year}-${i}`}>
                <Year>{ev.year}</Year>
                <TemplateName>{template ? template.label : '—'}</TemplateName>
                <Multipliers>
                  <StockDelta $negative={stockNeg}>{formatPct(ev.stockMultiplier)}</StockDelta>
                  {' / '}
                  <BondDelta $negative={bondNeg}>{formatPct(ev.bondMultiplier)}</BondDelta>
                </Multipliers>
                <DeleteButton
                  type="button"
                  aria-label="Delete event"
                  onClick={() => handleDelete(i)}
                >
                  ×
                </DeleteButton>
              </EventRow>
            );
          })}
        </EventList>
      )}
    </Wrapper>
  );
};

export default BlackSwanEventsEditor;
