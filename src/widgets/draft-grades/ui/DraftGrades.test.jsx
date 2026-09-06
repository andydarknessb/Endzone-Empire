import React from 'react';
import { render, screen, within } from '@testing-library/react';
import AppThemeProvider from '../../../theme/AppThemeProvider';
import { cssVarsForMode } from '../../../theme/tokens';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import DraftGrades from '../index';

/**
 * draft-grades slice tests (T3). The card's content assertions (rank order,
 * Team names from teams[], the pick sentences, the 404/500 branches) live in
 * LeagueDashboardPage.test.jsx, which mounts this widget for real. What lives
 * here is what only a widget-local render can answer: which rules the table
 * actually emits, and which of them WINS.
 *
 * Every case renders under the real AppThemeProvider rather than a bare render.
 * That is the whole point of the file: this widget's viewer-row tint was
 * defeated in production by the app theme's own MuiTableBody override, and a
 * bare render (no theme, no overrides) is exactly the environment in which the
 * bug is invisible.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => {
  // The league read is a shared cached resource (ADR 0004) and is module state
  // that outlives a test, so it is cleared whole rather than per key.
  invalidate(undefined, { reload: false });
  // AppThemeProvider reads the system colour scheme on first render.
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

afterEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

const PENDING = Symbol('pending');

const mockGetByUrl = (map) => {
  apiClient.get.mockImplementation((url) => {
    const entry = map[url];
    if (entry === undefined) return Promise.reject(new Error(`unexpected GET ${url}`));
    if (entry === PENDING) return new Promise(() => {});
    if (entry.reject) return Promise.reject(entry.reject);
    return Promise.resolve(entry);
  });
};

const team = (teamId, teamName) => ({ teamId, id: teamId, teamName, name: `raw-${teamId}` });

const leagueResponse = (teams, viewerTeamId = 1) => ({
  data: {
    viewerTeamId,
    league: { id: 1, name: 'MinneApple', draft_status: 'complete' },
    teams,
  },
});

const gradeRow = (teamId, grade, adpNet, extra = {}) => ({
  teamId,
  name: `raw-${teamId}`,
  grade,
  adpNet,
  rosterValue: null,
  steal: null,
  reach: null,
  pricedPicks: 9,
  ...extra,
});

const gradesResponse = (grades) => ({ data: { computedAt: '2026-09-01T00:00:00.000Z', grades } });

// Four Teams with the viewer (teamId 1) in the middle, so the viewer's row is
// neither the first nor the last and lands on an EVEN row: the app theme's
// zebra stripe is a :nth-of-type(even) rule, and a viewer sitting on an odd row
// would be tinted by accident rather than by this widget.
const FOUR_TEAMS = [
  team(2, 'Terrific T'),
  team(1, 'MyBallsHurts'),
  team(3, 'Nanagoat'),
  team(4, 'Bigpapa6'),
];

const FOUR_GRADES = [
  gradeRow(2, 'A', 161.2),
  gradeRow(1, 'C', 95.1, {
    steal: { playerId: 1, name: 'Bijan Robinson', pickNumber: 18, marketAdp: 3 },
    reach: { playerId: 2, name: 'Jake Elliott', pickNumber: 40, marketAdp: 120.5 },
  }),
  gradeRow(3, 'D', 26.9),
  gradeRow(4, 'F', -52.1),
];

const renderWidget = () => render(
  <AppThemeProvider>
    <DraftGrades leagueId={1} />
  </AppThemeProvider>
);

const emotionClass = (el) => Array.from(el.classList).find((c) => c.startsWith('css-'));

// An sx rule is neither laid out nor computed by jsdom, but emotion inserts
// every rule into `document.styleSheets` under the element's generated class
// (GameCenterPage.test.jsx reads its layout rules the same way). This gathers
// the declarations of every rule whose selector starts with that class, keyed
// by the selector's tail ('' for the element's own).
const rulesUnder = (el) => {
  const cls = emotionClass(el);
  const found = {};
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (!rule.selectorText || !rule.selectorText.startsWith(`.${cls}`)) return;
      const tail = rule.selectorText.slice(`.${cls}`.length).replace(/\s+/g, '');
      found[tail] = `${found[tail] || ''}${rule.style.cssText};`;
    });
  });
  return found;
};

// Emotion inserts through CSSOM here (the <style> tags carry no text), so a
// rule nested in an @media block is only reachable as a media rule's child.
const mediaRulesFor = (el) => {
  const cls = emotionClass(el);
  const out = [];
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (!rule.media || !rule.cssRules) return;
      Array.from(rule.cssRules).forEach((inner) => {
        if (!inner.selectorText || !inner.selectorText.startsWith(`.${cls}`)) return;
        out.push({
          media: rule.media.mediaText,
          selector: inner.selectorText,
          css: inner.style.cssText,
        });
      });
    });
  });
  return out;
};

// jsdom's getComputedStyle cannot answer "which background wins": it applies
// matching rules in document order with no regard for specificity, and it does
// not resolve `var()`. Since specificity is the entire mechanism of the defect
// this file guards (a theme override at (0,2,0) beating a widget's sx at
// (0,1,0)), the cascade is resolved here instead - every stylesheet rule that
// matches the element, ordered as a browser orders them, with the winner's
// custom property looked up in the mode's token table.
const specificity = (selector) => {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const elements = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 1e6 + classes * 1e3 + elements;
};

const resolveToken = (value, mode = 'light') => {
  const match = /^var\((--[\w-]+)\)$/.exec(String(value).trim());
  if (!match) return String(value).trim();
  return String(cssVarsForMode(mode)[match[1]] ?? '').trim();
};

const winningValue = (el, property) => {
  let best = null;
  let order = 0;
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      order += 1;
      // Only plain style rules: an @media block has no selectorText, and its
      // contents are conditional, so neither can be the unconditional winner.
      if (!rule.selectorText) return;
      const value = rule.style.getPropertyValue(property);
      if (!value) return;
      rule.selectorText.split(',').forEach((raw) => {
        const selector = raw.trim();
        let matched = false;
        try {
          matched = el.matches(selector);
        } catch (err) {
          matched = false;
        }
        if (!matched) return;
        const important = rule.style.getPropertyPriority(property) === 'important' ? 1 : 0;
        const rank = [important, specificity(selector), order];
        if (!best || rank[0] > best.rank[0]
          || (rank[0] === best.rank[0] && rank[1] > best.rank[1])
          || (rank[0] === best.rank[0] && rank[1] === best.rank[1] && rank[2] > best.rank[2])) {
          best = { rank, value };
        }
      });
    });
  });
  return best ? resolveToken(best.value) : null;
};

// --- the table's own generation -------------------------------------------

test('viewer row paints the accent tint, not the app zebra', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(FOUR_TEAMS),
    '/api/league/1/draft-grades': gradesResponse(FOUR_GRADES),
  });
  renderWidget();

  const card = await screen.findByTestId('draft-grades');
  const viewerRow = await within(card).findByTestId('draft-grades-row-1');

  // The claim itself: with the cascade resolved the way a browser resolves it,
  // the rule that wins the viewer row's background is this widget's own tint,
  // not the theme's `surface`/`row-stripe` row painting.
  const accentSoft = cssVarsForMode('light')['--dash-accent-soft'];
  expect(accentSoft).toBeTruthy();
  expect(winningValue(viewerRow, 'background-color')).toBe(accentSoft);
  expect(winningValue(viewerRow, 'background-color')).not.toBe(cssVarsForMode('light')['--surface']);
  expect(winningValue(viewerRow, 'background-color')).not.toBe(cssVarsForMode('light')['--row-stripe']);

  // The same claim from the other end: this is not a MUI table. Every MUI table
  // class is what carries the theme overrides that defeated the tint, so their
  // absence is the mechanism, and the assertion above is the effect.
  /* eslint-disable testing-library/no-node-access -- the claim is that these
     four classes are ABSENT, and a class that must not exist has no role,
     label or text for a Testing Library query to ask after. The class is the
     subject here, not an implementation detail reached through. */
  expect(card.querySelector('.MuiTable-root')).toBeNull();
  expect(card.querySelector('.MuiTableBody-root')).toBeNull();
  expect(card.querySelector('.MuiTableRow-root')).toBeNull();
  expect(card.querySelector('.MuiTableCell-root')).toBeNull();
  /* eslint-enable testing-library/no-node-access */

  // The tint and the inset bar are one marker and must paint together: the bar
  // alone is what production shipped, because box-shadow is the one property
  // the theme's row override does not set.
  expect(rulesUnder(viewerRow)['']).toMatch(/box-shadow: *inset 3px 0 0 var\(--dash-accent\)/);
  expect(viewerRow).toHaveAttribute('data-viewer-team', 'true');
});

