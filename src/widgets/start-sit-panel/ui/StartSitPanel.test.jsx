import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StartSitPanel from './StartSitPanel';

const entries = [
  { playerId: 1, position: 'RB', kickoff: '2026-09-14T17:00:00Z' },
  { playerId: 2, position: 'RB', kickoff: '2026-09-14T20:00:00Z' },
];

const suggestion = (over = {}) => ({
  slot: 'RB',
  gain: 6.5,
  verdict: 'start',
  current: {
    playerId: 1, name: 'Sit Guy', projection: 8, opponent: 'CIN', opponentPointsAllowed: 12.1,
    distribution: { p10: 3, p90: 13 },
  },
  suggested: {
    playerId: 2, name: 'Start Guy', projection: 14.5, opponent: 'NYJ', opponentPointsAllowed: 21.4,
    distribution: { p10: 9, p90: 20 },
  },
  ...over,
});

test('hidden outright in best ball', () => {
  render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [] }} entries={entries} bestBall />);
  expect(screen.queryByTestId('start-sit-panel')).not.toBeInTheDocument();
});

test('renders a suggestion with both players\' Floor/Ceiling range bars, the opponent context and both kickoffs', () => {
  render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [] }} entries={entries} bestBall={false} />);
  const card = screen.getByTestId('suggestion-card');
  expect(within(card).getByText('Sit Guy')).toBeInTheDocument();
  expect(within(card).getByText('Start Guy')).toBeInTheDocument();
  expect(within(card).getAllByTestId('suggestion-range-bar')).toHaveLength(2);
  const context = within(card).getByTestId('suggestion-opponent-context');
  expect(context).toHaveTextContent('vs CIN (allows 12.1 to RB)');
  expect(context).toHaveTextContent('vs NYJ (allows 21.4 to RB)');
  expect(within(card).getByTestId('suggestion-decide-by')).toBeInTheDocument();
});

test('a tossup verdict shows the too-close-to-call chip, never a lean', () => {
  render(<StartSitPanel advice={{ suggestions: [suggestion({ verdict: 'tossup' })], movePlan: [] }} entries={entries} bestBall={false} />);
  const chip = screen.getByTestId('suggestion-verdict');
  expect(chip).toHaveTextContent('Too close to call');
  expect(chip).toHaveAttribute('data-verdict', 'tossup');
});

test('dismiss hides the suggestion without touching any other', async () => {
  const user = userEvent.setup();
  const second = suggestion({
    slot: 'WR',
    current: { ...suggestion().current, playerId: 3, name: 'Other Sit' },
    suggested: { ...suggestion().suggested, playerId: 4, name: 'Other Start' },
  });
  render(<StartSitPanel advice={{ suggestions: [suggestion(), second], movePlan: [] }} entries={entries} bestBall={false} />);
  expect(screen.getAllByTestId('suggestion-card')).toHaveLength(2);

  await user.click(within(screen.getAllByTestId('suggestion-card')[0]).getByTestId('suggestion-dismiss'));

  expect(screen.getAllByTestId('suggestion-card')).toHaveLength(1);
  expect(screen.getByText('Other Sit')).toBeInTheDocument();
});

// Formal risk review findings: dismissing a card left focus with nowhere to
// land (it fell to `<body>`), and nothing announced the removal.
test('dismissing a card moves focus to the next remaining card\'s Dismiss button and announces the change', async () => {
  const user = userEvent.setup();
  const second = suggestion({
    slot: 'WR',
    current: { ...suggestion().current, playerId: 3, name: 'Other Sit' },
    suggested: { ...suggestion().suggested, playerId: 4, name: 'Other Start' },
  });
  render(<StartSitPanel advice={{ suggestions: [suggestion(), second], movePlan: [] }} entries={entries} bestBall={false} />);
  const cards = screen.getAllByTestId('suggestion-card');

  await user.click(within(cards[0]).getByTestId('suggestion-dismiss'));

  expect(screen.getByTestId('suggestion-dismiss')).toHaveFocus();
  expect(within(screen.getByTestId('suggestion-card')).getByText('Other Sit')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Sit Guy over Start Guy suggestion dismissed');
});

test('dismissing the only remaining card moves focus to the panel itself, never to <body>', async () => {
  const user = userEvent.setup();
  render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [] }} entries={entries} bestBall={false} />);

  await user.click(screen.getByTestId('suggestion-dismiss'));

  expect(screen.getByTestId('start-sit-panel-content')).toHaveFocus();
  expect(screen.getByTestId('start-sit-panel-content')).toHaveAttribute('tabindex', '-1');
});

