import React from 'react';
import styled from 'styled-components';
import { spacing, colors, border, fontSize, layout } from '../styles/theme';

export interface ManagerRowProps {
  icon: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  name: string;
  secondary: React.ReactNode;
  badge?: React.ReactNode;
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

export const ManagerRow: React.FC<ManagerRowProps> = ({
  icon,
  iconBg = colors.bgMedium,
  iconColor = colors.primary,
  name,
  secondary,
  badge,
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
  </Slat>
);

/** Bleeds the slat list to the edges of the ManagerSection panel (negates its padding). */
export const SlatList = styled.div`
  margin: 0 -${spacing.md};
  border-top: ${border.standard};
  border-bottom: ${border.standard};
`;

/** Shared header bar for manager panels — enforces uniform height across all three. */
export const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: ${spacing.md};
  min-height: ${layout.managerHeaderHeight};
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

/** Large green Add button for manager panel headers. */
export const AddButton = styled.button`
  padding: ${spacing.sm} ${spacing.lg};
  border: none;
  border-radius: ${border.radius};
  cursor: pointer;
  background: ${colors.primary};
  color: white;
  font-size: ${fontSize.xl};

  &:hover {
    background: ${colors.primaryHover};
  }
`;