test('a non-viewer row hovers to surface3, on a real pointer only', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(FOUR_TEAMS),
    '/api/league/1/draft-grades': gradesResponse(FOUR_GRADES),
  });
  renderWidget();

  const card = await screen.findByTestId('draft-grades');
  const otherRow = await within(card).findByTestId('draft-grades-row-2');
  const viewerRow = within(card).getByTestId('draft-grades-row-1');

  // The hover rule sits inside an @media block, so it is read out of the media
  // rules rather than through the flat per-class map above.
  const hoverRules = mediaRulesFor(otherRow);
  expect(hoverRules).toHaveLength(1);
  expect(hoverRules[0].media).toMatch(/hover: *hover/);
  expect(hoverRules[0].selector).toBe(`.${emotionClass(otherRow)}:hover`);
  // surface3, not surface2: surface2 is the tier standings marks the viewer's
  // own row with, so hovering another row must not imitate it.
  expect(hoverRules[0].css).toMatch(/background-color: *var\(--dash-surface3\)/);
  expect(hoverRules[0].css).not.toMatch(/--dash-surface2/);
  expect(rulesUnder(otherRow)['']).toMatch(
    /transition: *background-color var\(--transition-fast\) ease/
  );
  // The viewer's own row does not answer the pointer at all: its tint is an
  // identity, not a state.
  expect(mediaRulesFor(viewerRow)).toHaveLength(0);
});

