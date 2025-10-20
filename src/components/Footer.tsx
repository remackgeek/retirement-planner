import styled from 'styled-components';

const FooterContainer = styled.footer`
  padding: 1rem;
  background-color: #f8f9fa;
  border-top: 1px solid #dee2e6;
  text-align: center;
  font-size: 0.875rem;
  color: #6c757d;
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
