import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { spacing, colors, fontSize } from '../styles/theme';

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};

  label {
    font-size: ${fontSize.sm};
    color: ${colors.textPrimary};
  }

  .p-inputtext {
    width: 100%;
  }
`;

interface CloneScenarioDialogProps {
  visible: boolean;
  sourceName: string;
  onHide: () => void;
  onSave: (name: string) => void;
}

const CloneScenarioDialog: React.FC<CloneScenarioDialogProps> = ({
  visible,
  sourceName,
  onHide,
  onSave,
}) => {
  const [name, setName] = useState('');

  useEffect(() => {
    if (visible) setName(`Copy of ${sourceName}`);
  }, [visible, sourceName]);

  const isValid = name.trim().length > 0;

  const handleSave = () => {
    if (!isValid) return;
    onSave(name.trim());
    onHide();
  };

  const footer = (
    <div>
      <Button label="Cancel" icon="pi pi-times" onClick={onHide} className="p-button-text" />
      <Button label="Save Clone" icon="pi pi-copy" onClick={handleSave} disabled={!isValid} />
    </div>
  );

  return (
    <Dialog
      header={
        <>
          <i className="pi pi-copy" style={{ marginRight: spacing.sm, color: colors.primary }} />
          Clone Scenario
        </>
      }
      visible={visible}
      style={{ width: '28rem' }}
      onHide={onHide}
      footer={footer}
    >
      <FieldGroup>
        <label>Clone Name</label>
        <InputText
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          className={!isValid ? 'p-invalid' : ''}
          autoFocus
        />
      </FieldGroup>
    </Dialog>
  );
};

export default CloneScenarioDialog;
