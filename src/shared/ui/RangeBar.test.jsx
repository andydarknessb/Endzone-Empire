import React from 'react';
import { render, screen } from '@testing-library/react';
import { RangeBar } from './index';

test('is an image named with the Floor, projection and Ceiling figures', () => {
  render(<RangeBar floor={8} projection={14} ceiling={20} />);
  expect(screen.getByRole('img', { name: 'Floor 8.0, Projection 14.0, Ceiling 20.0' })).toBeInTheDocument();
});

test('a label prefixes the accessible name', () => {
  render(<RangeBar label="Josh Allen" floor={8} projection={14} ceiling={20} />);
  expect(screen.getByRole('img', { name: 'Josh Allen, Floor 8.0, Projection 14.0, Ceiling 20.0' })).toBeInTheDocument();
});

test('positions the band between Floor and Ceiling and the tick at the projection, over an explicit domain', () => {
  render(<RangeBar floor={10} projection={15} ceiling={20} min={0} max={20} data-testid="bar" />);
  expect(screen.getByTestId('bar-band').style.left).toBe('50%');
  expect(screen.getByTestId('bar-band').style.width).toBe('50%');
  expect(screen.getByTestId('bar-tick').style.left).toBe('75%');
});

test('two bars given the same domain stay comparable to one another', () => {
  render(
    <>
      <RangeBar data-testid="a" floor={5} projection={10} ceiling={15} min={0} max={30} />
      <RangeBar data-testid="b" floor={20} projection={25} ceiling={30} min={0} max={30} />
    </>
  );
  expect(screen.getByTestId('a-band').style.left).toBe(`${(5 / 30) * 100}%`);
  expect(screen.getByTestId('b-band').style.left).toBe(`${(20 / 30) * 100}%`);
});

test('a missing Floor or Ceiling renders no band, never a guessed one', () => {
  render(<RangeBar projection={14} data-testid="bar" />);
  expect(screen.queryByTestId('bar-band')).not.toBeInTheDocument();
  expect(screen.getByTestId('bar-tick')).toBeInTheDocument();
});

test('a missing projection renders no tick', () => {
  render(<RangeBar floor={8} ceiling={20} data-testid="bar" />);
  expect(screen.queryByTestId('bar-tick')).not.toBeInTheDocument();
});

test('no figures at all names the bar rather than announcing nothing', () => {
  render(<RangeBar />);
  expect(screen.getByRole('img', { name: 'No projection' })).toBeInTheDocument();
});

// Formal risk review finding: `Number(null)` is `0`, which
// `Number.isFinite` accepts, so a naive coercion read an explicit `null`
// (an unavailable player's projection, `server/services/decision.service.js`'s
// `effectiveProjection`) as a known zero - fabricating "Floor 0.0, Projection
// 0.0, Ceiling 0.0" in the accessible name and a zero-width band, both
// contradicting a sighted reader's own dashes.
test('an explicit null for every figure renders no band, no tick, and never a fabricated 0.0', () => {
  render(<RangeBar floor={null} ceiling={null} projection={null} data-testid="bar" />);
  expect(screen.getByRole('img', { name: 'No projection' })).toBeInTheDocument();
  expect(screen.queryByTestId('bar-band')).not.toBeInTheDocument();
  expect(screen.queryByTestId('bar-tick')).not.toBeInTheDocument();
});

test('a null domain min/max never collapses to a fabricated zero either', () => {
  render(<RangeBar floor={8} projection={14} ceiling={20} min={null} max={null} data-testid="bar" />);
  expect(screen.getByTestId('bar-band')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Floor 8.0, Projection 14.0, Ceiling 20.0' })).toBeInTheDocument();
});
