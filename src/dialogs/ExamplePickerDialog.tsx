import React from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { spacing, colors, border, fontSize } from '../styles/theme';
import { EXAMPLE_SCENARIOS, type ExampleTemplate } from '../data/exampleScenarios';

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
  padding: ${spacing.sm} 0;
`;

const Row = styled.button`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${spacing.xs};
  padding: ${spacing.sm} ${spacing.md};
  font-family: inherit;
  text-align: left;
  background: white;
  border: 1px solid ${colors.primary};
  border-radius: ${border.radius};
  color: ${colors.textPrimary};
  cursor: pointer;
  transition: background-color 0.15s;

  &:hover {
    background-color: ${colors.bgHover};
  }
`;

const Label = styled.div`
  font-size: ${fontSize.base};
  font-weight: 600;
  color: ${colors.primary};
`;

const Description = styled.div`
  font-size: ${fontSize.xs};
  color: ${colors.textSecondary};
  line-height: 1.4;
`;

interface ExamplePickerDialogProps {
  visible: boolean;
  onHide: () => void;
  onSelect: (template: ExampleTemplate) => void;
}

const ExamplePickerDialog: React.FC<ExamplePickerDialogProps> = ({
  visible,
  onHide,
  onSelect,
}) => {
  const handleSelect = (example: ExampleTemplate) => {
    onSelect(example);
    onHide();
  };

  return (
    <Dialog
      header="Load Example Scenario"
      visible={visible}
      style={{ width: '26rem' }}
      onHide={onHide}
    >
      <List>
        {EXAMPLE_SCENARIOS.map((example) => (
          <Row key={example.key} onClick={() => handleSelect(example)}>
            <Label>{example.label}</Label>
            <Description>{example.description}</Description>
          </Row>
        ))}
      </List>
    </Dialog>
  );
};

export default ExamplePickerDialog;
