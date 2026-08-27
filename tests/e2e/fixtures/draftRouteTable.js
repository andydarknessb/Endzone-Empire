// The Draft E2E harness's REST coverage, declared as data (issue #474,
// ADR 0014). Every call the harness answers is one entry here carrying its
// HTTP method, a path pattern with :param segments, and a pure `respond`
// function; the Playwright `page.route` handler in draftHarness.ts dispatches
// from this table and records anything that falls through. The static
// coverage guard (scripts/checkDraftHarnessCoverage.js) imports the same
// table, so the description and the behaviour cannot drift apart -- a second
// list describing the handler would be the original defect one level down.
//
// This module is deliberately plain CommonJS with no Playwright import, so the
// `node --test` guard can `require` it without a browser. `respond(ctx)` is a
// pure function of its context and returns `{ status, body }`; the harness
// translates that into a `route.fulfill`. State the responders read (the
// fixture's players, picks, league, viewer team, and the mutable draft queue)
// arrives on `ctx.state`, never captured from an enclosing closure, which is
// what keeps the table a static value the guard can read.

/**
 * Splits a path (or pattern) into its segments, dropping the leading slash and
 * any empty trailing segment. `/api/players` -> ['api', 'players'].
 */
function segments(pathOrPattern) {
  return pathOrPattern.split('/').filter((s) => s.length > 0);
}

/**
 * Matches a concrete request path against a pattern whose `:name` segments are
 * wildcards. Returns the captured params (`{ id: '1' }`) on a match, or null.
 * Anchored end to end: `/api/league/:id` does not match `/api/league/1/chat`.
 */
function matchPattern(pattern, path) {
  const pat = segments(pattern);
  const seg = segments(path);
  if (pat.length !== seg.length) return null;
  const params = {};
  for (let i = 0; i < pat.length; i += 1) {
    if (pat[i].startsWith(':')) {
      params[pat[i].slice(1)] = seg[i];
    } else if (pat[i] !== seg[i]) {
      return null;
    }
  }
  return params;
}

/**
 * The canonical form used to COMPARE two patterns regardless of how their
 * parameter segments are named: every `:name` becomes `:param`, and any query
 * string is dropped. The table writes readable names (`:id`, `:teamId`) while
 * the guard emits `:param` for each `${...}`; canonicalising both sides lets
 * them compare by string equality without forcing either to the other's
 * spelling.
 */
function canonicalPattern(pattern) {
  const withoutQuery = pattern.split('?')[0];
  return (
    '/' +
    segments(withoutQuery)
      .map((s) => (s.startsWith(':') ? ':param' : s))
      .join('/')
  );
}

/**
 * First table entry whose method matches and whose pattern matches `path`.
 * Returns `{ entry, params }` or null. Order matters only for genuinely
 * overlapping patterns; today none overlap.
 */
function findRoute(table, method, path) {
  for (const entry of table) {
    if (entry.method !== method) continue;
    const params = matchPattern(entry.pattern, path);
    if (params) return { entry, params };
  }
  return null;
}

// Nulls sort last regardless of direction: `dir` only flips the ordering of
// the non-null values (folded into the comparator itself, not a post-hoc
// `.reverse()` of the whole array -- reversing would also flip the nulls to
// the front on a descending sort). Ported verbatim from the original harness.
function sortPlayers(list, sort, dir) {
  const key = sort;
  const direction = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return direction * av.localeCompare(bv);
    return direction * (av - bv);
  });
}

