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
