import { useState } from 'react'
import styled from 'styled-components'

interface SidebarContainerProps {
  $isCollapsed: boolean
}

const SidebarContainer = styled.aside<SidebarContainerProps>`
  width: ${props => props.$isCollapsed ? '50px' : '300px'};
  background-color: #f5f5f5;
  border-right: 1px solid #ddd;
  transition: width 0.3s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const ToggleButton = styled.button`
  padding: 0.75rem;
  background-color: #007bff;
  color: white;
  border: none;
  cursor: pointer;
  font-size: 1.2rem;
  transition: background-color 0.2s;

  &:hover {
    background-color: #0056b3;
  }
`

const SidebarContent = styled.div<SidebarContainerProps>`
  padding: ${props => props.$isCollapsed ? '0' : '1rem'};
  opacity: ${props => props.$isCollapsed ? '0' : '1'};
  transition: opacity 0.3s ease;
  overflow-y: auto;
`

const Sidebar: React.FC = () => {
  const [isCollapsed, setIsCollapsed] = useState(false)

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed)
  }

  return (
    <SidebarContainer $isCollapsed={isCollapsed}>
      <ToggleButton onClick={toggleSidebar}>
        {isCollapsed ? '▶' : '◀'}
      </ToggleButton>
      <SidebarContent $isCollapsed={isCollapsed}>
        <h3>Sidebar</h3>
        <p>This is the collapsible sidebar content.</p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
          <li>Item 3</li>
        </ul>
      </SidebarContent>
    </SidebarContainer>
  )
}

export default Sidebar
