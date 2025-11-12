import React, { useState, useEffect } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import type { Scenario } from '../types/Scenario';

interface ExportScenarioDialogProps {
  visible: boolean;
  onHide: () => void;
  scenario: Scenario | null;
  onConfirm: (filename: string) => Promise<void>;
}

const ExportScenarioDialog: React.FC<ExportScenarioDialogProps> = ({
  visible,
  onHide,
  scenario,
  onConfirm,
}) => {
  const [filename, setFilename] = useState('');

  useEffect(() => {
    if (visible && scenario) {
      const defaultName = `${scenario.name
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()}.json`;
      setFilename(defaultName);
    }
  }, [visible, scenario]);

  const handleConfirm = async () => {
    let finalFilename = filename.trim();
    if (!finalFilename.endsWith('.json')) {
      finalFilename += '.json';
    }
    if (finalFilename) {
      await onConfirm(finalFilename);
    }
    onHide();
  };

  const handleCancel = () => {
    setFilename('');
    onHide();
  };

  const footer = (
    <div>
      <Button
        label='Cancel'
        icon='pi pi-times'
        onClick={handleCancel}
        className='p-button-text'
      />
      <Button
        label='Export'
        icon='pi pi-download'
        onClick={handleConfirm}
        autoFocus
      />
    </div>
  );

  return (
    <Dialog
      header='Export Scenario'
      visible={visible}
      onHide={handleCancel}
      footer={footer}
      style={{ width: '50vw' }}
      modal
    >
      <div className='p-field'>
        <label htmlFor='filename'>Filename</label>
        <InputText
          id='filename'
          value={filename}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFilename(e.target.value || '')
          }
          placeholder='Enter filename (default: scenario_name.json)'
          autoFocus
        />
      </div>
    </Dialog>
  );
};

export default ExportScenarioDialog;
