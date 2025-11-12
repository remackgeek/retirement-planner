import React from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';

interface ImportScenarioDialogProps {
  visible: boolean;
  onHide: () => void;
  onConfirm: () => Promise<void>;
}

const ImportScenarioDialog: React.FC<ImportScenarioDialogProps> = ({
  visible,
  onHide,
  onConfirm,
}) => {
  const handleConfirm = async () => {
    try {
      await onConfirm();
      onHide();
    } catch (error) {
      console.error('Import failed:', error);
      // Optionally show error toast or dialog here
      alert('Import failed: Invalid JSON or missing required fields.');
    }
  };

  const footer = (
    <div>
      <Button
        label='Cancel'
        icon='pi pi-times'
        onClick={onHide}
        className='p-button-text'
      />
    </div>
  );

  return (
    <Dialog
      header='Import Scenario'
      visible={visible}
      onHide={onHide}
      footer={footer}
      style={{ width: '50vw' }}
      modal
    >
      <div
        className='p-field'
        style={{ textAlign: 'center', padding: '2rem 0' }}
      >
        <label>Select a JSON file to import your scenario.</label>
        <br />
        <br />
        <Button
          label='Choose JSON File'
          icon='pi pi-upload'
          onClick={handleConfirm}
          autoFocus
        />
      </div>
    </Dialog>
  );
};

export default ImportScenarioDialog;
