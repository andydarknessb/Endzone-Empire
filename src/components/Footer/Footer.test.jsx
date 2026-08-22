import React from 'react';
import { render, screen } from '@testing-library/react';
import Footer from './Footer';

test('renders the copyright footer text inside a <footer> element', () => {
  render(<Footer />);
  const footer = screen.getByRole('contentinfo');
  expect(footer.tagName).toBe('FOOTER');
  expect(footer).toHaveTextContent('© Endzone Empire');
});
