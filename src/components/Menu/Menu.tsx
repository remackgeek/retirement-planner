import React, { useRef } from 'react';
import { Menubar } from 'primereact/menubar';
import type { MenuItem } from 'primereact/menuitem';
import { Menu } from 'primereact/menu';
import { Button } from 'primereact/button';

const MenuComponent: React.FC = () => {
  const personMenuRef = useRef<Menu>(null);

  const personMenuItems: MenuItem[] = [
    {
      label: 'Profile',
      icon: 'pi pi-user',
      command: () => console.log('Profile clicked'),
    },
    {
      label: 'Settings',
      icon: 'pi pi-cog',
      command: () => console.log('Settings clicked'),
    },
    {
      separator: true,
    },
    {
      label: 'Logout',
      icon: 'pi pi-sign-out',
      command: () => console.log('Logout clicked'),
    },
  ];

  const showPersonMenu = (event: React.MouseEvent) => {
    personMenuRef.current?.show(event);
  };

  return (
    <>
      <Menubar
        start={<div style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Retirement Planner MVP</div>}
        end={
          <Button
            icon="pi pi-user"
            onClick={showPersonMenu}
            text
            rounded
          />
        }
      />
      <Menu
        ref={personMenuRef}
        model={personMenuItems}
        popup
        popupAlignment="right"
      />
    </>
  );
};

export default MenuComponent;
