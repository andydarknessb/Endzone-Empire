import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { CelebrationsCaption } from '../index';

// Red-tell (#903 review): rendering one fixed line regardless of `enabled`
// turns the off case red; dropping the glyph swap turns the icon assertions
// red.
test('reads Celebrations on with the bolt when enabled, Celebrations off with the lock when not', () => {
  const { rerender } = render(<CelebrationsCaption enabled />);
  const caption = screen.getByTestId('celebrations-caption');
  expect(caption).toHaveTextContent('Celebrations on');
  expect(caption).toHaveAttribute('data-enabled', 'true');
  expect(within(caption).getByTestId('celebrations-glyph')).toHaveAttribute('data-icon', 'bolt');
  expect(within(caption).getByTestId('celebrations-glyph')).toHaveAttribute('aria-hidden', 'true');

  rerender(<CelebrationsCaption enabled={false} />);
  const off = screen.getByTestId('celebrations-caption');
  expect(off).toHaveTextContent('Celebrations off');
  expect(off).toHaveAttribute('data-enabled', 'false');
  expect(within(off).getByTestId('celebrations-glyph')).toHaveAttribute('data-icon', 'lock');
});

test('is read-only: no control, no button', () => {
  render(<CelebrationsCaption enabled />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
