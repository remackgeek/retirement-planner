import React from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { spacing, colors, dialogWidth } from '../styles/theme';
import { MarkdownBody } from './MarkdownBody';

const Body = styled(MarkdownBody)`
  max-height: 70vh;
  overflow-y: auto;
  padding: ${spacing.sm} 0;

  h2:first-child {
    margin-top: 0;
  }
`;

interface Props {
  visible: boolean;
  content: string;
  onHide: () => void;
}

const ChangelogDialog: React.FC<Props> = ({ visible, content, onHide }) => {
  const footer = (
    <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
      <Button
        label="Close"
        icon="pi pi-times"
        className="p-button-sm"
        onClick={onHide}
      />
    </div>
  );

  return (
    <Dialog
      header={
        <>
          <i className="pi pi-list" style={{ marginRight: spacing.sm, color: colors.primary }} />
          Changelog
        </>
      }
      visible={visible}
      style={dialogWidth('32rem')}
      onHide={onHide}
      footer={footer}
    >
      <Body>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </Body>
    </Dialog>
  );
};

export default ChangelogDialog;
