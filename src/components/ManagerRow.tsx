import React from 'react';
import styled from 'styled-components';
import { spacing, colors, border, fontSize } from '../styles/theme';

export const RightAmount = styled.div`
  font-size: ${fontSize.base};
  font-weight: 600;
  color: ${colors.textPrimary};
  text-align: right;
`;

export const RightLabel = styled.div`
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
  text-align: right;
`;

export interface ManagerRowProps {
  icon: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  name: string;
  secondary: React.ReactNode;
  badge?: React.ReactNode;
  right?: React.ReactNode;
  onEdit: () => void;
}

const Slat = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: ${spacing.sm} ${spacing.md};
  border-bottom: ${border.standard};
  cursor: pointer;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: ${colors.activeRow};
  }
`;

const Left = styled.div`
  display: flex;
  align-items: flex-start;
  gap: ${spacing.sm};
  flex: 1;
  min-width: 0;
`;

const IconCircle = styled.span<{ $bg: string; $color: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: ${border.radiusCircle};
  background: ${({ $bg }) => $bg};
  color: ${({ $color }) => $color};
  font-size: ${fontSize.md};
  flex-shrink: 0;
  font-weight: bold;
`;

const InfoBlock = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const NameLine = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.xs};
  font-weight: 600;
  font-size: ${fontSize.base};
`;

const SecondaryLine = styled.div`
  font-size: ${fontSize.sm};
  color: ${colors.textSecondary};
`;

const RightBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
  margin-left: ${spacing.sm};
`;

export const ManagerRow: React.FC<ManagerRowProps> = ({
  icon,
  iconBg = colors.bgMedium,
  iconColor = colors.primary,
  name,
  secondary,
  badge,
  right,
  onEdit,
}) => (
  <Slat onClick={onEdit}>
    <Left>
      <IconCircle $bg={iconBg} $color={iconColor}>
        {icon}
      </IconCircle>
      <InfoBlock>
        <NameLine>
          {name}
          {badge}
        </NameLine>
        <SecondaryLine>{secondary}</SecondaryLine>
      </InfoBlock>
    </Left>
    {right && <RightBlock>{right}</RightBlock>}
  </Slat>
);

/** Bleeds the slat list to the edges of the ManagerSection panel (negates its padding). */
export const SlatList = styled.div`
  margin: 0 -${spacing.md};
  border-top: ${border.standard};
  border-bottom: ${border.standard};
`;

/** Shared header bar for manager panels. */
export const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: -0.1rem;
  margin-bottom: ${spacing.xs};
`;

/** Left column of a manager header — stacks title and optional subtitle. */
export const HeaderLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;

  h3 {
    margin: 0;
  }
`;

/** Circular green plus button for manager panel headers. */
export const PlusButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: ${border.radiusCircle};
  cursor: pointer;
  background: ${colors.primary};
  color: white;
  font-size: ${fontSize.lg};
  margin-bottom: ${spacing.xs};

  &:hover {
    background: ${colors.primaryHover};
  }
`;

/** Right column of a manager header — stacks plus button and optional amount/label. */
export const HeaderRight = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: ${spacing.xs};
`;