test('compare is a no-op affordance: it renders but calls only its own callback', async () => {
  const user = userEvent.setup();
  const onCompare = jest.fn();
  render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [] }} entries={entries} bestBall={false} onCompare={onCompare} />);
  await user.click(screen.getByTestId('suggestion-compare'));
  expect(onCompare).toHaveBeenCalledTimes(1);
});

test('Apply sends the advice move plan through onApply', async () => {
  const user = userEvent.setup();
  const onApply = jest.fn();
  const movePlan = [{ playerId: 1, fromSlot: 'RB', toSlot: 'BENCH' }, { playerId: 2, fromSlot: 'BENCH', toSlot: 'RB' }];
  render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan }} entries={entries} bestBall={false} onApply={onApply} />);
  await user.click(screen.getByTestId('start-sit-apply'));
  expect(onApply).toHaveBeenCalledWith(movePlan);
});

test('Apply after dismissing a suggestion sends only the remaining suggestions\' moves and open-slot fills', async () => {
  const user = userEvent.setup();
  const onApply = jest.fn();
  const second = suggestion({
    slot: 'WR',
    current: { ...suggestion().current, playerId: 3, name: 'Other Sit' },
    suggested: { ...suggestion().suggested, playerId: 4, name: 'Other Start' },
  });
  const movePlan = [
    { playerId: 2, fromSlot: 'BENCH', toSlot: 'RB' },
    { playerId: 1, fromSlot: 'RB', toSlot: 'BENCH' },
    { playerId: 4, fromSlot: 'BENCH', toSlot: 'WR' },
    { playerId: 3, fromSlot: 'WR', toSlot: 'BENCH' },
    { playerId: 9, fromSlot: 'BENCH', toSlot: 'FLEX' },
  ];
  render(<StartSitPanel advice={{ suggestions: [suggestion(), second], movePlan }} entries={entries} bestBall={false} onApply={onApply} />);

  await user.click(within(screen.getAllByTestId('suggestion-card')[0]).getByTestId('suggestion-dismiss'));
  await user.click(screen.getByTestId('start-sit-apply'));

  expect(onApply).toHaveBeenCalledWith([
    { playerId: 4, fromSlot: 'BENCH', toSlot: 'WR' },
    { playerId: 3, fromSlot: 'WR', toSlot: 'BENCH' },
    { playerId: 9, fromSlot: 'BENCH', toSlot: 'FLEX' },
  ]);
});

test('Apply is gone once every move has been dismissed away', async () => {
  const user = userEvent.setup();
  const movePlan = [{ playerId: 1, fromSlot: 'RB', toSlot: 'BENCH' }, { playerId: 2, fromSlot: 'BENCH', toSlot: 'RB' }];
  render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan }} entries={entries} bestBall={false} onApply={jest.fn()} />);
  await user.click(screen.getByTestId('suggestion-dismiss'));
  expect(screen.queryByTestId('start-sit-apply')).not.toBeInTheDocument();
});

test('no suggestions and no move plan shows "Lineup set" and no Apply button', () => {
  render(<StartSitPanel advice={{ suggestions: [], movePlan: [] }} entries={entries} bestBall={false} />);
  expect(screen.getByTestId('start-sit-panel-empty')).toHaveTextContent('Lineup set');
  expect(screen.queryByTestId('start-sit-apply')).not.toBeInTheDocument();
});

test('no "optimal", "optimize" or "range" copy anywhere on the panel', () => {
  const { container } = render(<StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [{ playerId: 1, toSlot: 'RB' }] }} entries={entries} bestBall={false} />);
  const text = container.textContent;
  expect(text).not.toMatch(/optimal|optimize/i);
  expect(text).not.toMatch(/\brange\b/i);
});

// #1852: the shared injury tag, names that open the Decision card, and the
// underdog-or-favorite line.
const withStatus = (status) => ({ available: status !== 'O', status });

