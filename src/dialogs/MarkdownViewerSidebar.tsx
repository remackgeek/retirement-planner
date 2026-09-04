import styled from 'styled-components';
import { Sidebar } from 'primereact/sidebar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { spacing, colors, fontSize, dialogWidth } from '../styles/theme';
import { MarkdownBody } from './MarkdownBody';
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

const Body = styled(MarkdownBody)`
  overflow-y: auto;
  height: 100%;
  padding: ${spacing.lg} ${spacing.xl};
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
