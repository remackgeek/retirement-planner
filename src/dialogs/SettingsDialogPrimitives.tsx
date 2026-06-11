import styled from 'styled-components';
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

// --- Entity-edit dialog primitives (Account / Income / Spending / etc.) ---
// These are the shared variants the per-entity dialogs use; the settings
// dialogs above use Form / FieldRow / InputGroup. Where a dialog needs a
// one-off variant (e.g. CashBucketDialog's 3-column row), it stays local.

// Form that stretches PrimeReact inputs to the full dialog width.
export const FormFullWidth = styled.form`
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

// Unlabeled column group — the entity dialogs style their own labels.
export const InputGroupPlain = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

// Two-up grid row for paired fields (start/end age, amount/COLA, ...).
export const FieldRowGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing.md};
`;

// Amount input + fixed-width period selector (input grows, 9rem control).
export const AmountRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 9rem;
  gap: ${spacing.sm};
  align-items: start;
`;

export const CheckboxGroup = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
`;

export const TrashButton = styled.button`
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
