# Lineup-lock timeline test blueprint

## Boundary under test

- Player A starts in `FLEX`; kickoff is `13:00:00 UTC`.
- Player B remains on `BENCH`; kickoff is later that day.
- `12:59:59`: the two-player swap succeeds.
- `13:00:00`: Player A is locked because kickoff comparisons are inclusive.
- `13:00:01`: the swap is rejected atomically with HTTP `409` and `LINEUP_LOCKED`.
- `13:01:00`: only Player A's NFL team is locked; dropping Player B still succeeds.

## Isolation model

- Jest modern fake timers control the application-server clock.
- Supertest invokes the in-memory Express router; it does not contact a deployed server.
- The PostgreSQL pool is replaced by a stateful in-memory query fixture.
- Global `fetch` fails closed and must remain unused.
- No Tank01, Supabase, WebSocket, or production database connection is created.

## Assertions

- The kickoff query receives the fake server timestamp as a bound `timestamptz` parameter.
- A rejected swap leaves both lineup slots unchanged and rolls back the transaction.
- The error response is `{ error: "LINEUP_LOCKED", message: "that player is locked — his game has started" }`.
- Player B is absent from the locked-team set at `13:01:00` and can be dropped normally.
- The successful drop removes Player B, creates the waiver hold, and writes the drop transaction.

## Run

```powershell
npm test -- --runTestsByPath src/lib/lineupLockTimeline.integration.test.js
```
