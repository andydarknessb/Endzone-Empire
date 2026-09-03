# The Draft room hears through one adapter that never lies

Status: accepted (2026-09-02)

Rollout is in two steps. This ticket (#744) ships the transport the decision
rests on: a hardened, fail-fast draft publisher with a bounded, reported
publish; the `@socket.io/redis-emitter` in place of the custom relay; and the
production boot gates. The single Draft room broadcast adapter
(`server/modules/draftRoomBroadcast.js`), the fold of every room-wide emit into
it, the deletion of the broadcast helpers, and its construction at boot are
#745. Sentences below that describe that end state are marked "(#745)";
everything unmarked ships in #744.

Every room-wide event a Draft room receives (a Pick, a Draft activity entry,
completion, a roster change, a state refresh) is emitted today from five
helpers and ten inline `io.to(...).emit` sites across the API and the worker,
under three different policies for a missing Socket.IO server: two helpers
silently return, three fall through to a hand-rolled Redis channel whose
`false` on failure every caller discards, and the Redis client underneath
uses node-redis defaults, so a publish during a disconnect queues or hangs
rather than failing. In production the worker never has a Socket.IO server,
so the two silent helpers drop every worker-side lifecycle event (a scheduled
autostart's "Draft started" entry among them), and the other three cannot
tell delivery from loss. The decision is one Draft room broadcast adapter
(`server/modules/draftRoomBroadcast.js`, #745) with a named-method interface
(pick landed, activity appended, draft completed, roster changed, state
changed) that will be the only code allowed to emit a room-wide Draft event. It
will be constructed at boot with its process's transport, `io` in the API and a
`@socket.io/redis-emitter` in the worker, and either hand the event to that
transport or report the failure through pino and Sentry; it is never a no-op.
This ticket (#744) puts that transport underneath: the worker's
`@socket.io/redis-emitter`, the hardened publisher and the boot gates, with the
custom relay removed and its draft events already routed through a thin shim
that reports every failure.

## Why

- **Silence is the defect, not any one helper.** The MinneApple draft's
  multi-minute stall had a confirmed cause elsewhere (ADR 0018's resume
  arming bug and the 10-second poll), but the room's inability to learn that
  a worker-side event failed is a lie regardless of what it caused. A
  committed Pick the room never hears leaves every client counting down a
  clock that was replaced, until a reconnect or the next event that happens
  to arrive. The property "delivered or reported" is worth having on its own.
- **A process without a transport is a configuration error, not a quiet
  mode.** Today's `if (!io) return` guards exist so unit tests and the
  scheduler in local dev run silently. That convenience is exactly what hid
  the worker drops, because in local dev jobs run inside the API process with
  a real `io` and the failure never reproduces. The adapter takes its
  transport at construction; constructing it with none throws in production
  and tests inject a recording fake.
- **The standard emitter beats the custom relay.** The hand-rolled channel
  existed so a socket-less worker could reach a room, and grew an allowlist
  and an API-side `draft:state` re-derive so the worker would not build the
  snapshot itself. `@socket.io/redis-emitter` gives the worker an object
  whose `to(room).emit(event, payload)` mirrors `io`, fanning out through the
  `@socket.io/redis-adapter` the API already runs. The relay, its allowlist,
  the subscriber and the re-derive all delete, the worker computes the
  snapshot from the same database post-commit, and the adapter has one
  interface over one transport shape in each process.
- **Honesty is a property of the whole path.** An adapter that reports
  failures over a transport that hangs reports nothing. The draft publisher
  runs on its own client with the offline queue disabled (the shared
  `@socket.io/redis-adapter` client keeps the default queue, since the adapter
  publishes un-awaited and a rejection there would be unhandled), a bounded
  publish (2 seconds, a named constant), and a connection promise that is
  dropped on a fatal client error instead of being handed back dead to every
  later caller.

## Considered and rejected

- **Give the worker its own Socket.IO server.** Clients would need a second
  connection or sticky routing, and the Render worker exposes no port.
- **Move the Pick clock timers into the API so every emit is local.** It
  contradicts ADR 0018's worker ownership of expiry and the process split
  #614 is deciding within.
- **One bidirectional Draft message bus shared with #614.** "The room should
  see X" and "the worker should arm Y" have different failure semantics: a
  dropped arm message degrades latency to the backstop, a dropped room event
  is a visible lie. Two policies under one name is two adapters. They share
  the hardened Redis client, not the seam.
- **Retry inside the adapter.** The durable record is the committed row and
  the client already refetches `draft:state` on reconnect. An in-adapter
  retry hides the failure longer and can reorder an event behind a later
  success. The contract is "delivered or reported", never "delivered
  eventually".
- **Acknowledgements as the definition of delivered.** A room with zero
  connected managers between picks at 2am is normal, not a failure.
  "Delivered" means handed to the transport without error; receipt remains
  the client's job through its reconnect refetch.

## Consequences

- Every room-wide Draft emit in `server/` will go through the adapter,
  asserted by a source-form test (#745). The per-socket join snapshot,
  `draft:presence` and League chat delivery (ADR 0012) stay outside it.
- A delivery failure is one pino error and one Sentry event per failure, with
  no dedupe or rate limit; Sentry groups them. A draft produces a few hundred
  events at most.
- In production, a process without `REDIS_URL` refuses to boot. A worker
  whose Redis connect fails at boot still boots (it also runs scoring and
  sync) and reports the first failed publish through the transport.
- The custom relay in `draftEvents.js` (its subscriber, its allowlist and the
  API-side `draft:state` re-derive) is deleted in #744, and the test asserting
  "no io emits nothing" for it dies with it. `draftActivityBroadcast.js`,
  `rosterAvailabilityBroadcast.js`, the two helpers in `pickClock.service.js`
  and `draftStart`'s own state broadcast fold into the adapter and delete in
  #745.
- #614's future API-to-worker signal rides the hardened client on its own
  plain channel and is unaffected by the emitter.

## Amendment (2026-09-02, #765)

The adapter is the league room's broadcast, of which the Draft room events were
the first tenants; the live-score push `scores:updated` joins them as
`scoresUpdated(leagueId, payload)` under the same `league:<id>` room, the same
two transports (`io` in the API, the Redis emitter in the worker), and the same
delivered-or-reported policy. It is the same failure semantics that keep this
one adapter rather than two: a dropped score is the same visible lie as a
dropped Pick (Game Center and Matchup Detail have no polling, so a viewer's
scores sit frozen until a reload), so the "two policies under one name is two
adapters" test above does not fire. The scoring service, which emitted
`scores:updated` through a `getIo()`-null guard that silently dropped every
worker-side live-scoring tick and daily stat-correction pass since the
2026-07-23 worker split, now reads the adapter through `getDraftRoomBroadcast()`
and drops its `io` import; the source-form guard's exemption for it is deleted
and the file is guarded again. No new adapter and no module rename.
