import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SimConfigForm from './SimConfigForm';

function openSelect(label) {
  fireEvent.mouseDown(screen.getByLabelText(label));
}

describe('SimConfigForm', () => {
  it('defaults to a 10-team standard league, slot 1, 60-second clock', () => {
    const onStart = jest.fn();
    render(<SimConfigForm onStart={onStart} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start mock draft' }));
    expect(onStart).toHaveBeenCalledWith({
      totalTeams: 10, userSlot: 1, leagueType: 'standard', clockSeconds: 60,
    });
  });

  it('describes the resulting draft, and updates when the format changes', () => {
    render(<SimConfigForm onStart={jest.fn()} />);
    expect(screen.getByText(/10-team Standard · 15 rounds · 150 total picks/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'IDP format' }));
    expect(screen.getByText(/10-team IDP · 18 rounds · 180 total picks/)).toBeInTheDocument();
  });

  it('marks the selected format for assistive tech', () => {
    render(<SimConfigForm onStart={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Standard format' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Superflex format' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Superflex format' }));
    expect(screen.getByRole('button', { name: 'Superflex format' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers every league size from 4 to 14 and passes the choice through', () => {
    const onStart = jest.fn();
    render(<SimConfigForm onStart={onStart} />);

    openSelect('Managers');
    expect(screen.getByRole('option', { name: '4 teams' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '14 teams' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '15 teams' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: '6 teams' }));

    fireEvent.click(screen.getByRole('button', { name: 'Start mock draft' }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ totalTeams: 6 }));
  });

  it('pulls an out-of-range draft slot back in when the league shrinks', () => {
    const onStart = jest.fn();
    render(<SimConfigForm onStart={onStart} />);

    openSelect('Your draft slot');
    fireEvent.click(screen.getByRole('option', { name: 'Pick 10' }));
    openSelect('Managers');
    fireEvent.click(screen.getByRole('option', { name: '6 teams' }));

    fireEvent.click(screen.getByRole('button', { name: 'Start mock draft' }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ totalTeams: 6, userSlot: 6 }));
  });

  it('supports a random draft slot', () => {
    const onStart = jest.fn();
    render(<SimConfigForm onStart={onStart} />);

    openSelect('Your draft slot');
    fireEvent.click(screen.getByRole('option', { name: 'Random' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start mock draft' }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ userSlot: 'random' }));
  });

  it('offers 30/60/90 and no clock, and explains what no clock means', () => {
    const onStart = jest.fn();
    render(<SimConfigForm onStart={onStart} />);

    expect(screen.getByRole('button', { name: '30s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '90s' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'No clock' }));
    expect(screen.getByText(/nothing auto-drafts/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start mock draft' }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ clockSeconds: 0 }));
  });

  // ADR 0021 / #704: "League format" and "Pick clock" already carry
  // component="h2" (ticket 1, out of scope here). The option name inside
  // each format card names a selectable card, not a document heading — the
  // CardActionArea's own aria-label ("Standard format", asserted above) is
  // its accessible name, so the option-name Typography is component="span"
  // and introduces no heading. A bare render (no ThemeProvider) must show no
  // stray h6.
  it('has an h2 for each section title and no heading for the card option name', () => {
    render(<SimConfigForm onStart={jest.fn()} />);

    expect(screen.getByRole('heading', { level: 2, name: 'League format' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Pick clock' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Standard' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 6 })).toHaveLength(0);
  });

  it('disables the start button while the pool is loading', () => {
    render(<SimConfigForm onStart={jest.fn()} loading />);
    expect(screen.getByRole('button', { name: 'Loading players…' })).toBeDisabled();
  });

  it('explains a failed pool fetch', () => {
    render(<SimConfigForm onStart={jest.fn()} error />);
    expect(screen.getByText(/couldn't load the player pool/i)).toBeInTheDocument();
  });

  describe('resume banner', () => {
    const savedSummary = {
      totalTeams: 12, leagueType: 'superflex', round: 4, rounds: 16,
      pickNumber: 42, updatedAt: Date.now() - 5 * 60 * 1000,
    };

    it('describes the saved draft and offers resume or discard', () => {
      const onResume = jest.fn();
      const onDiscardSaved = jest.fn();
      render(
        <SimConfigForm
          onStart={jest.fn()}
          savedSummary={savedSummary}
          onResume={onResume}
          onDiscardSaved={onDiscardSaved}
        />
      );

      expect(screen.getByText(/12-team Superflex, round 4 of 16/)).toBeInTheDocument();
      expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
      expect(onResume).toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(onDiscardSaved).toHaveBeenCalled();
    });

    it('is absent when there is nothing to resume', () => {
      render(<SimConfigForm onStart={jest.fn()} />);
      expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    });
  });
});
