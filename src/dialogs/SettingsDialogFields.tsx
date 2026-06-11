import { InputNumber } from 'primereact/inputnumber';

// Percent input field for settings dialogs: stores a 0–1 fraction, displays
// 0–100 with one decimal. Lives apart from SettingsDialogPrimitives so that
// file exports only components (react-refresh/only-export-components).
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
