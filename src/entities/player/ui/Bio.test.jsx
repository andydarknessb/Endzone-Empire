import React from 'react';
import { render, screen } from '@testing-library/react';
import Bio from './Bio';

test('renders nothing when bio is null (no producer exists yet)', () => {
  const { container } = render(<Bio bio={null} />);
  expect(container).toBeEmptyDOMElement();
});

test('renders only the fields present', () => {
  render(<Bio bio={{ age: 27, college: 'Wyoming' }} />);
  const tile = screen.getByTestId('decision-card-bio');
  expect(tile).toHaveTextContent('Age: 27');
  expect(tile).toHaveTextContent('College: Wyoming');
  expect(tile).not.toHaveTextContent('Height');
});
