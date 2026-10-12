# A Push alert is sent through one module

Status: accepted (2026-10-12)

Every Push alert (CONTEXT.md) has the same shape around its one real
difference: find the Managers the event concerns, drop the ones whose
preference is off, make sure this Manager has not had this alert already,
write a title and a body, append a Banter line for those who want one, send.
On 2026-10-12 that shape existed as eleven hand copies: three alert bodies
inline in `server/modules/scheduler.js` (Big play, Score update, close
matchup), one each in the injury sync, the IR policy, the digest (Lineup
reminder, Pick'em reminder, waiver results), the draft schedule, the trade
flow and the Test alert route. Only the last step, `push.service.js`'s
`sendPushToUsers`, was shared. The once-only rule was kept three ways: rows
in `push_events` (Big play, lead change, Injury alert, Lineup reminder), Sets
in process memory that forget everything on a deploy (close matchup, Pick'em
reminder, the waiver digest watermark) and a draft stage column. Two kinds had
no test at all for who receives them or what they say, and `liveBoxPoll.js`
required the scheduler to reach the three alerts that live there. Seven of the
scheduler's last sixty commits were alert copy or alert gating.

We decide that a Push alert is sent through one module, a Push alert module in
`server/services/`, whose interface is one call: `sendAlert({ kind, ...facts })`.
The module holds a table with one row per kind, and the row is the whole alert:

- `prefKey`: the per-Manager preference that gates it, or none (the Test
  alert).
- `recipients(facts, db)`: the Managers the event concerns, as a query the row
  owns. The caller passes the event (the plays, the scored Matchup rows, the
  designation change, the flagged stash), never a user list.
- `once(facts)`: the `push_events` subject and fingerprint that make a repeat
  a no-op, or `rate({ perUserMs })` for kinds that may repeat at a ceiling, or
  none (the Test alert). Every once-only rule lives in the ledger; no kind
  keeps one in process memory.
- `text(facts, recipient)`: title and body.
- `banter`: the Banter situation, or none for the transactional kinds.

The module owns the pipeline: recipients, preference gate, ledger, text,
Banter, send. `push.service.js` keeps the web-push adapter and the
subscription reads and writes, and is called by nothing but the module. A new
kind is a new row, never a new sender.

## Considered options

1. **Callers pass `userIds`; the module owns everything after.** Rejected: the
   recipient query is where each sender's own SQL lives, so eleven senders keep
   eleven queries and deleting the module would leave the complexity where it
   is. The deletion test fails.
2. **Each kind as its own small module behind a shared `sendPushOnce`.** This
   is the 2026-10-12 state with better names. Rejected for the same reason.
3. **Rows own recipients; the pipeline is one.** Chosen. The row is small
   (a preference key, a query, a ledger key, a text function, a situation) and
   the module behind it is deep.

## Consequences

- The three alert bodies leave `scheduler.js`; `liveBoxPoll.js` and the tick
  call the module directly and the `liveBoxPoll → scheduler` require goes.
- Close matchup, Pick'em reminder and waiver results gain a `push_events`
  row each and stop repeating after a restart.
- Draft reminders keep `draft_reminder_stage` as draft state; the push they
  send still goes through the module with a `once` key.
- Email and in-app notifications stay with their callers. The module is push
  only.
- Tests drive `sendAlert` with a fake pool and a fake web-push adapter, one
  file, every kind; the kind table is the test surface.
- The **Push alert** glossary entry names the kinds and this rule.
