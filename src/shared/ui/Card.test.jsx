import React from 'react';
import { render, screen } from '@testing-library/react';
import { Card } from './index';

test('renders the header title as a heading, with the count and tail', () => {
  render(
    <Card title="Standings" count={12} tail="Preseason">
      <p>row content</p>
    </Card>,
  );

  const heading = screen.getByRole('heading', { name: 'Standings' });
  expect(heading.tagName).toBe('H2');
  expect(screen.getByText('12')).toBeInTheDocument();
  expect(screen.getByText('Preseason')).toBeInTheDocument();
  expect(screen.getByText('row content')).toBeInTheDocument();
});

test('labels the section with its heading so it is a navigable landmark', () => {
  render(<Card title="Draft Grades">body</Card>);

  const region = screen.getByRole('region', { name: 'Draft Grades' });
  expect(region).toBeInTheDocument();
});

test('honours an explicit heading level', () => {
  render(<Card title="My Team" headingLevel={3}>body</Card>);

  expect(screen.getByRole('heading', { name: 'My Team' }).tagName).toBe('H3');
});

test('renders no header or heading when no title is given', () => {
  render(<Card>just a body</Card>);

  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  expect(screen.getByText('just a body')).toBeInTheDocument();
});

// jsdom lays nothing out, so the rule is read off the emotion stylesheet
// under the header's own class (the `rulesUnder` convention widgets use).
const ownRules = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  let text = '';
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (rule.selectorText === `.${cls}`) text += `${rule.style.cssText};`;
    });
  });
  return text;
};

test('the header wraps its title, count and tail rather than squeezing them onto one line', () => {
  // At phone width "Around the league" + "6 matchups" + "Projected · Game
  // Center" do not fit one line; without wrap each piece broke into two lines
  // side by side (measured in Chromium at 320-430px). Red-tell: drop
  // `flexWrap: 'wrap'` and this goes red.
  render(<Card title="Around the league" count="6 matchups" tail="Projected">body</Card>);

  // The header box has no role or text of its own; the heading's parent is it.
  // eslint-disable-next-line testing-library/no-node-access
  const header = screen.getByRole('heading', { name: 'Around the league' }).parentElement;
  expect(ownRules(header)).toMatch(/flex-wrap:\s*wrap/);
  expect(ownRules(screen.getByText('6 matchups'))).toMatch(/white-space:\s*nowrap/);
});