// The route table. Each `respond(ctx)` reads only `ctx.params`, `ctx.query`
// (a URLSearchParams), `ctx.body` (the parsed request body), and `ctx.state`,
// and returns `{ status, body }`. The bodies match the original hand-written
// harness handlers exactly, so both Draft E2E specs pass with no edits.
const routeTable = [
  // --- Shell chrome the Draft page renders around the room. Answered here so
  // the page boots; deliberately OUTSIDE the Draft room's own call closure
  // (ADR 0014), so the guard does not enumerate them. ---
  {
    method: 'GET',
    pattern: '/api/user',
    respond: (ctx) => ({ status: 200, body: ctx.state.user }),
  },
  {
    method: 'GET',
    pattern: '/api/notifications',
    respond: () => ({ status: 200, body: { notifications: [], unread: 0 } }),
  },

  // viewerTeamId sits at the response root, which is the per-viewer channel
  // league detail has (#113, contract #112).
  {
    method: 'GET',
    pattern: '/api/league/:id',
    respond: (ctx) => ({
      status: 200,
      body: { viewerTeamId: ctx.state.myTeamId, league: ctx.state.league, teams: [] },
    }),
  },

  // The Draft room reads the combined Chat + Draft-activity feed (#435), then
  // marks visible Chat read (#433). An empty feed is the honest default: it
  // adds no feed DOM to a Draft test that did not ask for any and leaves each
  // existing Draft assertion focused on its own fixture.
  {
    method: 'GET',
    pattern: '/api/league/:id/draft-feed',
    respond: () => ({ status: 200, body: [] }),
  },
  {
    method: 'GET',
    pattern: '/api/league/:id/chat',
    respond: () => ({ status: 200, body: [] }),
  },
  {
    method: 'GET',
    pattern: '/api/league/:id/chat/unread',
    respond: () => ({ status: 200, body: { unread: 0 } }),
  },
  {
    method: 'POST',
    pattern: '/api/league/:id/chat/read',
    respond: () => ({ status: 200, body: { ok: true } }),
  },

  // Commissioner content moderation from the Draft room (#482): the hide route
  // both the drawer and the Draft room post to (chatModeration.hidePost). The
  // durable hide and the live `chat:hidden` tombstone are the server's job; this
  // harness accepts the request so the room's hide flow is observable, and the
  // spec delivers `chat:hidden` to each page's fake socket to prove the live
  // rewrite. The static coverage guard demands this entry because hidePost is in
  // the Draft room's import closure (ADR 0014).
  {
    method: 'POST',
    pattern: '/api/safety/hide',
    respond: () => ({ status: 200, body: { ok: true } }),
  },

  {
    method: 'GET',
    pattern: '/api/players',
    respond: (ctx) => {
      const params = ctx.query;
      const players = ctx.state.players;
      const draftedIds = ctx.state.draftedIds;
      const position = params.get('position');
      const search = (params.get('search') || '').toLowerCase();
      const available = params.get('available') === 'true';
      const sort = params.get('sort') || 'adp';
      const dir = params.get('dir') || 'asc';

      let list = players.filter((p) => (!position || position === 'All' ? true : p.position === position));
      if (search) list = list.filter((p) => p.name.toLowerCase().includes(search));
      if (available) list = list.filter((p) => !draftedIds.has(p.id));
      // Bye-weeks filter (multi-select, issue #119): applied here, before
      // sorting/pagination, across the WHOLE matching pool -- the harness has
      // no separate page to short-cut, same as the real server.
      const byeWeeksParam = params.get('byeWeeks');
      if (byeWeeksParam) {
        const weeks = new Set(byeWeeksParam.split(',').map(Number));
        list = list.filter((p) => p.bye_week != null && weeks.has(p.bye_week));
      }
      list = sortPlayers(list, sort, dir);

      return { status: 200, body: { players: list, totalPages: 1 } };
    },
  },

  {
    method: 'GET',
    pattern: '/api/players/:id/summary',
    respond: (ctx) => {
      const id = Number(ctx.params.id);
      const player = ctx.state.players.find((p) => p.id === id) || null;
      return { status: 200, body: { player, fantasy: {}, currentSeason: null, previousSeasons: [] } };
    },
  },

  // Feeds only the pool's Bye overlap hint (useMyRoster.js) -- every rostered
  // player this fixture's viewer (FIXTURE_USER, team `myTeamId`) already holds,
  // with the same bye_week each player carries in the pool response.
  {
    method: 'GET',
    pattern: '/api/team/roster',
    respond: (ctx) => {
      const { picks, myTeamId, players } = ctx.state;
      const roster = picks
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
      return { status: 200, body: roster };
    },
  },

  {
    method: 'GET',
    pattern: '/api/draft/queue',
    respond: (ctx) => ({ status: 200, body: ctx.state.queue }),
  },
  {
    method: 'PUT',
    pattern: '/api/draft/queue',
    respond: (ctx) => {
      const body = ctx.body;
      ctx.state.handle.queueWrites.push(body);
      const idsInOrder = body.playerIds;
      ctx.state.queue = idsInOrder
        .map((id) => ctx.state.players.find((p) => p.id === id) || ctx.state.queue.find((p) => p.id === id))
        .filter((p) => !!p);
      return { status: 200, body: { updated: ctx.state.queue.length } };
    },
  },
];

