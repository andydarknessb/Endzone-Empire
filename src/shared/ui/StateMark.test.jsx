import React from 'react';
import { render, screen } from '@testing-library/react';
import StateMark from './StateMark';

test.each([
  ['live', 'In progress'],
  ['final', 'Final'],
  ['scheduled', 'Yet to play'],
])('a %s view is a labelled image named "%s"', (kind, label) => {
  render(<StateMark view={{ kind, label }} />);
  expect(screen.getByRole('img', { name: label })).toHaveAttribute('data-testid', `state-${kind}`);
});

test('the live state paints the danger dot, the others an icon', () => {
  const { rerender } = render(<StateMark view={{ kind: 'live', label: 'In progress' }} />);
  expect(screen.getByTestId('live-dot')).toHaveAttribute('data-tone', 'danger');
  rerender(<StateMark view={{ kind: 'final', label: 'Final' }} />);
  expect(screen.queryByTestId('live-dot')).toBeNull();
  expect(screen.getByTestId('state-final')).not.toBeEmptyDOMElement();
});

test('the live dot is a square on the Play-select danger ink (the Square Rule)', () => {
  render(<StateMark view={{ kind: 'live', label: 'In progress' }} />);
  const dot = screen.getByTestId('live-dot');
  expect(dot).toHaveStyle({ borderRadius: '0' });
  /* eslint-disable testing-library/no-node-access -- emotion's rule for the dot is only reachable through its class */
  // jsdom drops a var() color from computed style, so read the rule emotion injected for the dot's class.
  const emotionClass = [...dot.classList].find((c) => c.startsWith('css-'));
  const rule = [...document.querySelectorAll('style')]
    .flatMap((el) => [...(el.sheet?.cssRules ?? [])])
    .find((r) => r.selectorText === `.${emotionClass}`);
  expect(rule.cssText).toContain('var(--ps-danger)');
  /* eslint-enable testing-library/no-node-access */
});

test('an unknown state renders nothing', () => {
  const { container } = render(<StateMark view={null} />);
  expect(container).toBeEmptyDOMElement();
});
