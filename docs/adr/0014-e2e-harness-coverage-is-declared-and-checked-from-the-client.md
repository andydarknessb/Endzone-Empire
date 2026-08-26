# E2E harness coverage is declared as data and checked from the client's calls

Status: accepted (2026-08-26)

The Draft E2E harness answers REST calls from one catch-all route handler and
returns 500 for anything it does not recognise, which the clean-console
assertion turns into a failure in every test that renders the Draft room.
Twice (#433 / PR #463, #435 / PR #470) an endpoint reached the Draft room with
no harness entry; the second time after a brief naming the file, the
mechanism and the first occurrence. #474 adds a guard that fails in CI before
E2E runs. This ADR records the two shape decisions the guard rests on, because
both run against what a reader would assume from the issue's title.

## The guard reads the client's calls, not the server's routes

"A route with no harness entry" sounds like a comparison between Express
routers and the harness. It is not. The defect is "the Draft room calls
something its fake server does not answer", and the only faithful source of
what the Draft room calls is the Draft room: the API path literals in the
transitive import closure of its entry component. The two routers the Draft
room touches hold about forty routes of which it calls about thirteen, so a
router-side comparison starts life with a thirty-line exemption list, which
is how a guard becomes a nuisance and then gets disabled (#468).

The shell around the room (navigation, auth gate, notifications) is
deliberately outside the closure. Its render-time calls are exercised in CI
by the auth-offline E2E suite already, so a new one goes red there; the Draft
room has no such signal, which is why this guard exists.

## The harness's coverage is a table that drives the handler

The harness declares the method and path pattern of every call it answers,
and the handler dispatches from that declaration. The guard imports the same
table. A separate list describing the handler, or a regex over the handler's
source, would let the description and the behaviour drift apart, which is the
original defect one level down. Deliberate gaps (calls the room makes on a
click that no E2E test performs) are declared beside the table, grouped under
one reason per source file, each covered path listed, so an eleventh call in
an exempted file still fails with its path named.

## Two halves, because neither is enough alone

The #474 amendment proposed a runtime shape instead: the harness records
every request it falls through on, and the fixture teardown fails naming
the method and full path. That is right, and it is built too. It fires
where the gap manifests and sees everything, shell calls and dynamic paths
included; but it fires only when the Draft E2E suites run, and they are not
CI gates (#478), so on its own its only consumer is a person running the
suite locally, which ADR 0010 calls unaudited. The static guard fires in
CI on every PR but sees only the literal calls in the closure. Each closes
the other's hole, and the amendment's objection to source-scraping
(brittleness) is met by the guard failing on any non-literal call and on a
zero count rather than passing green for the wrong reason.

## Consequences

- An endpoint that enters the Draft room's closure lands with a harness entry
  or a listed exemption, in the same PR, or the `guards` job is red.
- The guard is honest only while it enumerates a nonzero number of calls and
  every API call in the closure is a string literal; it fails on either
  condition rather than passing vacuously (#474's negative control).
- The inverse check (a harness entry whose route no longer exists on the
  server) needs the Express app loaded and lives elsewhere; deferred to its
  own issue.
