// Deterministic DraftBoard browser harness (issue #110, parent spec #108).
//
// Everything the authenticated Draft route (src/components/DraftBoard) can
// touch over the network is controlled here:
//   - REST: a single `page.route('**/api/**', ...)` handler answers every
//     request from fixture data, and fails loudly (500) on anything it
//     doesn't recognise, exactly like tests/e2e/auth-offline.spec.ts already
//     does for the auth flows.
//   - Socket.IO: `src/api/socket.js` checks for a
//     `window.__ENDZONE_TEST_SOCKET_FACTORY__` global before ever calling
//     socket.io-client's `io()`. This harness installs that global via
//     `page.addInitScript`, so no draft-room socket connection is ever
//     attempted against a real server - it's a page-local fake that answers
//     `draft:join` with a scripted `draft:state` snapshot.
//
// Nothing here can reach a live league, the shared Supabase database, or the
// Tank01 API: both channels are intercepted before they leave the page.
import { test as base, expect, type Page } from '@playwright/test';
import { FIXTURE_USER, FIXTURE_LEAGUE_ID, FIXTURE_PLAYERS, VIEWER_TEAM_ID, type FixturePlayer, type FixtureTeam, type FixturePick } from './draftFixtures';
import { json } from './jsonRoute';

export { expect };

// `desktop` and `mobile` straddle MUI's `sm` (600px) breakpoint that
// `useMediaQuery(theme.breakpoints.down('sm'))` (DraftBoard's isXs switch)
// resolves against. `tablet` and `wide` add the medium breakpoint (900px)
// straddle that DraftBoard's own desktop-shell/mobile-tabs switch uses
// (issue #122) - all four are the widths its acceptance criteria name for
// browser evidence, comfortably clear of both breakpoints in each direction.
export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 900 },
  wide: { width: 1920, height: 1080 },
} as const;

export type ThemeMode = 'light' | 'dark';

/** Seeds the theme the app boots with (read synchronously by AppThemeProvider's `initialMode()`). */
export async function setTheme(page: Page, mode: ThemeMode) {
  await page.addInitScript((m) => {
    try {
      window.localStorage.setItem('endzone_theme', m);
    } catch (err) {
      // storage unavailable (e.g. a locked-down context) - the app falls
      // back to prefers-color-scheme, which is fine for this harness.
    }
  }, mode);
}

export type DraftSocketState = {
  league: Record<string, unknown>;
  teams: FixtureTeam[];
  picks: FixturePick[];
  onTheClock: FixtureTeam | null;
  /**
   * The Team this viewer holds, as the `draft:join` acknowledgement answers
   * it. Defaults to the harness viewer's own Team; pass null for a viewer
   * with no team in this league. It rides ONLY on the ack, never on the
   * `draft:state` snapshot below, because that snapshot is broadcast to the
   * whole league room and no viewer-relative field on it could be true for
   * every recipient (#113, contract #112).
   */
  viewerTeamId?: number | null;
  /**
   * Whether the server has told this viewer they may act as commissioner of
   * this league (#178). Defaults to false, the answer for an ordinary
   * manager. It rides on the ack for the same reason `viewerTeamId` does,
   * and the Draft room reads nothing else to decide it: not the snapshot's
   * `owner_id`, not the signed-in account.
   */
  isCommissioner?: boolean;
};

/**
 * Installs the fake Socket.IO factory that `createDraftSocket()` (see
 * src/api/socket.js) picks up in place of a real `io()` connection. The fake
 * socket fires `connect` on the next tick, then on `draft:join` acks success
 * and pushes exactly the `draft:state` snapshot passed in here - the same
 * shape the real server sends on join (see useDraftSocket.js).
 *
 * `draft:pick` is intentionally a no-op ack: simulating a full server-side
 * pick (advancing the clock, updating the REST player pool in lockstep) is
 * out of scope for this harness - it establishes the deterministic seam,
 * not the live-pick flow (#108).
 */
