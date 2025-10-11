import { render, screen, fireEvent } from '@testing-library/react';
import Menu from './Menu';

describe('Menu', () => {
  it('renders the menu bar', () => {
    render(<Menu />);
    expect(screen.getByRole('menubar')).toBeInTheDocument();
  });

  it('opens the about dialog when About is clicked', () => {
    render(<Menu />);
    const helpMenu = screen.getByText('Help');
    fireEvent.click(helpMenu);
    const aboutItem = screen.getByText('About');
    fireEvent.click(aboutItem);
    expect(screen.getByText('About This Application')).toBeInTheDocument();
  });
});
