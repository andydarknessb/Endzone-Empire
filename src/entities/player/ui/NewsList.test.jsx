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

test('a news item with a url renders its headline as a link that opens the story in a new tab', () => {
  render(
    <NewsList
      news={[
        {
          headline: 'Full participant in practice',
          source: 'espn',
          publishedAt: '2026-09-10T00:00:00.000Z',
          url: 'https://www.espn.com/nfl/story/_/id/1/full-participant',
        },
      ]}
    />
  );
  const link = screen.getByRole('link', { name: 'Full participant in practice' });
  expect(link).toHaveAttribute('href', 'https://www.espn.com/nfl/story/_/id/1/full-participant');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

test('a news item without a url (the feed-note fallback) renders plain text, not a link', () => {
  render(<NewsList news={[{ headline: 'Ruled out for Sunday', source: 'feed', publishedAt: null, url: null }]} />);
  expect(screen.getByText('Ruled out for Sunday')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
