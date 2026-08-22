import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as draftTimeFormat from '../../lib/draftTimeFormat';
import Countdown from './Countdown';

const NOW = new Date('2026-07-17T12:00:00Z');

function futureIso(msFromNow) {
  return new Date(NOW.getTime() + msFromNow).toISOString();
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('Countdown', () => {
  beforeEach(() => {
    window.URL.createObjectURL = jest.fn(() => 'blob:draft-ics');
    window.URL.revokeObjectURL = jest.fn();
    jest.useFakeTimers('modern');
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('renders nothing for a null date', () => {
    const { container } = render(<Countdown date={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing for a past date', () => {
    const { container } = render(<Countdown date={futureIso(-1000)} />);
    expect(container).toBeEmptyDOMElement();
  });

  describe('tiered cadence (#117 AC4)', () => {
    test('more than 24h out shows days and hours', () => {
      render(<Countdown date={futureIso(2 * DAY + 3 * HOUR)} />);
      expect(screen.getByText('Draft in 2d 03h')).toBeInTheDocument();
    });

    test('1-24h out shows hours and minutes, and updates by the minute', () => {
      render(<Countdown date={futureIso(3 * HOUR + 5 * MINUTE)} />);
      expect(screen.getByText('Draft in 3h 05m')).toBeInTheDocument();

      act(() => { jest.advanceTimersByTime(MINUTE); });
      expect(screen.getByText('Draft in 3h 04m')).toBeInTheDocument();
    });

    test('under 1h shows minutes and seconds, and updates by the second', () => {
      render(<Countdown date={futureIso(5 * MINUTE + 9 * 1000)} />);
      expect(screen.getByText('Draft in 5m 09s')).toBeInTheDocument();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(screen.getByText('Draft in 5m 08s')).toBeInTheDocument();
    });

    test('crosses tiers automatically as time passes, switching cadence and format', () => {
      // Starts 1 minute into the "hours" tier (minute cadence); crossing the
      // 1h boundary should switch it straight to per-second "seconds" format
      // without waiting for the next minute-cadence tick.
      render(<Countdown date={futureIso(HOUR + MINUTE)} />);
      expect(screen.getByText('Draft in 1h 01m')).toBeInTheDocument();

      act(() => { jest.advanceTimersByTime(2 * MINUTE); });
      expect(screen.getByText(/^Draft in \d+m \d{2}s$/)).toBeInTheDocument();
    });

    test('disappears once the target instant is reached', () => {
      const { container } = render(<Countdown date={futureIso(2000)} />);
      expect(screen.getByText(/^Draft in/)).toBeInTheDocument();

      act(() => { jest.advanceTimersByTime(2500); });
      expect(container).toBeEmptyDOMElement();
    });

    test('the chip variant follows the same tiers', () => {
      render(<Countdown variant="chip" date={futureIso(2 * DAY)} />);
      expect(screen.getByText('⏱ 2d 00h')).toBeInTheDocument();
    });
  });

  describe('lifecycle: isolated ticking, cleared on unmount (#117 AC5)', () => {
    test('clears every timer on unmount, leaving none pending', () => {
      const { unmount } = render(
        <Countdown date={futureIso(30 * 1000)} leagueId={1} leagueName="Harness League" />
      );
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      unmount();

      expect(jest.getTimerCount()).toBe(0);
    });

    test('the surrounding shell is not recomputed on every tick', () => {
      const spy = jest.spyOn(draftTimeFormat, 'formatViewerLocalSchedule');
      render(<Countdown date={futureIso(5 * MINUTE)} leagueId={1} leagueName="Harness League" />);
      expect(spy).toHaveBeenCalledTimes(1);

      act(() => { jest.advanceTimersByTime(4 * 1000); });

      // The ticking digits changed, but the shell's own formatting call did not re-run.
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('viewer-local schedule and league-timezone detail (#117 AC1, AC2)', () => {
    // formatViewerLocalSchedule with no explicit zone resolves to whatever
    // this process's own default is (Node/jsdom cache the ICU default at
    // process start, so process.env.TZ cannot be flipped mid-suite here -
    // see draftTimeFormat.test.js for the explicit-zone coverage of #117
    // AC1's "a different viewer reads a different wall time" case, and the
    // draft-board browser spec for a real cross-timezone check via
    // Playwright's timezoneId).
    test('the primary line matches the short-weekday, no-seconds, zone-abbreviated format', () => {
      const date = '2026-09-03T18:00:00.000Z';
      render(<Countdown date={date} />);
      expect(screen.getByText(`· ${draftTimeFormat.formatViewerLocalSchedule(date)}`)).toBeInTheDocument();
    });

    test('hover/tap detail names the league Draft time zone for the same instant', () => {
      render(<Countdown date="2026-09-03T18:00:00.000Z" timeZone="America/New_York" />);
      expect(screen.getByLabelText('League draft time zone (America/New_York): Thu, Sep 3, 2:00 PM EDT'))
        .toBeInTheDocument();
    });

    test('falls back to UTC for a legacy schedule with no draft time zone set', () => {
      render(<Countdown date="2026-09-03T18:00:00.000Z" />);
      expect(screen.getByLabelText('No draft time zone set - shown in UTC: Thu, Sep 3, 6:00 PM UTC'))
        .toBeInTheDocument();
    });

    test('the chip variant renders no detail line or calendar link', () => {
      render(<Countdown variant="chip" date={futureIso(2 * DAY)} timeZone="America/New_York" leagueId={1} leagueName="Harness League" />);
      expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument();
    });
  });

  describe('milestone announcements, separate from the visible ticker (#117 AC6)', () => {
    test('the visible timer carries no aria-live attribute of its own', () => {
      render(<Countdown date={futureIso(5 * MINUTE)} />);
      const ticker = screen.getByText(/^Draft in/);
      expect(ticker).not.toHaveAttribute('aria-live');
      expect(ticker.closest('[aria-live]')).toBeNull();
    });

    test('announces at 5 minutes, 1 minute, 30 seconds, 10 seconds, and Draft start - nothing in between', () => {
      render(<Countdown date={futureIso(5 * MINUTE)} />);
      act(() => { jest.advanceTimersByTime(0); }); // fires the milestone due exactly at mount

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveTextContent('Draft start in 5 minutes');

      act(() => { jest.advanceTimersByTime(1000); });
      expect(status).toHaveTextContent('Draft start in 5 minutes'); // unchanged between milestones

      act(() => { jest.advanceTimersByTime(4 * MINUTE); }); // now at the 1-minute mark
      expect(status).toHaveTextContent('Draft start in 1 minute');

      act(() => { jest.advanceTimersByTime(30 * 1000); }); // now at 30 seconds
      expect(status).toHaveTextContent('Draft start in 30 seconds');

      act(() => { jest.advanceTimersByTime(20 * 1000); }); // now at 10 seconds
      expect(status).toHaveTextContent('Draft start in 10 seconds');

      act(() => { jest.advanceTimersByTime(10 * 1000); }); // draft start
      expect(status).toHaveTextContent('Draft start');
    });

    test('does not retroactively announce a milestone already behind the target at mount', () => {
      render(<Countdown date={futureIso(20 * 1000)} />); // between the 30s and 10s marks
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('');

      act(() => { jest.advanceTimersByTime(10 * 1000); }); // now at 10 seconds
      expect(status).toHaveTextContent('Draft start in 10 seconds');
    });

    test('announce=false renders no status region at all (the pick-clock use)', () => {
      render(<Countdown date={futureIso(5 * MINUTE)} prefix="Time remaining:" announce={false} />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('calendar export (#117 AC3)', () => {
    test('shows "Add to calendar" only once both a league id and name are supplied', () => {
      render(<Countdown date={futureIso(DAY)} />);
      expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument();
    });

    test('downloads a .ics for the UTC start with the league title and route, no invented duration', () => {
      let capturedBlobText;
      window.URL.createObjectURL = jest.fn((blob) => {
        capturedBlobText = blob;
        return 'blob:draft-ics';
      });

      render(
        <Countdown
          date="2026-09-03T18:00:00.000Z"
          leagueId={42}
          leagueName="Harness League"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));

      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(capturedBlobText.type).toBe('text/calendar;charset=utf-8');
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:draft-ics');
    });
  });
});
