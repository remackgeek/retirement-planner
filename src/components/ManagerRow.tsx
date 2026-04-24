import React from 'react';
import styled from 'styled-components';
import { spacing, colors, border, fontSize } from '../styles/theme';

export interface ManagerRowProps {
  icon: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  name: string;
  secondary: React.ReactNode;
  badge?: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
}

const Slat = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: ${spacing.sm} ${spacing.md};
  border-bottom: ${border.standard};

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: ${colors.bgMedium};
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

const Right = styled.div`
  display: flex;
  gap: ${spacing.xs};
  flex-shrink: 0;
  margin-left: ${spacing.sm};
  align-self: flex-start;
`;

const ActionBtn = styled.button`
  padding: ${spacing.xs} ${spacing.sm};
  border: none;
  border-radius: ${border.radius};
  cursor: pointer;
  background: ${colors.primary};
  color: white;
  font-size: ${fontSize.sm};

  &:hover {
    background: ${colors.primaryHover};
  }
`;

const DeleteBtn = styled(ActionBtn)`
  background: ${colors.danger};

  &:hover {
    background: ${colors.dangerHover};
  }
`;

export const ManagerRow: React.FC<ManagerRowProps> = ({
  icon,
  iconBg = colors.bgMedium,
  iconColor = colors.primary,
  name,
  secondary,
  badge,
  onEdit,
  onDelete,
}) => (
  <Slat>
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
    <Right>
      <ActionBtn onClick={onEdit}>Edit</ActionBtn>
      <DeleteBtn onClick={onDelete}>Delete</DeleteBtn>
    </Right>
  </Slat>
);

/** Bleeds the slat list to the edges of the ManagerSection panel (negates its padding). */
export const SlatList = styled.div`
  margin: 0 -${spacing.md};
  border-top: ${border.standard};
  border-bottom: ${border.standard};
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
