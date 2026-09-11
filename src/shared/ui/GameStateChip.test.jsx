import React from 'react';
import { render, screen } from '@testing-library/react';
import GameStateChip from './GameStateChip';

test('pre renders the neutral variant with no dot', () => {
  render(<GameStateChip state="pre">Sun 1:00 PM</GameStateChip>);
  const chip = screen.getByTestId('game-state-chip');
  expect(chip).toHaveAttribute('data-variant', 'neutral');
  expect(chip).toHaveAttribute('data-game-state', 'pre');
  expect(chip).not.toHaveAttribute('data-dot');
  expect(chip).toHaveTextContent('Sun 1:00 PM');
});

test('live renders the danger variant with a dot', () => {
  render(<GameStateChip state="live">Q3 6:42</GameStateChip>);
  const chip = screen.getByTestId('game-state-chip');
  expect(chip).toHaveAttribute('data-variant', 'danger');
  expect(chip).toHaveAttribute('data-dot', 'true');
});

test('final renders the success variant', () => {
  render(<GameStateChip state="final">Final</GameStateChip>);
  expect(screen.getByTestId('game-state-chip')).toHaveAttribute('data-variant', 'success');
});

test('bye renders the warning variant', () => {
  render(<GameStateChip state="bye">on bye</GameStateChip>);
  expect(screen.getByTestId('game-state-chip')).toHaveAttribute('data-variant', 'warning');
});

test('an unrecognized state falls back to neutral rather than throwing', () => {
  render(<GameStateChip state="unknown">?</GameStateChip>);
  expect(screen.getByTestId('game-state-chip')).toHaveAttribute('data-variant', 'neutral');
});
