import { useContext } from 'react';
import styled from 'styled-components';
import { spacing, colors, fontSize } from '../../styles/theme';
import { RetirementContext } from '../../context/RetirementContext';

const HeaderContainer = styled.header`
  display: flex;
  align-items: center;
  padding: ${spacing.sm} ${spacing.lg};
  background-color: ${colors.bgLight};
  border-bottom: 1px solid #e9ecef;
`;

const HeaderLeft = styled.div`
  flex: 1;
  font-weight: bold;
  font-size: ${fontSize.xl};
`;

const HeaderCenter = styled.div`
  flex: 1;
  text-align: center;
  font-weight: normal;
  font-size: ${fontSize.base};
  color: ${colors.textSecondary};
`;

const HeaderRight = styled.div`
  flex: 1;
`;

const AppHeader: React.FC = () => {
  const context = useContext(RetirementContext);
  const scenarioName = context?.activeScenario?.name;

  return (
    <HeaderContainer>
      <HeaderLeft>Retirement Planner MVP</HeaderLeft>
      <HeaderCenter>{scenarioName ?? ''}</HeaderCenter>
      <HeaderRight />
    </HeaderContainer>
  );
};

export default AppHeader;
