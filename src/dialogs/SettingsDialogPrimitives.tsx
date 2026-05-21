import styled from 'styled-components';
import { InputNumber } from 'primereact/inputnumber';
import { spacing, colors, fontSize, border } from '../styles/theme';

export const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  padding: ${spacing.sm} 0;
`;

export const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

export const SectionHeader = styled.div`
  font-size: ${fontSize.sm};
  font-weight: 600;
  color: ${colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-bottom: ${spacing.xs};
  border-bottom: ${border.light};
  margin-bottom: ${spacing.xs};
`;

export const FieldRow = styled.div`
  display: flex;
  gap: ${spacing.md};
`;

export const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};

  label {
    font-size: ${fontSize.sm};
    color: ${colors.textPrimary};
  }
`;

export const AssetRow = styled.div`
  display: flex;
  gap: ${spacing.md};
  align-items: flex-end;
`;

export const AssetLabel = styled.div`
  flex: 0 0 4rem;
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
  padding-bottom: 0.4rem;
`;

export const ColumnHeader = styled.div`
  width: 8rem;
  font-size: ${fontSize.sm};
  color: ${colors.textPrimary};
`;

export const BlendedRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.xs};
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
  padding-top: ${spacing.xs};
  margin-bottom: ${spacing.md};
`;

export const BlendedValue = styled.span`
  font-weight: 600;
  color: ${colors.textPrimary};
`;

export const HelpText = styled.div`
  font-size: ${fontSize.xs};
  color: ${colors.textSecondary};
`;

export const pctField = (
  value: number,
  onChange: (v: number) => void,
  max = 50,
  disabled = false
) => (
  <InputNumber
    value={value * 100}
    onValueChange={(e) => onChange((e.value ?? 0) / 100)}
    mode="decimal"
    minFractionDigits={1}
    maxFractionDigits={1}
    min={0}
    max={max}
    suffix="%"
    inputStyle={{ width: '8rem' }}
    disabled={disabled}
  />
);
