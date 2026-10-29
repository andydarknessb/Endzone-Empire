import React from 'react';
import { render, screen } from '@testing-library/react';
import PlayerAvatar from './PlayerAvatar';

// emotion inserts each sx rule into document.styleSheets under the generated class; read an element's own rules back.
const own = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  let text = '';
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (rule.selectorText && rule.selectorText.startsWith(`.${cls}`)) text += `${rule.style.cssText};`;
    });
  });
  return text;
};

const avatar = () => screen.getByText('PN');

test('the headshot loads lazily (#2638)', () => {
  render(<PlayerAvatar name="Puka Nacua" photoUrl="https://example.com/puka.png" />);
  expect(screen.getByRole('img', { hidden: true })).toHaveAttribute('loading', 'lazy');
});

test('it is a neutral square on ps tokens with no position colour', () => {
  render(<PlayerAvatar name="Puka Nacua" size={56} />);
  const el = avatar();
  expect(el).toHaveTextContent('PN');
  expect(el).toHaveClass('MuiAvatar-square');
  const css = own(el);
  expect(css).toMatch(/--ps-ink/);
  expect(css).toMatch(/--ps-panel/);
  expect(css).not.toMatch(/--pos-|--dash-|#/);
});