test.each([['Q', 'Questionable'], ['D', 'Doubtful'], ['O', 'Out']])(
  'a %s player shows the shared injury tag beside his name; a healthy player shows none',
  (code, word) => {
    const s = suggestion();
    s.current.availability = withStatus(code);
    render(<StartSitPanel advice={{ suggestions: [s], movePlan: [] }} entries={entries} bestBall={false} />);
    const tags = screen.getAllByTestId('injury-tag');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toHaveAttribute('data-status', code);
    expect(tags[0]).toHaveTextContent(`Injury status: ${word}`);
    // Beside the sit player's name, not the start player's.
    const [sitColumn] = screen.getAllByTestId('suggestion-player');
    expect(within(sitColumn).getByText('Sit Guy')).toBeInTheDocument();
    expect(within(sitColumn).getByTestId('injury-tag')).toBeInTheDocument();
  },
);

test('no injury tag when both players are healthy', () => {
  const s = suggestion();
  s.current.availability = { available: true, status: null };
  render(<StartSitPanel advice={{ suggestions: [s], movePlan: [] }} entries={entries} bestBall={false} />);
  expect(screen.queryByTestId('injury-tag')).not.toBeInTheDocument();
});

test('tapping either name opens the Decision card for that player; Compare is unchanged', async () => {
  const user = userEvent.setup();
  const onOpenDecisionCard = jest.fn();
  const onCompare = jest.fn();
  render(
    <StartSitPanel
      advice={{ suggestions: [suggestion()], movePlan: [] }}
      entries={entries}
      bestBall={false}
      onOpenDecisionCard={onOpenDecisionCard}
      onCompare={onCompare}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Sit Guy' }));
  expect(onOpenDecisionCard).toHaveBeenLastCalledWith(1);
  await user.click(screen.getByRole('button', { name: 'Start Guy' }));
  expect(onOpenDecisionCard).toHaveBeenLastCalledWith(2);
  expect(onCompare).not.toHaveBeenCalled();
  await user.click(screen.getByTestId('suggestion-compare'));
  expect(onCompare).toHaveBeenCalledTimes(1);
  expect(onOpenDecisionCard).toHaveBeenCalledTimes(2);
});

test('the lean line shows at the top of the card when the Expected final gap is 10 or more', () => {
  render(
    <StartSitPanel
      advice={{ suggestions: [suggestion()], movePlan: [] }}
      entries={entries}
      bestBall={false}
      expectedFinals={{ mine: 88, theirs: 100 }}
    />,
  );
  const line = screen.getByTestId('start-sit-lean-line');
  expect(line).toHaveTextContent('Projected to trail by 12: lean toward Ceiling');
  // Above the first suggestion, and it names no player.
  const card = screen.getByTestId('suggestion-card');
  expect(line.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(line.textContent).not.toMatch(/Sit Guy|Start Guy/);
});

test('the lean line favors Floor when the manager leads by 10 or more', () => {
  render(
    <StartSitPanel
      advice={{ suggestions: [suggestion()], movePlan: [] }}
      entries={entries}
      bestBall={false}
      expectedFinals={{ mine: 112, theirs: 100 }}
    />,
  );
  expect(screen.getByTestId('start-sit-lean-line')).toHaveTextContent('Projected to lead by 12: lean toward Floor');
});

test('no lean line in a closer Matchup or before the Matchup data has loaded', () => {
  const { rerender } = render(
    <StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [] }} entries={entries} bestBall={false} expectedFinals={{ mine: 95, theirs: 88 }} />,
  );
  expect(screen.queryByTestId('start-sit-lean-line')).not.toBeInTheDocument();
  rerender(
    <StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [] }} entries={entries} bestBall={false} />,
  );
  expect(screen.queryByTestId('start-sit-lean-line')).not.toBeInTheDocument();
});

test('the lean line changes no suggestion and never reads "range"', () => {
  const { container } = render(
    <StartSitPanel advice={{ suggestions: [suggestion()], movePlan: [] }} entries={entries} bestBall={false} expectedFinals={{ mine: 70, theirs: 100 }} />,
  );
  expect(screen.getAllByTestId('suggestion-card')).toHaveLength(1);
  expect(container.textContent).not.toMatch(/\brange\b/i);
  expect(container.textContent).not.toMatch(/—/);
});