export async function installDraftSocketHarness(page: Page, state: DraftSocketState) {
  const initial: DraftSocketState = { viewerTeamId: VIEWER_TEAM_ID, isCommissioner: false, ...state };
  await page.addInitScript((initialState) => {
    function createFakeDraftSocket() {
      const handlers: Record<string, Array<(payload?: unknown) => void>> = {};
      const managerHandlers: Record<string, Array<(payload?: unknown) => void>> = {};

      const on = (event: string, cb: (payload?: unknown) => void) => {
        (handlers[event] = handlers[event] || []).push(cb);
      };
      const off = (event: string, cb: (payload?: unknown) => void) => {
        handlers[event] = (handlers[event] || []).filter((h) => h !== cb);
      };
      const fire = (event: string, payload?: unknown) => {
        (handlers[event] || []).forEach((cb) => cb(payload));
      };

      const socket = {
        on,
        off,
        emit(event: string, payload: unknown, ack?: (resp: unknown) => void) {
          if (event === 'draft:join') {
            // The server answers the acknowledgement BEFORE the first
            // snapshot, so the client knows its own Team before it holds any
            // Team identity to compare against. The snapshot itself carries
            // no viewer-relative field, exactly as the broadcast does not.
            if (typeof ack === 'function') {
              ack({
                ok: true,
                viewerTeamId: initialState.viewerTeamId ?? null,
                isCommissioner: initialState.isCommissioner === true,
              });
            }
            setTimeout(() => {
              fire('draft:state', {
                league: initialState.league,
                teams: initialState.teams,
                picks: initialState.picks,
                onTheClock: initialState.onTheClock,
              });
            }, 0);
            return;
          }
          if (event === 'draft:pick') {
            // See doc comment above: this harness doesn't simulate a live
            // pick landing, only that the request was accepted.
            if (typeof ack === 'function') ack({});
          }
        },
        disconnect() {},
        io: {
          on: (event: string, cb: (payload?: unknown) => void) => {
            (managerHandlers[event] = managerHandlers[event] || []).push(cb);
          },
          off: (event: string, cb: (payload?: unknown) => void) => {
            managerHandlers[event] = (managerHandlers[event] || []).filter((h) => h !== cb);
          },
        },
      };

      setTimeout(() => fire('connect'), 0);
      return socket;
    }

    (window as unknown as { __ENDZONE_TEST_SOCKET_FACTORY__: unknown }).__ENDZONE_TEST_SOCKET_FACTORY__ =
      createFakeDraftSocket;
  }, initial);
}

export type DraftApiOptions = {
  user?: Record<string, unknown>;
  league: Record<string, unknown>;
  players?: FixturePlayer[];
  picks: FixturePick[];
  initialQueue?: FixturePlayer[];
  // The Team the harness viewer holds, for /api/team/roster below (the pool's
  // Bye overlap hint reads this) and for league detail's viewerTeamId. Every
  // fixture team list puts it first (FIXTURE_TEAMS[0], "Ridge Runners"), so
  // VIEWER_TEAM_ID is the default; override for a fixture that varies it.
  myTeamId?: number;
};

export type DraftApiHandle = {
  /** Every body PUT to /api/draft/queue, in call order. */
  queueWrites: Array<{ leagueId: number; playerIds: number[] }>;
};

/**
 * Installs the one REST seam every request from the Draft route (and the
 * surrounding Nav chrome) goes through. Anything not explicitly recognised
 * fails the request with a 500 `unexpected mocked request` body instead of
 * ever reaching a real network, matching the convention already established
 * in tests/e2e/auth-offline.spec.ts.
 */
