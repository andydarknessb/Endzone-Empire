import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import RetroScoreboard from './RetroScoreboard';

const renderScoreboard = (props = {}) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <RetroScoreboard
        leagueName="Armchair Fantasy Football League"
        homeName="Razor's Edge"
        awayName="Sexual Tyrannosaurus"
        homeScore={101.5}
        awayScore={88}
        chipLabel="Scheduled"
        {...props}
      />
    </ThemeProvider>
  );

test('renders the league name, both team names, and rounded scores', () => {
  renderScoreboard();

  expect(screen.getByText('ARMCHAIR FANTASY FOOTBALL LEAGUE')).toBeInTheDocument();
  expect(screen.getByText("RAZOR'S EDGE")).toBeInTheDocument();
  expect(screen.getByText('SEXUAL TYRANNOSAURUS')).toBeInTheDocument();
  expect(screen.getByText('102')).toBeInTheDocument();
  expect(screen.getByText('88')).toBeInTheDocument();
});

test('uppercases the predicate chip label, and shows nothing for an unknown status', () => {
  const { rerender } = renderScoreboard({ chipLabel: 'Scheduled' });
  expect(screen.getByText('SCHEDULED')).toBeInTheDocument();

  const rerenderWith = (chipLabel) =>
    rerender(
      <ThemeProvider theme={createTheme()}>
        <RetroScoreboard homeName="A" awayName="B" homeScore={0} awayScore={0} chipLabel={chipLabel} />
      </ThemeProvider>
    );

  rerenderWith('LIVE');
  expect(screen.getByText('LIVE')).toBeInTheDocument();

  rerenderWith('Awaiting final');
  expect(screen.getByText('AWAITING FINAL')).toBeInTheDocument();

  rerenderWith('Final');
  expect(screen.getByText('FINAL')).toBeInTheDocument();

  // ADR 0030: a status the server could not compute shows blank, never a
  // guessed "NOT STARTED".
  rerenderWith(null);
  expect(screen.queryByText('NOT STARTED')).not.toBeInTheDocument();
});
