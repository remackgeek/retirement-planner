import React from 'react';
import styled from 'styled-components';

const HeaderContainer = styled.header`
  padding: 1rem;
  background-color: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
  font-weight: bold;
  font-size: 1.2rem;
`;

const AppHeader: React.FC = () => {
  return <HeaderContainer>Retirement Planner MVP</HeaderContainer>;
};

export default AppHeader;
