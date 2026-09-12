import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link as RouterLink } from 'react-router-dom';
import DashButton from './DashButton';

// An sx rule is neither laid out nor computed by jsdom, but emotion inserts
// every rule it generates into `document.styleSheets` under the element's
// generated class. This gathers one element's declarations, keyed by the media
// condition they sit under (`''` for the unconditional rule), so a responsive
// `sx` object can be read back: MUI compiles `{ xs, md }` / `{ xs, sm }` into
// `@media (min-width:0px)`, `(min-width:600px)` and `(min-width:900px)`
// (matchup-preview's own MatchupPreview.test.jsx uses the same helper).
const rulesUnder = (el, media = '') => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  const norm = (value) => String(value).replace(/\s+/g, '');
  let found = '';
  const walk = (rules, condition) => {
    Array.from(rules).forEach((rule) => {
      if (rule.media) {
        walk(rule.cssRules || [], rule.media.mediaText || '');
        return;
      }
      if (rule.selectorText === `.${cls}` && norm(condition) === norm(media)) {
        found += `${rule.style.cssText};`;
      }
    });
  };
  Array.from(document.styleSheets).forEach((sheet) => walk(sheet.cssRules, ''));
  return found;
};

test('defaults to the primary variant and the md size', () => {
  render(<DashButton>Set lineup</DashButton>);
  const button = screen.getByTestId('dash-button');
  expect(button).toHaveAttribute('data-variant', 'primary');
  expect(button).toHaveAttribute('data-size', 'md');
});

// Red-tell: dropping the `transition` from the primary variant turns this red.
// The hover is a `filter`, which the app theme's MuiButton transition does not
// cover (AppThemeProvider), so the primary would snap instead of easing - the
// same red-tell matchup-preview's own T3 case binds through now that widget
// composes this component instead of its own local sx object.
test('primary paints the dash-on-accent label on the dash-accent fill with an eased hover filter', () => {
  render(<DashButton>Set lineup</DashButton>);
  const rule = rulesUnder(screen.getByRole('button', { name: 'Set lineup' }));
  expect(rule).toContain('color: var(--dash-on-accent)');
  expect(rule).toContain('background-color: var(--dash-accent)');
  expect(rule).toContain('border: 1px solid var(--dash-accent)');
  expect(rule).toContain('transition: filter var(--transition-fast)');
});

test('ghost paints the dim label on a transparent fill with a hairline border', () => {
  render(<DashButton variant="ghost">Compare rosters</DashButton>);
  const rule = rulesUnder(screen.getByRole('button', { name: 'Compare rosters' }));
  expect(rule).toContain('color: var(--dash-dim)');
  expect(rule).toContain('background-color: transparent');
  expect(rule).toContain('border: 1px solid var(--dash-line-strong)');
});

// Red-tell: deleting the `md` breakpoint from the size map turns this red and
// no other - the same red-tell matchup-preview's own T2 case binds through
// now that widget composes this component instead of its own local sx object.
test('size md resolves to 44px below the md breakpoint and 38px at md and up', () => {
  render(<DashButton>Set lineup</DashButton>);
  const button = screen.getByRole('button', { name: 'Set lineup' });
  expect(rulesUnder(button, '(min-width:0px)')).toMatch(/min-height: 44px/);
  expect(rulesUnder(button, '(min-width:900px)')).toMatch(/min-height: 38px/);
});

test('size sm resolves to 44px below the sm breakpoint and 32px at sm and up', () => {
  render(<DashButton size="sm">Swap in lineup</DashButton>);
  const button = screen.getByRole('button', { name: 'Swap in lineup' });
  expect(rulesUnder(button, '(min-width:0px)')).toMatch(/min-height: 44px/);
  expect(rulesUnder(button, '(min-width:600px)')).toMatch(/min-height: 32px/);
});

test('caller sx wins on a key it sets', () => {
  render(<DashButton sx={{ minWidth: 120 }}>Set lineup</DashButton>);
  const rule = rulesUnder(screen.getByRole('button', { name: 'Set lineup' }));
  expect(rule).toContain('min-width: 120px');
});

test('component passes through: a RouterLink with `to` renders an anchor with that href', () => {
  render(
    <MemoryRouter>
      <DashButton component={RouterLink} to="/league/5/lineup">
        Set lineup
      </DashButton>
    </MemoryRouter>
  );
  expect(screen.getByRole('link', { name: 'Set lineup' })).toHaveAttribute(
    'href',
    '/league/5/lineup'
  );
});

// Red-tell (#1238): dropping the forwardRef (back to a plain function
// component) leaves `ref.current` null - the same shape SegmentedControl's
// own forwardRef red-tell guards (SegmentedControl.test.jsx). start-sit-panel's
// Dismiss focus fix stands on this ref reaching the underlying button.
test('forwards a ref to the underlying button element', () => {
  const ref = React.createRef();
  render(<DashButton ref={ref}>Apply</DashButton>);
  expect(ref.current).toBe(screen.getByRole('button', { name: 'Apply' }));
});
