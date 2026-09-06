import React from 'react';
import { render, screen } from '@testing-library/react';
import { InjuryTag } from './index';
import { injuryView } from './InjuryTag';

test.each([
  ['Q', 'Questionable', 'warning'],
  ['D', 'Doubtful', 'warning'],
  ['O', 'Out', 'danger'],
  ['IR', 'Injured reserve', 'danger'],
])('%s renders the code with "%s" as its accessible text on the %s tint', (status, name, variant) => {
  render(<InjuryTag status={status} />);
  const tag = screen.getByTestId('injury-tag');
  expect(tag).toHaveAttribute('data-status', status);
  expect(tag).toHaveAttribute('data-variant', variant);
  // The visible code (what the legacy suite read as the badge) and the spoken
  // designation both reach the DOM; the code alone is hidden from a reader.
  expect(screen.getByText(status)).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByText(`Injury status: ${name}`)).toBeInTheDocument();
  // Announced once (#903 review): no `title`, which would double as the
  // accessible description and repeat the designation. Red-tell: restoring
  // `title={view.name}` on the Badge turns both assertions red.
  expect(tag).not.toHaveAttribute('title');
  expect(tag).not.toHaveAccessibleDescription();
});

test('renders nothing for a healthy player or a code the wire does not speak', () => {
  const { rerender } = render(<InjuryTag status={null} />);
  expect(screen.queryByTestId('injury-tag')).not.toBeInTheDocument();
  rerender(<InjuryTag status="" />);
  expect(screen.queryByTestId('injury-tag')).not.toBeInTheDocument();
  rerender(<InjuryTag status="PUP" />);
  expect(screen.queryByTestId('injury-tag')).not.toBeInTheDocument();
});

test('injuryView reads a lowercase or padded code and refuses an unknown one', () => {
  expect(injuryView(' q ')).toEqual({ code: 'Q', name: 'Questionable', variant: 'warning' });
  expect(injuryView('ir')).toEqual({ code: 'IR', name: 'Injured reserve', variant: 'danger' });
  expect(injuryView('SUS')).toBeNull();
  expect(injuryView(undefined)).toBeNull();
});
