import { useContext, useState, useEffect } from 'react';
import styled from 'styled-components';
import { RetirementContext } from '../../context/RetirementContext';
import { Button } from 'primereact/button';
import { runSimulation } from '../../services/SimulationService';
import ScenarioDialog from '../../dialogs/ScenarioDialog';
import Projections from '../Chart/Chart';
import type { Scenario } from '../../types/Scenario';

const ContentContainer = styled.main`
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
`;



const Content: React.FC = () => {
  const context = useContext(RetirementContext);
  if (!context) return null;
  const { activeScenario, addScenario } = context;
  const [dialogVisible, setDialogVisible] = useState(false);
  const [results, setResults] = useState<any>(null);

  useEffect(() => {
    if (activeScenario) {
      setResults(runSimulation(activeScenario));
    }
  }, [activeScenario]);

  const handleSave = (scenario: Scenario) => {
    addScenario(scenario);
    setDialogVisible(false);
  };

  return (
    <ContentContainer>
      <Button label="New Scenario" onClick={() => setDialogVisible(true)} />
      {results && <Projections results={results} userData={activeScenario} />}
      <ScenarioDialog 
        visible={dialogVisible} 
        onHide={() => setDialogVisible(false)} 
        onSave={handleSave}
      />
    </ContentContainer>
  );
};

export default Content;
