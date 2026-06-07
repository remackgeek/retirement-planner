import { Component, type ErrorInfo, type ReactNode } from 'react';
import styled from 'styled-components';
import { spacing, colors, fontSize, border } from '../../styles/theme';

const ISSUES_URL = 'https://github.com/remackgeek/retirement-planner/issues';

const Overlay = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: ${spacing.lg};
  background-color: ${colors.bgLight};
`;

const Panel = styled.div`
  max-width: 36rem;
  width: 100%;
  background-color: ${colors.bgMedium};
  border: ${border.standard};
  border-radius: ${border.radiusRound};
  padding: ${spacing.lg};
  box-shadow: 0 2px 8px ${colors.shadowLight};
`;

const Title = styled.h2`
  margin: 0 0 ${spacing.sm};
  font-size: ${fontSize.lg};
  color: ${colors.textPrimary};
`;

const Lead = styled.p`
  margin: 0 0 ${spacing.md};
  font-size: ${fontSize.base};
  line-height: 1.5;
  color: ${colors.textSecondary};
`;

const Report = styled.pre`
  margin: 0 0 ${spacing.md};
  padding: ${spacing.sm};
  max-height: 12rem;
  overflow: auto;
  background-color: ${colors.bgLight};
  border: ${border.light};
  border-radius: ${border.radius};
  font-size: ${fontSize.xs};
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${colors.textPrimary};
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
  align-items: center;
`;

const Btn = styled.button`
  padding: ${spacing.xs} ${spacing.md};
  font-size: ${fontSize.sm};
  border: ${border.standard};
  border-radius: ${border.radius};
  background-color: ${colors.primary};
  color: #fff;
  cursor: pointer;
  &:hover { opacity: 0.9; }
`;

const BtnSecondary = styled(Btn)`
  background-color: ${colors.bgMedium};
  color: ${colors.textPrimary};
`;

const IssueLink = styled.a`
  font-size: ${fontSize.sm};
  color: ${colors.primary};
  &:hover { text-decoration: underline; }
`;

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches render-time exceptions so a single bad
 * component can't white-screen the whole app. The fallback is **local-only** —
 * it builds a copyable crash report (message + stack + build metadata) and links
 * to GitHub issues, but makes no network calls, honoring YARP's no-tracking
 * promise. Errors are also logged to the console for users who have devtools open.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error caught by ErrorBoundary:', error, info);
  }

  private buildReport(): string {
    const { error } = this.state;
    const dirtyPart = import.meta.env.DEV
      ? ' (dev build)'
      : __GIT_DIRTY__
        ? ' (dirty)'
        : '';
    return [
      `YARP v${__APP_VERSION__} — crash report`,
      `Commit: ${__GIT_COMMIT__}${dirtyPart} (${__GIT_BRANCH__})`,
      `Built: ${__BUILD_TIME__}`,
      `When: ${new Date().toISOString()}`,
      '',
      `Error: ${error?.message ?? 'unknown'}`,
      '',
      error?.stack ?? '(no stack trace)',
    ].join('\n');
  }

  private handleCopy = (): void => {
    navigator.clipboard.writeText(this.buildReport()).catch(() => {
      /* clipboard unavailable — silently ignore */
    });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <Overlay>
        <Panel role="alert">
          <Title>Something went wrong</Title>
          <Lead>
            YARP hit an unexpected error and couldn't continue. Your saved scenarios are
            stored locally and are unaffected. Try reloading — if it keeps happening, copy
            the report below and open an issue so it can be fixed.
          </Lead>
          <Report>{this.buildReport()}</Report>
          <Actions>
            <Btn onClick={() => window.location.reload()}>Reload</Btn>
            <BtnSecondary onClick={this.handleCopy}>Copy report</BtnSecondary>
            <IssueLink href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
              Open a GitHub issue
            </IssueLink>
          </Actions>
        </Panel>
      </Overlay>
    );
  }
}

export default ErrorBoundary;
