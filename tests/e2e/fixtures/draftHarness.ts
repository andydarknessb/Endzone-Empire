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
// The REST coverage is declared as data (issue #474, ADR 0014). This handler
// dispatches from the same route table the static coverage guard imports, so
// the description and the behaviour cannot drift apart.
import { routeTable, findRoute } from './draftRouteTable';

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
  /**
   * Whether the server has enabled GIF messages for this league room (#516),
   * answered on the same per-viewer `draft:join` ack as `isCommissioner` and
   * for the same reason. Defaults to false, the production answer: the composer
   * stays absent until this is explicitly true. Setting it true introduces no
   * provider, key or network request - the picker is a set of local text
   * fields, and no client provider is registered in a real build, so Send stays
   * disabled and nothing outbound is issued (issue #516; the AC7 fence proving
   * no provider network request, upheld by #446).
   */
  gifMessagesEnabled?: boolean;
  /**
   * When set, `draft:join` acknowledges this refusal ({ error, code }) instead
   * of a success ack, and pushes NO `draft:state` snapshot - exactly the shape
   * server/modules/draftSocket.js sends a viewer who holds no Team in the
   * league (#230, ADR 0008). Defaults absent: the room joins normally. This is
   * the seam a blocked / non-member (`NOT_A_MEMBER`) session is driven through
   * (#447 AC2); see useDraftSocket.js, which reads `code` to decide whether the
   * viewer-relative values survive the refusal.
   */
  joinRefusal?: { error: string; code?: string } | null;
  /**
   * When set, `chat:send` acknowledges this refusal instead of accepting the
   * send, mirroring the real server refusals in draftSocket.js: a rate-limited
   * sender gets `{ error, code: 'RATE_LIMITED', retryAfterSeconds }` (#440 AC5)
   * and a manager removed after joining gets `{ error, code: 'NOT_A_MEMBER' }`
   * (#447 AC3/AC2). On any refusal the composer keeps its text (ChatConversation
   * clears only on a successful ack), which is what these specs assert. Defaults
   * absent: a send is accepted with `ack({})`, the existing behaviour.
   */
  chatSendRefusal?: { error: string; code?: string; retryAfterSeconds?: number } | null;
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
            // A refused join (#447 AC2): acknowledge { error, code } and push no
            // snapshot, exactly as draftSocket.js does for a viewer holding no
            // Team. The client (useDraftSocket) branches on the code.
            if (initialState.joinRefusal) {
              if (typeof ack === 'function') {
                ack({ error: initialState.joinRefusal.error, code: initialState.joinRefusal.code });
              }
              return;
            }
            // The server answers the acknowledgement BEFORE the first
            // snapshot, so the client knows its own Team before it holds any
            // Team identity to compare against. The snapshot itself carries
            // no viewer-relative field, exactly as the broadcast does not.
            if (typeof ack === 'function') {
              ack({
                ok: true,
                viewerTeamId: initialState.viewerTeamId ?? null,
                isCommissioner: initialState.isCommissioner === true,
                // The GIF-message capability (#516) rides the same ack, read
                // strictly === true by the client, so a scenario that omits it
                // gets the production answer (absent -> off) and no composer.
                gifMessagesEnabled: initialState.gifMessagesEnabled === true,
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
          if (event === 'chat:send') {
            // A refused send (#447 AC3/AC2): acknowledge the refusal so the
            // composer keeps its text (it clears only on a successful ack). This
            // mirrors the server's rate-limit and removed-member refusals.
            if (initialState.chatSendRefusal) {
              if (typeof ack === 'function') {
                ack({
                  error: initialState.chatSendRefusal.error,
                  code: initialState.chatSendRefusal.code,
                  retryAfterSeconds: initialState.chatSendRefusal.retryAfterSeconds,
                });
              }
              return;
            }
            // The composer clears only on a successful ack (#442/#443). The
            // harness accepts the send so that clear-on-send is observable; it
            // does not broadcast the message back (no live feed is simulated).
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

      // Injection hook (#482): a spec can deliver a server-pushed event into
      // THIS page's fake socket, the way a real broadcast would arrive. The
      // harness simulates no live feed of its own, so a multi-client test drives
      // the fan-out itself - hiding on one page, then delivering `chat:hidden`
      // to every page's socket to prove each live-tombstones without navigating.
      // The latest draft socket wins (the room mints one per league); that is
      // the connection a test acts on.
      (window as unknown as { __ENDZONE_DRAFT_DELIVER__: (event: string, payload?: unknown) => void })
        .__ENDZONE_DRAFT_DELIVER__ = (event: string, payload?: unknown) => fire(event, payload);

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
  /**
   * Every request the route table did not answer, as `METHOD /path`, in
   * arrival order (issue #474). The 500 fallthrough still fires; this list is
   * what turns it into a named failure. The shared `test` fixture's teardown
   * fails when it is non-empty, so a missing harness entry surfaces as the
   * concrete endpoint rather than a bare console 500. Specs may also read it.
   */
  unmocked: string[];
};

// The teardown in the shared `test` fixture asserts the unmocked list is empty,
// but the handle is created per-test inside installDraftRestApi and not
// threaded through every test signature. Each install records its page's list
// here so the teardown can find it by the page it is tearing down.
const unmockedByPage = new WeakMap<Page, string[]>();

/**
 * Installs the one REST seam every request from the Draft route (and the
 * surrounding Nav chrome) goes through. It dispatches from the shared route
 * table (tests/e2e/fixtures/draftRouteTable.js, the same table the static
 * coverage guard reads), and anything the table does not answer is both
 * recorded on `handle.unmocked` and failed with a 500 `unexpected mocked
 * request` body instead of ever reaching a real network, matching the
 * convention already established in tests/e2e/auth-offline.spec.ts.
 */
export async function installDraftRestApi(page: Page, opts: DraftApiOptions): Promise<DraftApiHandle> {
  const user = opts.user || FIXTURE_USER;
  const players = opts.players || FIXTURE_PLAYERS;
  const myTeamId = opts.myTeamId ?? VIEWER_TEAM_ID;
  const draftedIds = new Set(opts.picks.map((p) => p.player_id));
  const handle: DraftApiHandle = { queueWrites: [], unmocked: [] };
  unmockedByPage.set(page, handle.unmocked);

  // Per-test mutable state the pure responders read through `ctx.state`. The
  // draft queue is reassigned by the PUT /api/draft/queue responder, so it
  // lives on this object rather than in a captured local.
  const state = {
    user,
    players,
    league: opts.league,
    myTeamId,
    picks: opts.picks,
    draftedIds,
    queue: [...(opts.initialQueue || [])] as FixturePlayer[],
    handle,
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    const match = findRoute(routeTable, method, path);
    if (!match) {
      handle.unmocked.push(`${method} ${path}`);
      return json(route, 500, { error: `unexpected mocked request in draft harness: ${method} ${path}` });
    }

    let body: any;
    try {
      body = request.postDataJSON();
    } catch {
      body = undefined;
    }

    const result = match.entry.respond({
      params: match.params,
      query: url.searchParams,
      method,
      path,
      body,
      state,
    });
    return json(route, result.status, result.body);
  });

  return handle;
}

/**
 * Playwright's `test`, extended so every test using it automatically fails if
 * the page logs a console error or throws an uncaught page error, OR if the
 * Draft room called an endpoint the harness route table does not answer
 * (issue #474). No test needs to opt in; both assertions run in this fixture's
 * teardown after the test body returns. The unmocked-endpoint assertion runs
 * first because it names the exact `METHOD /path`, where a fallthrough 500
 * otherwise reaches the console only as a bare "Failed to load resource: 500".
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

    const unmocked = unmockedByPage.get(page) || [];
    unmockedByPage.delete(page);
    expect(
      unmocked,
      `the Draft room called endpoints the harness route table does not answer ` +
        `(issue #474). Add an entry to tests/e2e/fixtures/draftRouteTable.js with a ` +
        `driven fixture, or declare it in \`unstubbed\`:\n${unmocked.join('\n')}`
    ).toEqual([]);
    expect(errors, `browser console/page errors were logged:\n${errors.join('\n')}`).toEqual([]);
  },
});

export async function gotoDraft(page: Page, leagueId: number = FIXTURE_LEAGUE_ID) {
  await page.goto(`/#/league/${leagueId}/draft`);
}