export async function installDraftRestApi(page: Page, opts: DraftApiOptions): Promise<DraftApiHandle> {
  const user = opts.user || FIXTURE_USER;
  const players = opts.players || FIXTURE_PLAYERS;
  const myTeamId = opts.myTeamId ?? VIEWER_TEAM_ID;
  const draftedIds = new Set(opts.picks.map((p) => p.player_id));
  let queue: FixturePlayer[] = [...(opts.initialQueue || [])];
  const handle: DraftApiHandle = { queueWrites: [] };

  // Nulls sort last regardless of direction: `dir` only flips the ordering of
  // the non-null values (folded into the comparator itself, not a post-hoc
  // `.reverse()` of the whole array - reversing would also flip the nulls to
  // the front on a descending sort).
  const sortPlayers = (list: FixturePlayer[], sort: string, dir: string) => {
    const key = sort;
    const direction = dir === 'desc' ? -1 : 1;
    return [...list].sort((a: any, b: any) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return direction * av.localeCompare(bv);
      return direction * (av - bv);
    });
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/user') return json(route, 200, user);
    if (method === 'GET' && path === '/api/notifications') return json(route, 200, { notifications: [], unread: 0 });

    if (method === 'GET' && path === `/api/league/${opts.league.id}`) {
      // viewerTeamId sits at the response root, which is the per-viewer
      // channel league detail has (#113, contract #112).
      return json(route, 200, { viewerTeamId: myTeamId, league: opts.league, teams: [] });
    }

    if (method === 'GET' && path === '/api/players') {
      const params = url.searchParams;
      const position = params.get('position');
      const search = (params.get('search') || '').toLowerCase();
      const available = params.get('available') === 'true';
      const sort = params.get('sort') || 'adp';
      const dir = params.get('dir') || 'asc';

      let list = players.filter((p) => (!position || position === 'All' ? true : p.position === position));
      if (search) list = list.filter((p) => p.name.toLowerCase().includes(search));
      if (available) list = list.filter((p) => !draftedIds.has(p.id));
      // Bye-weeks filter (multi-select, issue #119): applied here, before
      // sorting/pagination, across the WHOLE matching pool - the harness has
      // no separate page to short-cut, same as the real server.
      const byeWeeksParam = params.get('byeWeeks');
      if (byeWeeksParam) {
        const weeks = new Set(byeWeeksParam.split(',').map(Number));
        list = list.filter((p) => p.bye_week != null && weeks.has(p.bye_week));
      }
      list = sortPlayers(list, sort, dir);

      return json(route, 200, { players: list, totalPages: 1 });
    }

    const summaryMatch = path.match(/^\/api\/players\/(\d+)\/summary$/);
    if (method === 'GET' && summaryMatch) {
      const id = Number(summaryMatch[1]);
      const player = players.find((p) => p.id === id) || null;
      return json(route, 200, { player, fantasy: {}, currentSeason: null, previousSeasons: [] });
    }

    // Feeds only the pool's Bye overlap hint (useMyRoster.js) — every rostered
    // player this fixture's viewer (FIXTURE_USER, team `myTeamId`) already
    // holds, with the same bye_week each player carries in the pool response.
    if (method === 'GET' && path === '/api/team/roster') {
      const roster = opts.picks
        .filter((p) => p.teamId === myTeamId)
        .map((p) => {
          const player = players.find((pl) => pl.id === p.player_id);
          return {
            id: p.player_id,
            name: p.name,
            position: p.position,
            nfl_team: p.nfl_team,
            bye_week: player ? player.bye_week : null,
          };
        });
      return json(route, 200, roster);
    }

    if (method === 'GET' && path === '/api/draft/queue') return json(route, 200, queue);
    if (method === 'PUT' && path === '/api/draft/queue') {
      const body = request.postDataJSON();
      handle.queueWrites.push(body);
      const idsInOrder: number[] = body.playerIds;
      queue = idsInOrder
        .map((id) => players.find((p) => p.id === id) || queue.find((p) => p.id === id))
        .filter((p): p is FixturePlayer => !!p);
      return json(route, 200, { updated: queue.length });
    }

    return json(route, 500, { error: `unexpected mocked request in draft harness: ${method} ${path}` });
  });

  return handle;
}

/**
 * Playwright's `test`, extended so every test using it automatically fails
 * if the page logs a console error or throws an uncaught page error -
 * acceptance criterion (5) for the harness. No test needs to opt in; the
 * assertion runs in this fixture's teardown after the test body returns.
 */
export const test = base.extend<{}>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err && err.stack ? err.stack : String(err)}`);
    });

    await use(page);

    expect(errors, `browser console/page errors were logged:\n${errors.join('\n')}`).toEqual([]);
  },
});

export async function gotoDraft(page: Page, leagueId: number = FIXTURE_LEAGUE_ID) {
  await page.goto(`/#/league/${leagueId}/draft`);
}
