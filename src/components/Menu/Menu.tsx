import React, { useState, useRef } from 'react';
import { Menubar } from 'primereact/menubar';
import type { MenuItem } from 'primereact/menuitem';
import { Dialog } from 'primereact/dialog';
import { Menu } from 'primereact/menu';
import { Button } from 'primereact/button';

const MenuComponent: React.FC = () => {
  const [aboutVisible, setAboutVisible] = useState(false);
  const personMenuRef = useRef<Menu>(null);

  const items: MenuItem[] = [
    {
      label: 'Help',
      items: [
        {
          label: 'About',
          command: () => setAboutVisible(true),
        },
      ],
    },
  ];

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
        model={items} 
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
      <Dialog
        header="About"
        visible={aboutVisible}
        onHide={() => setAboutVisible(false)}
        modal
      >
        <p>About This Application</p>
      </Dialog>
    </>
  );
};

export default MenuComponent;
