# The runtime-only image for the accuracy-roadmap freeze sequence (Phase 4,
# plan Step 5) and, later, the Phase-5 sweep. It exists to run committed CODE
# against committed BYTES with a pinned, reproducible runtime - never to carry
# code or data of its own.
#
# NO APPLICATION CODE, NO node_modules, BAKED IN. Code identity for the freeze
# must come from git (a bind-mounted detached worktree checked out at Commit
# A), not from this image, so that a code change never forces an image
# rebuild and "verification = git identities" stays immune to anything about
# how this image happens to be built. `node_modules` comes from a separately
# built, dependency-lockfile-keyed volume (see backtest-reproduction.yml),
# mounted read-only alongside the worktree at container-run time - never
# copied in here either.
#
# THE BASE DIGEST IS PINNED, RESOLVED ONCE, HARDCODED. A base-image digest is
# stable; a *built*-image digest is not (layer metadata varies build-to-
# build), so the only meaningful pin - and the only thing the freeze manifest
# records - is this base digest plus --platform linux/amd64, never "the image
# digest used to produce M". Confirmed pullable/runnable under
# `--platform linux/amd64` and confirmed `--network none` actually blocks
# outbound HTTPS (EAI_AGAIN) on the authoring machine before this digest was
# hardcoded here. Never re-resolve a floating tag at build time - CI builds
# from this exact line, same as a local build does.
FROM node:24-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7

# Locale-invariant, UTC-pinned: every canonical artifact this pipeline writes
# forbids timestamps and environment leaks by construction (see
# run-backtest-mde.js's assertEnvironmentFree), but the RUNTIME producing them
# should not even have a floating local clock or locale to leak from in the
# first place.
ENV TZ=UTC
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_FUND=false

# The three mounts this image is run with (see backtest-entrypoint.js and
# backtest-reproduction.yml for the exact `docker run`/`docker create` flags):
#   /worktree      - the detached worktree checked out at Commit A, READ-ONLY
#   /worktree/node_modules - the dependency volume, READ-ONLY, bind-mounted
#                    over the (empty, git-ignored) node_modules path inside
#                    the read-only worktree mount
#   /output        - a dedicated, writable, host-bound output directory
#
# Nothing about the three run-time mounts is declared here, and nothing of
# the APPLICATION (server/scripts, scripts/backtest, node_modules) is copied
# in - all of that comes from the bind-mounted worktree and dependency
# volume at `docker run` time. The one file this image DOES carry is its own
# entrypoint script below: pure container-orchestration glue (run canaries,
# rehydrate, run rosters, run mde, in order, aborting on failure), not
# application logic, and something has to invoke it without a fourth mount -
# the plan's "three mounts total, each single-purpose" leaves no room for a
# separately bind-mounted entrypoint. A change to this script's own logic is
# the one legitimate reason to rebuild this image; a change to the app under
# test never is.
COPY backtest-entrypoint.js /entrypoint/backtest-entrypoint.js

# Runs as a fixed, non-root, unprivileged user. Nothing about this pipeline
# needs root: /worktree and /worktree/node_modules are both read-only mounts,
# the entrypoint's only writes go to /tmp (world-writable by default in this
# base image) and to /output, a dedicated host-bound mount whose permissions
# the workflow that runs this image sets up to be writable by this fixed uid
# regardless of the host runner's own uid (see backtest-reproduction.yml).
# A fixed uid, not an image-build-time `--user` derived from whoever happens
# to build it, keeps the image itself reproducible independent of who builds
# it.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin backtest
USER backtest

WORKDIR /worktree

ENTRYPOINT ["node", "/entrypoint/backtest-entrypoint.js"]
