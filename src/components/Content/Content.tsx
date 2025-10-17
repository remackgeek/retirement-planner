import { useContext, useState, useEffect } from 'react';
import styled from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { runSimulation } from '../../services/SimulationService';
import Projections from '../Chart/Chart';

const ContentContainer = styled.main`
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
`;



const Content: React.FC = () => {
  const context = useContext(RetirementContext);
  if (!context) return null;
  const { activeScenario } = context;
  const [results, setResults] = useState<any>(null);

  useEffect(() => {
    if (activeScenario) {
      setResults(runSimulation(activeScenario));
    }
  }, [activeScenario]);

  return (
    <ContentContainer>
      {results && <Projections results={results} userData={activeScenario} />}
    </ContentContainer>
  );
};

export default Content;
