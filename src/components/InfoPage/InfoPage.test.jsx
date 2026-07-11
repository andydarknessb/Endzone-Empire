import React from 'react';
import { render, screen } from '@testing-library/react';
import InfoPage from './InfoPage';

test('renders the info page text', () => {
  render(<InfoPage />);
  expect(screen.getByText('Info Page')).toBeInTheDocument();
});
