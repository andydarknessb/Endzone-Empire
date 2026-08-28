# Pre-typed League-chat wire contraction

This repo deliberately retains the narrow compatibility behavior for League
chat clients that predate the typed, sequenced Draft-room feed.

## Why this is out of scope

Issue #448 proposed removing a rollout flag, an old Draft-room feed layout,
and transitional compatibility after the combined feed reached production.
Those first two targets do not exist: the combined feed is the only Draft-room
feed path, and ADR 0012 records direct release promotion rather than a runtime
rollout flag.

The remaining compatibility surface is smaller and protocol-level:

- the server accepts a `chat:send` payload without `clientMsgId`;
- the client tolerates League-chat entries without a typed kind or sequence;
- tests pin the old-client request contract.

That behavior protects cached bundles and already-open browser tabs during a
release. The application has no protocol-version telemetry or observable point
at which every older client can be proven gone. Removing the fallbacks would
therefore create a release-window failure mode without deleting an alternate
product path or producing user-visible value.

The compatibility stays until a future change introduces a versioned protocol,
measures client retirement, or identifies a concrete security or correctness
defect in the fallback itself. Such a change should file a new issue with that
evidence instead of reopening the old rollout-flag plan.

## Prior requests

- #448 - "Contract legacy feed paths and remove the rollout flag"
