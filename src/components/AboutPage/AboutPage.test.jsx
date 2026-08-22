import React from 'react';
import { render, screen } from '@testing-library/react';
import AboutPage from './AboutPage';

test('renders the about page copy', () => {
  render(<AboutPage />);
  expect(screen.getByText('This about page is for anyone to read!')).toBeInTheDocument();
});
