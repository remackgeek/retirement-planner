import styled from 'styled-components'

const ContentContainer = styled.main`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
`

const Content: React.FC = () => {
  return (
    <ContentContainer>
      <h1>hello world!</h1>
    </ContentContainer>
  )
}

export default Content
