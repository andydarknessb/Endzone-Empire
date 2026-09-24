# Waivers joins the island

Status: accepted (2026-09-24)

ADR 0031 moved Game Center and Matchup Detail into the local Feature-Sliced
Design island, ADR 0037 moved Lineup and ADR 0038 moved Pick'em. The Waivers
page (`src/components/WaiverWire`) is the one weekly decision surface still
outside it, on the app tokens and MUI's Inter ramp. The 2026-09-24 UI/UX QA
and redesign (design canvas under `docs/design/waivers/`, artifact
HP3t3DSGo7EjmKxCBBwbyM) found it builds a second player list of its own beside
the Players page: it sorts by Upgrade inside the 25 rows it holds while the
server can sort all 3,500, it offers no search or position filter although the
read accepts both, it renders table rows on a phone where the Players page
renders cards, and it never says when a claim will resolve or what the
winning bid was.

We decide that the island now covers the Waivers page, and that the page holds
no player list of its own. It becomes a page slice (`src/pages/waivers`) on
the existing `/league/:leagueId/waivers` route, composed from the slices
below. ADR 0020's import rules and ADR 0029's entity rules bind unchanged. The
old folder is deleted with its tests; there is no shim.

The slices, in the order the spec's tickets deliver them:

- Widget `player-pool`: the Players page's list lifted out of
  `src/components/PlayerManagement` (search, position chips, bye-week filter,
  the server-side sort, the pager, `player-row` in its row and card
  variants), taking its Availability as an optional lock. The Players page
  consumes it unlocked; the Waivers page locks it to on waivers. One list, one
  read, one set of URL params.
- Entity `waiver-claim`: the manager's claims as the client knows them.
  Pending claims in Claim order, the shared-drop pairs among them, each
  resolved claim's result line, and the earliest Clear time among the pending
  ones. Pure, importing `shared` only.
- Widgets `waiver-summary` (the strip: next Clear time, FAAB left after
  pending bids or Waiver priority, roster count and whether a drop is
  required) and `waiver-claims` (pending claims and results). `bye-cluster`
  is reused from Lineup unchanged.
- Features: `claim-player` grows the claim sheet (a swap preview from the
  row's Upgrade, drop choices worst projection first with the replaced starter
  preselected, a bid with $1 and Max shortcuts); `manage-claim` holds move,
  edit and cancel, cancel with an Undo toast that puts the claim back at its
  old Claim order position.
- Page `waivers`: the list and the claims side by side from `md` up, and on a
  phone two tabs, On waivers and My claims, held in `?tab=`.

Rulings recorded in the grilling that shape the slices:

- The countdown is the earliest Clear time among the manager's own pending
  claims, and the league's blanket clear time while one is running. Claims
  resolve player by player, so no copy may say "claims process at" a single
  time.
- The Winning bid and the team that won are stored on every resolved claim of
  that player and shown league-wide, on the claim results and in the
  transaction log. Losing bids are never shown to other managers. Claims
  resolved before the columns exist show no winner.
- A resolved claim reads Won, Lost (to the named team, at the Winning bid) or
  Didn't go through (with the stored reason). Cancelled claims are not
  results. `invalid` is never shown as a word.
- Two pending claims that name the same drop player each carry the same
  neutral warning that only one can go through. The page never predicts which:
  ADR 0048's order is bid first, and each claim resolves at its own player's
  Clear time.
- The percentage column is Ownership (ADR 0041) and stays hidden until #1308
  fills it. Nothing on the page counts other managers' pending claims.
- No bid suggestion. There is no data to base one on yet; the Winning bid is
  the first step towards one, under a later spec.
- The expanded row carries the swap, Rest of season, the Clear time and News,
  and links to the Decision card. Usage and anything else about the player
  stay on the Decision card (ADR 0040), not in the row.
- The filters are the Players page's own. Upgrade high to low is the default
  sort, except in best ball, where Upgrade is undefined.

Consequences: a fifth surface on the `dash-*` tokens, Barlow Condensed and
Archivo; the Players page's list moves into the island a step ahead of the
page itself, which stays under `src/components` for now; two nullable columns
on `waiver_claims` and a larger `myClaims` shape on `GET /api/waivers`; and a
transaction log line that names the Winning bid.