// Declared gaps in the Draft room's call closure, grouped one reason per
// source file (relative to src/). A group serves two roles, so the guard reads
// the closure without either a false alarm or a silent hole (ADR 0014):
//
//   1. It lists the literal /api/ paths the harness deliberately does NOT
//      answer (calls the room makes on a click no E2E test performs). Every
//      such literal in the file must appear in `paths`, so an ELEVENTH call
//      added to the file still fails the guard with its own path named rather
//      than being waved through by the file's presence here.
//   2. It acknowledges that the file may make NON-literal api-client calls
//      (a caller-supplied URL, not a Draft-room endpoint literal). Outside a
//      declared file the guard fails on any non-literal call; a declared file
//      is the audited place to say "this indirection is known and is not a
//      Draft-room endpoint."
//
// Paths use the same :param spelling as the table; the guard compares
// canonically (every parameter segment folds to :param), so the names need not
// match a call's own variable names.
const unstubbed = [
  {
    file: 'components/DraftBoard/useDraftAdmin.js',
    reason:
      'Commissioner-only draft controls that fire on a click; no Draft E2E ' +
      'test performs those clicks, so the harness answers none of them. When ' +
      'a test does, move the endpoint into the route table with a driven ' +
      'fixture (ADR 0014).',
    paths: [
      { method: 'POST', pattern: '/api/draft/league/:id/order' },
      { method: 'POST', pattern: '/api/draft/league/:id/pause' },
      { method: 'POST', pattern: '/api/draft/league/:id/teams/:teamId/autodraft' },
      { method: 'POST', pattern: '/api/draft/league/:id/clock' },
      { method: 'POST', pattern: '/api/draft/league/:id/correct-pick' },
      { method: 'POST', pattern: '/api/draft/league/:id/reset' },
      { method: 'POST', pattern: '/api/draft/league/:id/ready' },
      { method: 'POST', pattern: '/api/draft/league/:id/share-token' },
      { method: 'PUT', pattern: '/api/league/:id' },
    ],
  },
  {
    // Generic resource-cache fetcher. It enters the Draft room closure only
    // through clearLeagueCache (a cache-invalidation export of useLeague.js
    // that never fetches); the useLeague() hook that would drive a real GET is
    // never called in the room. Its one api-client call is `apiClient.get(
    // urlRef.current)` -- a caller-supplied URL, not a Draft-room endpoint
    // literal, so there is no pattern to stub. Declared so the guard reads this
    // library indirection as acknowledged rather than as an unseen endpoint.
    // NB: the issue #474 brief assumed every call in the closure was a literal;
    // this one is not, and this declaration is where that gap is recorded.
    file: 'hooks/useResource.js',
    reason:
      'Generic resource-cache fetcher reached only via clearLeagueCache, which ' +
      'never fetches. Its apiClient.get(url) takes a caller-supplied URL, not a ' +
      'Draft-room endpoint literal; there is nothing to stub.',
    paths: [],
  },
];

module.exports = {
  routeTable,
  unstubbed,
  matchPattern,
  canonicalPattern,
  findRoute,
  segments,
};
