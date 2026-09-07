import React from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { spacing, colors, dialogWidth } from '../styles/theme';
import { MarkdownBody } from './MarkdownBody';
import type { ChangelogRelease } from '../utils/changelog';

const Body = styled(MarkdownBody)`
  max-height: 60vh;
  overflow-y: auto;
  padding: ${spacing.sm} 0;

  h2:first-child {
    margin-top: 0;
  }
`;

interface Props {
  visible: boolean;
  releases: ChangelogRelease[];
  onHide: () => void;
  onViewFullChangelog: () => void;
}

function releasesToMarkdown(releases: ChangelogRelease[]): string {
  return releases
    .map((r) => `${r.heading}\n\n${r.body}`)
    .join('\n\n');
}

const WhatsNewDialog: React.FC<Props> = ({
  visible,
  releases,
  onHide,
  onViewFullChangelog,
}) => {
  const title =
    releases.length === 1
      ? `What's New in v${releases[0].version}`
      : "What's New";

  const footer = (
    <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
      <Button
        label="Full changelog"
        icon="pi pi-list"
        className="p-button-text p-button-sm"
        onClick={onViewFullChangelog}
      />
      <Button
        label="Got it"
        icon="pi pi-check"
        className="p-button-sm"
        onClick={onHide}
      />
    </div>
  );

  return (
    <Dialog
      header={
        <>
          <i className="pi pi-sparkles" style={{ marginRight: spacing.sm, color: colors.primary }} />
          {title}
        </>
      }
      visible={visible}
      style={dialogWidth('32rem')}
      onHide={onHide}
      footer={footer}
    >
      <Body>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {releasesToMarkdown(releases)}
        </ReactMarkdown>
      </Body>
    </Dialog>
  );
};

export default WhatsNewDialog;
