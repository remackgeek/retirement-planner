import React from 'react';
import styled from 'styled-components';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { spacing, colors, fontSize, border, dialogWidth } from '../styles/theme';

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  padding: ${spacing.sm} 0;
`;

const AppName = styled.div`
  font-size: ${fontSize.xl};
  font-weight: 700;
  color: ${colors.textPrimary};
  line-height: 1.2;
`;

const Version = styled.div`
  font-size: ${fontSize.lg};
  color: ${colors.primary};
  margin-top: -${spacing.xs};
`;

const MetaTable = styled.div`
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: ${spacing.xs} ${spacing.md};
  font-size: ${fontSize.sm};
  padding-top: ${spacing.sm};
  border-top: ${border.light};
`;

const MetaLabel = styled.span`
  color: ${colors.textSecondary};
  font-weight: 600;
`;

const MetaValue = styled.span`
  color: ${colors.textPrimary};
  font-family: monospace;
`;

const MetaLink = styled.a`
  color: ${colors.primary};
  font-family: monospace;
  font-size: inherit;
  text-decoration: none;
  &:hover { text-decoration: underline; }
  i { font-size: ${fontSize.xs}; color: ${colors.textMuted}; margin-left: 0.25em; vertical-align: middle; }
`;

const DirtyBadge = styled.span`
  color: ${colors.danger};
  margin-left: ${spacing.xs};
  font-family: sans-serif;
`;

function formatBuildTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    return `${date} ${time} UTC`;
  } catch {
    return iso;
  }
}

function buildClipboardText(): string {
  const isDev = import.meta.env.DEV;
  const dirtyPart = isDev ? ' (dev build)' : __GIT_DIRTY__ ? ' (dirty)' : '';
  return [
    `YARP v${__APP_VERSION__}`,
    `Website: https://yarp.bluewiz.net`,
    `Branch: ${__GIT_BRANCH__}`,
    `Commit: ${__GIT_COMMIT__}${dirtyPart}`,
    `Built: ${__BUILD_TIME__}`,
  ].join('\n');
}

interface AboutDialogProps {
  visible: boolean;
  onHide: () => void;
}

const AboutDialog: React.FC<AboutDialogProps> = ({ visible, onHide }) => {
  const isDev = import.meta.env.DEV;

  const handleCopy = () => {
    navigator.clipboard.writeText(buildClipboardText()).catch(() => {
      /* clipboard unavailable — silently ignore */
    });
  };

  const footer = (
    <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
      <Button
        label="Copy version info"
        icon="pi pi-copy"
        className="p-button-text p-button-sm"
        onClick={handleCopy}
      />
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
          <i className="pi pi-info-circle" style={{ marginRight: spacing.sm, color: colors.primary }} />
          About YARP
        </>
      }
      visible={visible}
      style={dialogWidth('22rem')}
      onHide={onHide}
      footer={footer}
    >
      <Content>
        <div>
          <AppName>YARP</AppName>
          <Version>v{__APP_VERSION__}</Version>
        </div>
        <MetaTable>
          <MetaLabel>Branch</MetaLabel>
          <MetaValue>{__GIT_BRANCH__}</MetaValue>

          <MetaLabel>Commit</MetaLabel>
          <MetaValue>
            {__GIT_COMMIT__}
            {isDev ? (
              <DirtyBadge>(dev build)</DirtyBadge>
            ) : __GIT_DIRTY__ ? (
              <DirtyBadge>(dirty)</DirtyBadge>
            ) : null}
          </MetaValue>

          <MetaLabel>Built</MetaLabel>
          <MetaValue>{formatBuildTime(__BUILD_TIME__)}</MetaValue>

          <MetaLabel>License</MetaLabel>
          <MetaValue>MIT</MetaValue>

          <MetaLabel>Website</MetaLabel>
          <MetaValue>
            <MetaLink href="https://yarp.bluewiz.net" target="_blank" rel="noopener noreferrer">
              yarp.bluewiz.net<i className="pi pi-external-link" />
            </MetaLink>
          </MetaValue>

          <MetaLabel>Repository</MetaLabel>
          <MetaValue>
            <MetaLink href="https://github.com/remackgeek/retirement-planner" target="_blank" rel="noopener noreferrer">
              github.com/remackgeek/retirement-planner<i className="pi pi-external-link" />
            </MetaLink>
          </MetaValue>

          <MetaLabel>Support</MetaLabel>
          <MetaValue>
            <MetaLink href="https://github.com/remackgeek/retirement-planner/issues" target="_blank" rel="noopener noreferrer">
              GitHub Issues<i className="pi pi-external-link" />
            </MetaLink>
          </MetaValue>
        </MetaTable>
      </Content>
    </Dialog>
  );
};

export default AboutDialog;
