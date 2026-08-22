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
        isFinal={false}
        isLive={false}
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

test('shows NOT STARTED before kickoff, LIVE while in progress, and FINAL once over', () => {
  const { rerender } = renderScoreboard({ isFinal: false, isLive: false });
  expect(screen.getByText('NOT STARTED')).toBeInTheDocument();

  rerender(
    <ThemeProvider theme={createTheme()}>
      <RetroScoreboard homeName="A" awayName="B" homeScore={0} awayScore={0} isFinal={false} isLive />
    </ThemeProvider>
  );
  expect(screen.getByText('LIVE')).toBeInTheDocument();

  rerender(
    <ThemeProvider theme={createTheme()}>
      <RetroScoreboard homeName="A" awayName="B" homeScore={0} awayScore={0} isFinal isLive={false} />
    </ThemeProvider>
  );
  expect(screen.getByText('FINAL')).toBeInTheDocument();
});