// --- zero minimums are paired with a clip ---------------------------------

test('a long Team name and a long pick line clip instead of widening the card', async () => {
  const longName = 'A'.repeat(120);
  mockGetByUrl({
    '/api/league/1': leagueResponse([team(1, longName), team(2, 'Terrific T')]),
    '/api/league/1/draft-grades': gradesResponse([
      gradeRow(1, 'C', 95.1, {
        steal: { playerId: 1, name: 'Bijan Robinson', pickNumber: 18, marketAdp: 3 },
        reach: { playerId: 2, name: 'Jake Elliott', pickNumber: 40, marketAdp: 120.5 },
      }),
      gradeRow(2, 'A', 161.2),
    ]),
  });
  renderWidget();

  const card = await screen.findByTestId('draft-grades');
  const viewerRow = await within(card).findByTestId('draft-grades-row-1');

  const nameSpan = within(viewerRow).getByText(longName);
  const nameRules = rulesUnder(nameSpan)[''];
  expect(nameRules).toMatch(/min-width: *0/);
  expect(nameRules).toMatch(/overflow: *hidden/);
  expect(nameRules).toMatch(/text-overflow: *ellipsis/);
  expect(nameRules).toMatch(/white-space: *nowrap/);

  // The pick line is the card's tallest element after a draft: two lines, then
  // ellipsis.
  const pickLine = within(viewerRow).getByTestId('draft-grades-picks');
  const pickRules = rulesUnder(pickLine)[''];
  expect(pickRules).toMatch(/-webkit-line-clamp: *2/);
  expect(pickRules).toMatch(/-webkit-box-orient: *vertical/);
  expect(pickRules).toMatch(/overflow: *hidden/);

  // The table pans inside its own scroller rather than widening the rail.
  const scroller = within(card).getByTestId('draft-grades-scroll');
  expect(rulesUnder(scroller)['']).toMatch(/overflow-x: *auto/);
});

// --- the placeholder holds the shape of the real table --------------------

test.each([
  [4, FOUR_TEAMS],
  [12, Array.from({ length: 12 }, (_, i) => team(i + 1, `Team ${i + 1}`))],
])('the loading placeholder renders one row per Team (%i)', async (count, teams) => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(teams),
    '/api/league/1/draft-grades': PENDING,
  });
  renderWidget();

  const card = await screen.findByTestId('draft-grades');
  expect(card).toHaveAttribute('aria-busy', 'true');
  // The placeholder table is aria-hidden (the Card announces the busy state),
  // so its rows are counted as elements rather than through a role query.
  await screen.findAllByTestId('draft-grades-skeleton');
  /* eslint-disable testing-library/no-node-access -- the rows under test are
     aria-hidden, so they are deliberately absent from the accessibility tree
     that every Testing Library query walks. Counting elements is the only way
     to ask this question, and asking it is the point of the case. */
  expect(card.querySelectorAll('tr')).toHaveLength(count);
  // The placeholder row holds the shape of a loaded one, so the card does not
  // change height when the read lands: grade chip, name line, pick line, net.
  const firstRow = card.querySelector('tr');
  /* eslint-enable testing-library/no-node-access */
  expect(within(firstRow).getAllByTestId('draft-grades-skeleton')).toHaveLength(4);
});

// --- accessibility decisions that survive the rebuild ---------------------

test('the rebuilt table keeps the row header, the hidden column label and the explainer wiring', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(FOUR_TEAMS),
    '/api/league/1/draft-grades': gradesResponse(FOUR_GRADES),
  });
  renderWidget();

  const card = await screen.findByTestId('draft-grades');
  const rows = await within(card).findAllByRole('row');
  expect(rows).toHaveLength(4);

  const viewerRow = within(card).getByTestId('draft-grades-row-1');
  expect(within(viewerRow).getByRole('rowheader')).toHaveTextContent('MyBallsHurts');
  // The number cell carries its own column label, since the table has no
  // header row to supply one.
  expect(within(viewerRow).getByTestId('draft-grades-net')).toHaveTextContent(
    /^Net vs ADP \+95\.1$/
  );

  const table = within(card).getByRole('table', { name: 'Draft grades by Team' });
  const explainer = within(card).getByTestId('draft-grades-explainer');
  expect(table).toHaveAttribute('aria-describedby', explainer.id);
});
