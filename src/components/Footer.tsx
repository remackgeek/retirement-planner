import styled from 'styled-components';
import { spacing, colors, fontSize } from '../styles/theme';

const FooterContainer = styled.footer`
  padding: 0.35rem ${spacing.lg};
  background-color: ${colors.bgLight};
  border-top: 1px solid ${colors.border};
  text-align: center;
  font-size: ${fontSize.sm};
  color: ${colors.textFooter};
  margin-top: auto;
`;

const Footer: React.FC = () => {
  return (
    <FooterContainer>
      <p>
        Disclaimer: This is a hypothetical projection and not financial advice.
      </p>
    </FooterContainer>
  );
};

export default Footer;
