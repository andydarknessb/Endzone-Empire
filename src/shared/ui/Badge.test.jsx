import React from 'react';
import { render, screen } from '@testing-library/react';
import { Badge } from './index';

test('renders its label text', () => {
  render(<Badge>Draft Complete</Badge>);
  expect(screen.getByText('Draft Complete')).toBeInTheDocument();
});

test('defaults to the neutral variant', () => {
  render(<Badge>12 Teams</Badge>);
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'neutral');
  expect(badge).toHaveTextContent('12 Teams');
});

test('exposes the live variant', () => {
  render(<Badge variant="live">Week 1 · Regular Season</Badge>);
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'live');
  expect(badge).toHaveTextContent('Week 1 · Regular Season');
});

test('exposes the "You" pill variant with its distinct type', () => {
  render(<Badge variant="you">You</Badge>);
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'you');
  expect(badge).toHaveTextContent('You');
  // The "You" pill's distinguishing type (mockup `.you`): if it silently
  // returned to the `live` look this fails.
  expect(badge.style.fontSize).toBe('10.5px');
  expect(badge.style.fontWeight).toBe('700');
  expect(badge.style.letterSpacing).toBe('0.08em');
});

test('exposes the danger variant (the scoring strip Live pill, #895)', () => {
  render(<Badge variant="danger">Live</Badge>);
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'danger');
  expect(badge).toHaveTextContent('Live');
  // Base chip type, like `live`: only `you` carries the smaller pill type.
  expect(badge.style.fontSize).toBe('');
});

test('exposes the warning variant (the injury tag\'s may-not-play tone, #903)', () => {
  render(<Badge variant="warning">Q</Badge>);
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'warning');
  expect(badge).toHaveTextContent('Q');
  expect(badge.style.fontSize).toBe('');
});

// The chip's paint is an sx rule, which jsdom neither computes (getComputedStyle
// reads back '' for a `var()` color, so a toHaveStyle on it proves nothing)
// nor prints into the <style> text (emotion uses insertRule), but
// `document.styleSheets` carries the rule under the generated class name.
// This reads that one rule's declarations back.
const ruleFor = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  let text = '';
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (rule.selectorText === `.${cls}`) text += `${rule.style.cssText};`;
    });
  });
  return text;
};

// Red-tell (#897): removing the `success` entry from VARIANT_SX keeps the
// `data-variant` stamp (Badge stamps the prop as given) but paints the chip
// neutral (dim on surface2), so the rule assertions are what turn this red.
test('exposes the success variant (the Final status chip, #897)', () => {
  render(<Badge variant="success">Final</Badge>);
  const badge = screen.getByTestId('badge');
  expect(badge).toHaveAttribute('data-variant', 'success');
  expect(badge).toHaveTextContent('Final');
  const rule = ruleFor(badge);
  expect(rule).toContain('color: var(--dash-away)');
  expect(rule).toContain('background-color: var(--dash-away-soft)');
  expect(rule).toContain('border: 1px solid var(--dash-away)');
  expect(badge.style.fontSize).toBe('');
});

test('the live variant does not carry the "You" pill type', () => {
  render(<Badge variant="live">Live</Badge>);
  expect(screen.getByTestId('badge').style.fontSize).toBe('');
});
