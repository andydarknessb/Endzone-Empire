import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InjuryBadge from './InjuryBadge';

test.each([
  ['Q'],
  ['D'],
  ['O'],
  ['IR'],
])('renders a chip for status %s', (status) => {
  render(<InjuryBadge status={status} />);
  expect(screen.getByText(status)).toBeInTheDocument();
});

test('renders nothing for a healthy player', () => {
  const { container } = render(<InjuryBadge status={null} />);
  expect(container).toBeEmptyDOMElement();
});

test('renders nothing for an unknown status', () => {
  const { container } = render(<InjuryBadge status="XYZ" />);
  expect(container).toBeEmptyDOMElement();
});

test('Questionable has an explicit accessible name and a readable legend', async () => {
  const user = userEvent.setup();
  render(<InjuryBadge status="Q" />);

  const badge = screen.getByLabelText('Injury status: questionable');
  await user.hover(badge);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Questionable');
});
