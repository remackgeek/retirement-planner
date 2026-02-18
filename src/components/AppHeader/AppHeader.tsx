import React from 'react';
import styled from 'styled-components';
import { spacing, colors, fontSize } from '../../styles/theme';

const HeaderContainer = styled.header`
  padding: ${spacing.sm} ${spacing.lg};
  background-color: ${colors.bgLight};
  border-bottom: 1px solid #e9ecef;
  font-weight: bold;
  font-size: ${fontSize.xl};
`;

const AppHeader: React.FC = () => {
  return <HeaderContainer>Retirement Planner MVP</HeaderContainer>;
};

export default AppHeader;
