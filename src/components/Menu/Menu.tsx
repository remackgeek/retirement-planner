import React, { useState } from 'react';
import { Menubar } from 'primereact/menubar';
import type { MenuItem } from 'primereact/menuitem';
import { Dialog } from 'primereact/dialog';

const Menu: React.FC = () => {
  const [aboutVisible, setAboutVisible] = useState(false);

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

  return (
    <>
      <Menubar model={items} />
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

export default Menu;