describe('fact chips (#1853)', () => {
  const withGame = (current, suggested) => suggestion({
    current: { ...suggestion().current, ...current },
    suggested: { ...suggestion().suggested, ...suggested },
  });
  const calm = { indoor: false, windSpeedMph: 5, windGustMph: 8, precipitationProbability: 10, shortForecast: 'Clear' };
  const renderPanel = (s) => render(<StartSitPanel advice={{ suggestions: [s], movePlan: [] }} entries={entries} bestBall={false} />);

  test('renders each chip with its exact copy and the context-only label', () => {
    renderPanel(withGame({}, {
      line: { spread: -7.5, total: 49.5, favoredBy: 7.5 },
      weather: { ...calm, windSpeedMph: 22, precipitationProbability: 70 },
      weatherApplied: false,
      marketApplied: false,
    }));
    const chips = screen.getAllByTestId('suggestion-fact-chip');
    expect(chips.map((chip) => chip.getAttribute('data-chip'))).toEqual(['total', 'favored', 'wind', 'rain']);
    expect(chips[0]).toHaveTextContent('High total 49.5');
    expect(chips[1]).toHaveTextContent('Favored by 7.5');
    expect(chips[2]).toHaveTextContent('Wind 22 mph');
    expect(chips[3]).toHaveTextContent('Rain 70%');
    for (const chip of chips) expect(within(chip).getByText('context only')).toBeInTheDocument();
  });

  test('the label drops for a Factor that is applied, chip by chip', () => {
    renderPanel(withGame({}, {
      line: { spread: -7.5, total: 49.5, favoredBy: 7.5 },
      weather: { ...calm, windSpeedMph: 22 },
      weatherApplied: false,
      marketApplied: true,
    }));
    const byKey = Object.fromEntries(screen.getAllByTestId('suggestion-fact-chip').map((chip) => [chip.getAttribute('data-chip'), chip]));
    expect(within(byKey.total).queryByText('context only')).not.toBeInTheDocument();
    expect(within(byKey.favored).queryByText('context only')).not.toBeInTheDocument();
    expect(within(byKey.wind).getByText('context only')).toBeInTheDocument();
  });

  test('a chip sits under its own player, not the other side', () => {
    renderPanel(withGame(
      { line: { spread: 9, total: 40, favoredBy: -9 } },
      { line: { spread: -9, total: 40, favoredBy: 9 }, marketApplied: false },
    ));
    const [sitColumn, startColumn] = screen.getAllByTestId('suggestion-player');
    expect(within(sitColumn).queryByTestId('suggestion-fact-chip')).not.toBeInTheDocument();
    expect(within(startColumn).getByTestId('suggestion-fact-chip')).toHaveTextContent('Favored by 9');
  });

  test('a dome and an unremarkable game show no chips', () => {
    renderPanel(withGame(
      { weather: { ...calm, indoor: true, windSpeedMph: null, precipitationProbability: null } },
      { line: { spread: -3, total: 44, favoredBy: 3 }, weather: calm },
    ));
    expect(screen.queryByTestId('suggestion-fact-chip')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// #1856: Call your shot
// ---------------------------------------------------------------------------

const shot = (over = {}) => ({
  status: 'pending',
  outcome: null,
  canWithdraw: true,
  probability: 0.92,
  starter: { playerId: 1, name: 'Sit Guy', projection: 8, points: null },
  benched: { playerId: 2, name: 'Start Guy', projection: 14.5, points: null },
  ...over,
});

test('Call your shot sits beside Dismiss on a lean row and hands the row to onCallShot', async () => {
  const user = userEvent.setup();
  const onCallShot = jest.fn();
  render(
    <StartSitPanel
      advice={{ suggestions: [suggestion({ probabilityBetter: 0.91 })], movePlan: [] }}
      entries={entries}
      bestBall={false}
      onCallShot={onCallShot}
    />
  );
  const card = screen.getByTestId('suggestion-card');
  await user.click(within(card).getByRole('button', { name: /call your shot/i }));
  expect(onCallShot).toHaveBeenCalledTimes(1);
  expect(onCallShot.mock.calls[0][0]).toMatchObject({ sit: { playerId: 1 }, start: { playerId: 2 } });
});

test('Call your shot is absent on a too-close-to-call row, on a row with no probability, and with no handler', () => {
  const { rerender } = render(
    <StartSitPanel
      advice={{ suggestions: [suggestion({ verdict: 'tossup', probabilityBetter: 0.55 })], movePlan: [] }}
      entries={entries}
      bestBall={false}
      onCallShot={() => {}}
    />
  );
  expect(screen.queryByTestId('suggestion-call-shot')).not.toBeInTheDocument();

  rerender(
    <StartSitPanel
      advice={{ suggestions: [suggestion({ probabilityBetter: null })], movePlan: [] }}
      entries={entries}
      bestBall={false}
      onCallShot={() => {}}
    />
  );
  expect(screen.queryByTestId('suggestion-call-shot')).not.toBeInTheDocument();

  rerender(
    <StartSitPanel advice={{ suggestions: [suggestion({ probabilityBetter: 0.9 })], movePlan: [] }} entries={entries} bestBall={false} />
  );
  expect(screen.queryByTestId('suggestion-call-shot')).not.toBeInTheDocument();
});

test('no standing line when the payload carries no shot', () => {
  render(<StartSitPanel advice={{ suggestions: [], movePlan: [], calledShot: null }} entries={entries} bestBall={false} />);
  expect(screen.queryByTestId('called-shot-line')).not.toBeInTheDocument();
});

test('a pending shot shows the pair, the numbers as called and Withdraw', async () => {
  const user = userEvent.setup();
  const onWithdrawShot = jest.fn();
  render(
    <StartSitPanel
      advice={{ suggestions: [], movePlan: [], calledShot: shot() }}
      entries={entries}
      bestBall={false}
      onWithdrawShot={onWithdrawShot}
    />
  );
  const line = screen.getByTestId('called-shot-line');
  expect(line).toHaveAttribute('data-state', 'pending');
  expect(line).toHaveTextContent('Your called shot');
  expect(screen.getByTestId('called-shot-pair')).toHaveTextContent('Sit Guy over Start Guy');
  expect(screen.getByTestId('called-shot-numbers')).toHaveTextContent('Proj 8.0 vs 14.5');
  expect(screen.getByTestId('called-shot-numbers')).toHaveTextContent('92% lean to Start Guy');
  await user.click(screen.getByTestId('called-shot-withdraw'));
  expect(onWithdrawShot).toHaveBeenCalledTimes(1);
});

test('a locked shot says so and offers no Withdraw', () => {
  render(
    <StartSitPanel
      advice={{ suggestions: [], movePlan: [], calledShot: shot({ status: 'locked', canWithdraw: false }) }}
      entries={entries}
      bestBall={false}
      onWithdrawShot={() => {}}
    />
  );
  expect(screen.getByTestId('called-shot-line')).toHaveAttribute('data-state', 'locked');
  expect(screen.getByTestId('called-shot-status')).toHaveTextContent('Locked');
  expect(screen.queryByTestId('called-shot-withdraw')).not.toBeInTheDocument();
});

test.each([
  ['hit', 'Hit: Sit Guy scored 12.5, Start Guy 9.0'],
  ['miss', 'Miss: Sit Guy scored 12.5, Start Guy 9.0'],
  ['void', 'Void'],
])('a resolved %s shot reads its outcome and offers no Withdraw', (outcome, text) => {
  render(
    <StartSitPanel
      advice={{
        suggestions: [],
        movePlan: [],
        calledShot: shot({
          status: 'resolved',
          outcome,
          canWithdraw: false,
          starter: { playerId: 1, name: 'Sit Guy', projection: 8, points: 12.5 },
          benched: { playerId: 2, name: 'Start Guy', projection: 14.5, points: 9 },
        }),
      }}
      entries={entries}
      bestBall={false}
      onWithdrawShot={() => {}}
    />
  );
  expect(screen.getByTestId('called-shot-line')).toHaveAttribute('data-state', `resolved-${outcome}`);
  expect(screen.getByTestId('called-shot-status')).toHaveTextContent(text);
  expect(screen.queryByTestId('called-shot-withdraw')).not.toBeInTheDocument();
});

test('the shot adds no client filter: Apply still passes the payload plan minus dismissed pairs only', async () => {
  const user = userEvent.setup();
  const onApply = jest.fn();
  const plan = [{ playerId: 5, fromSlot: 'BENCH', toSlot: 'WR' }];
  render(
    <StartSitPanel
      advice={{ suggestions: [], movePlan: plan, calledShot: shot() }}
      entries={entries}
      bestBall={false}
      onApply={onApply}
    />
  );
  await user.click(screen.getByTestId('start-sit-apply'));
  expect(onApply).toHaveBeenCalledWith(plan);
});

test('while a shot request is in flight the actions stay mounted, aria-disabled, and ignore clicks (#1856)', async () => {
  const user = userEvent.setup();
  const onCallShot = jest.fn();
  const onWithdrawShot = jest.fn();
  render(
    <StartSitPanel
      advice={{ suggestions: [suggestion({ probabilityBetter: 0.9 })], movePlan: [], calledShot: shot() }}
      entries={entries}
      bestBall={false}
      onCallShot={onCallShot}
      onWithdrawShot={onWithdrawShot}
      shotBusy
    />
  );
  const call = screen.getByTestId('suggestion-call-shot');
  const withdraw = screen.getByTestId('called-shot-withdraw');
  expect(call).toHaveAttribute('aria-disabled', 'true');
  expect(withdraw).toHaveAttribute('aria-disabled', 'true');
  await user.click(call);
  await user.click(withdraw);
  expect(onCallShot).not.toHaveBeenCalled();
  expect(onWithdrawShot).not.toHaveBeenCalled();
});

test('an accepted shot moves focus to the card and announces it; a refused one does neither (#1856)', async () => {
  const user = userEvent.setup();
  const onCallShot = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(
    <StartSitPanel
      advice={{ suggestions: [suggestion({ probabilityBetter: 0.9 })], movePlan: [] }}
      entries={entries}
      bestBall={false}
      onCallShot={onCallShot}
    />
  );
  const call = screen.getByTestId('suggestion-call-shot');
  await user.click(call);
  expect(screen.getByRole('status')).toHaveTextContent('');
  expect(screen.getByTestId('start-sit-panel-content')).not.toHaveFocus();

  await user.click(call);
  expect(await screen.findByText('Shot called: Sit Guy over Start Guy')).toBeInTheDocument();
  expect(screen.getByTestId('start-sit-panel-content')).toHaveFocus();
});

test('the standing line is a labelled group and Withdraw names the shot (#1856)', () => {
  render(
    <StartSitPanel advice={{ suggestions: [], movePlan: [], calledShot: shot() }} entries={entries} bestBall={false} onWithdrawShot={() => {}} />
  );
  expect(screen.getByRole('group', { name: 'Your called shot' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Withdraw your called shot: Sit Guy over Start Guy' })).toBeInTheDocument();
});

// #1857: once both players have locked the standing line shows live points.
const bothLocked = (over = {}) => shot({
  status: 'locked',
  bothLocked: true,
  canWithdraw: false,
  starter: { playerId: 1, name: 'Sit Guy', projection: 8, points: 11.4 },
  benched: { playerId: 2, name: 'Start Guy', projection: 14.5, points: 6.2 },
  ...over,
});

test('with both players locked the standing line reads their live points off the lineup entries', () => {
  const live = [
    { playerId: 1, position: 'RB', points: 12.9 },
    { playerId: 2, position: 'RB', points: 7 },
  ];
  render(<StartSitPanel advice={{ suggestions: [], movePlan: [], calledShot: bothLocked() }} entries={live} bestBall={false} />);
  expect(screen.getByTestId('called-shot-line')).toHaveAttribute('data-state', 'locked');
  expect(screen.getByTestId('called-shot-status')).toHaveTextContent('Live: Sit Guy 12.9 to Start Guy 7.0');
});

test('with both players locked and no live entry points, the payload points stand', () => {
  render(<StartSitPanel advice={{ suggestions: [], movePlan: [], calledShot: bothLocked() }} entries={entries} bestBall={false} />);
  expect(screen.getByTestId('called-shot-status')).toHaveTextContent('Live: Sit Guy 11.4 to Start Guy 6.2');
});

test('with only one player locked the standing line shows no live points', () => {
  const live = [{ playerId: 1, position: 'RB', points: 12.9 }, { playerId: 2, position: 'RB', points: 7 }];
  render(
    <StartSitPanel
      advice={{ suggestions: [], movePlan: [], calledShot: shot({ status: 'locked', bothLocked: false, canWithdraw: false }) }}
      entries={live}
      bestBall={false}
    />
  );
  expect(screen.getByTestId('called-shot-status')).toHaveTextContent('Locked: one of the two games has started');
  expect(screen.getByTestId('called-shot-status')).not.toHaveTextContent('Live');
});
