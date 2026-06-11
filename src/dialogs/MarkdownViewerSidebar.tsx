import styled from 'styled-components';
import { Sidebar } from 'primereact/sidebar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { spacing, colors, fontSize, border, dialogWidth } from '../styles/theme';
import yarpIcon from '../assets/YARP.ico';

interface Props {
  title: string;
  icon: string;
  content: string;
  visible: boolean;
  onHide: () => void;
  showLogo?: boolean;
}

const SidebarHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  font-size: ${fontSize.md};
  font-weight: 600;
  color: ${colors.textPrimary};

  i {
    color: ${colors.primary};
    font-size: ${fontSize.lg};
  }
`;

const Body = styled.div`
  overflow-y: auto;
  height: 100%;
  padding: ${spacing.lg} ${spacing.xl};
  color: ${colors.textPrimary};
  font-size: ${fontSize.base};
  line-height: 1.6;

  h1 {
    font-size: ${fontSize.xl};
    font-weight: 700;
    margin: 0 0 ${spacing.sm};
    color: ${colors.textPrimary};
    border-bottom: ${border.light};
    padding-bottom: ${spacing.xs};
  }

  h2 {
    font-size: ${fontSize.lg};
    font-weight: 600;
    margin: ${spacing.xl} 0 ${spacing.xs};
    color: ${colors.textPrimary};
  }

  h3 {
    font-size: ${fontSize.md};
    font-weight: 600;
    margin: ${spacing.lg} 0 ${spacing.xs};
    color: ${colors.textSecondary};
  }

  p {
    margin: 0 0 ${spacing.md};
  }

  ul, ol {
    margin: 0 0 ${spacing.md};
    padding-left: 1.4em;
  }

  li {
    margin-bottom: ${spacing.xs};
  }

  blockquote {
    margin: 0 0 ${spacing.md};
    padding: ${spacing.xs} ${spacing.md};
    border-left: 3px solid ${colors.primary};
    color: ${colors.textSecondary};
    background: ${colors.bgMedium};
    border-radius: 0 ${border.radius} ${border.radius} 0;
  }

  blockquote p {
    margin: 0;
  }

  code {
    font-family: 'Consolas', 'Menlo', monospace;
    font-size: ${fontSize.sm};
    background: ${colors.bgMedium};
    border: ${border.light};
    border-radius: ${border.radius};
    padding: 0.1em 0.35em;
    color: ${colors.textPrimary};
  }

  pre {
    background: ${colors.bgMedium};
    border: ${border.light};
    border-radius: ${border.radius};
    padding: ${spacing.md};
    overflow-x: auto;
    margin: 0 0 ${spacing.md};
  }

  pre code {
    background: none;
    border: none;
    padding: 0;
    font-size: ${fontSize.sm};
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 ${spacing.md};
    font-size: ${fontSize.sm};
  }

  th {
    background: ${colors.bgMedium};
    font-weight: 600;
    text-align: left;
    padding: ${spacing.xs} ${spacing.sm};
    border: ${border.standard};
    color: ${colors.textSecondary};
  }

  td {
    padding: ${spacing.xs} ${spacing.sm};
    border: ${border.standard};
    vertical-align: top;
  }

  hr {
    border: none;
    border-top: ${border.light};
    margin: ${spacing.lg} 0;
  }

  a {
    color: ${colors.primary};
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  strong {
    font-weight: 600;
    color: ${colors.textPrimary};
  }
`;

const MarkdownViewerSidebar: React.FC<Props> = ({ title, icon, content, visible, onHide, showLogo }) => {
  const header = (
    <SidebarHeader>
      {showLogo
        ? <img src={yarpIcon} alt="YARP" style={{ width: '1.4rem', height: '1.4rem' }} />
        : <i className={icon} />}
      {title}
    </SidebarHeader>
  );

  return (
    <Sidebar
      header={header}
      visible={visible}
      onHide={onHide}
      position="right"
      modal={false}
      style={dialogWidth('44rem')}
    >
      <Body>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>{content}</ReactMarkdown>
      </Body>
    </Sidebar>
  );
};

export default MarkdownViewerSidebar;
