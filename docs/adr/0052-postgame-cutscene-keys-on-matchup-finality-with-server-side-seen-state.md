# Postgame cutscene keys on Matchup finality with server-side seen state

Status: accepted (2026-09-28)

The Postgame cutscene brief (spec #1747) asked for a full-screen Tecmo result animation
that "executes exactly once on initial Tuesday morning login". Two things in
this domain make that wording wrong as a rule. A Matchup is final when a
commissioner runs Advance week (`POST /api/scoring/league/:id/advance-week`,
`season.service.js` `finalizeWeekAndAdvance` sets `matchups.final`); no clock
does it, one league advances Monday night and another Thursday, and the
Tuesday/Wednesday correction pass can re-score a final week afterwards,
silently by rule (#1409). And "once" has no precedent for a per-Manager
in-app event: the Draft room's on-the-clock sound is a per-device
localStorage preference by design (`draftSoundPreference.js`), and the
touchdown celebration switch is a server-side opt-out in
`notification_prefs` (`touchdownCelebrations`).

We decide that a Postgame cutscene is due the moment its Matchup is final and
is shown on the Manager's next visit to Home, whatever the weekday. It
expires at the league's next first Kickoff, or, for a season's last week, one
week after that week's last Kickoff, so it is only ever the result that just
happened; nothing carries over and no new column records when a week was
finalized. Seen state is server-side: one row per (user, matchup) in
`postgame_cutscene_views`, written idempotently when the queue's title card
is dismissed either way (PRESS START or SKIP), so a Manager's phone and
laptop cannot both play it and a skip is never nagged. A correction that
lands after the cutscene played never replays or reverses it; one that lands
before the Manager looks is simply what they see, because the due list reads
the live scores. Whether a Manager gets cutscenes at all is a new opt-out
key, `postgameCutscenes`, beside `touchdownCelebrations`.

Considered and rejected:

- A weekday clock (Tuesday 06:00 local, also waiting for finality). Finality
  is commissioner-timed, so a clock rule either shows a week that is not yet
  final or holds a Thursday advance until the following Tuesday, when the
  next slate has already started.
- Per-device localStorage, the draft-sound precedent. That preference is
  per-device because it is a device choice; once-ness of an event is an
  account fact, and two devices would each play the same result.
- Notification read-state. A notification is an event that can be read
  (glossary); the cutscene is state that must be shown once, and tracking it
  through the bell would create a notification row per Matchup per Manager
  that is visible in the bell for no other reason.

Consequences: one new table and two routes (`GET /api/user/postgame-cutscenes`,
`POST /api/user/postgame-cutscenes/:matchupId/seen`); the seen write is
fire-and-forget with a sessionStorage guard so a failed write cannot replay
within the session; the cutscene mounts from Home only, never from a deep
link; and the Recap (the league week's narrative) and the digest email are
untouched, this being the first personal "you won / you lost" surface.

## Amendment 2026-09-30 (spec #1846)

The cutscene also carries the Team's awards for the Matchup's week: a Called
shot's result (hit or miss), Perfect Lineup and Captain Hindsight, read from
the frozen Trophy and Called shot records written at Advance week. After the
WIN, LOSS or TIE scene one static card in the same style lists them, and no
card appears when there are none. Nothing else changes: seen state, expiry,
the `postgameCutscenes` opt-out and the Home-only mount are as decided
above, and the awards are judged once (ADR 0054), so a correction can no more
change the card than the result.
