import React from 'react';
import { render, screen } from '@testing-library/react';
import NewsList from './NewsList';

test('renders nothing for a null or empty news list', () => {
  const { container: nullCase } = render(<NewsList news={null} />);
  expect(nullCase).toBeEmptyDOMElement();
  const { container: emptyCase } = render(<NewsList news={[]} />);
  expect(emptyCase).toBeEmptyDOMElement();
});

test('renders each headline, dated when publishedAt is present', () => {
  render(
    <NewsList
      news={[
        { headline: 'Ruled out for Sunday', source: 'feed', publishedAt: null },
        { headline: 'Full participant in practice', source: 'espn', publishedAt: '2026-09-10T00:00:00.000Z' },
      ]}
    />
  );
  expect(screen.getByText('Ruled out for Sunday')).toBeInTheDocument();
  expect(screen.getByText('Full participant in practice')).toBeInTheDocument();
  expect(screen.getByText(new Date('2026-09-10T00:00:00.000Z').toLocaleDateString())).toBeInTheDocument();
});
