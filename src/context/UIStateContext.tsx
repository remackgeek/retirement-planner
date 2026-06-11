/* eslint-disable react-refresh/only-export-components --
   Context object + provider + hook in one file is idiomatic React; splitting
   them across files for HMR-only benefit isn't worth the importer churn. */
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { DisplayCurrency } from '../utils/displayCurrency';

interface UIStateValue {
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (c: DisplayCurrency) => void;
}

export const UIStateContext = createContext<UIStateValue | null>(null);

export const UIStateProvider = ({ children }: { children: ReactNode }) => {
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('real');
  return (
    <UIStateContext.Provider value={{ displayCurrency, setDisplayCurrency }}>
      {children}
    </UIStateContext.Provider>
  );
};

export const useUIState = (): UIStateValue => {
  const ctx = useContext(UIStateContext);
  if (!ctx) throw new Error('useUIState must be used within UIStateProvider');
  return ctx;
};
