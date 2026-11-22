#!/usr/bin/env bash
#
# Restore drill (#3004), run from the repo root by .github/workflows/restore-drill.yml.
# Dumps the app-owned schemas from SOURCE_DATABASE_URL with pg_dump, restores the
# dump into a fresh restore_drill database on the target cluster, checks the copy
# against the source, then runs integration's pending migrations on top of it.
#
# Inputs, all from the environment: SOURCE_DATABASE_URL, and the target cluster's
# PGHOST, PGPORT, PGUSER, PGPASSWORD. DRILL_ALLOW_EMPTY=1 skips only the core-table
# row check; the PR self-test sets it because its source is migrated but has no rows.
# Never set -x here: it would print SOURCE_DATABASE_URL.
#
# shortcut: the schema list is hand-kept in two places (the pg_dump --schema flags and
# TABLES_SQL), so a new app schema added to server/db/migrations must go in both, or
# it is skipped on both sides and no check sees it. Upgrade: read pg_namespace minus Supabase's schemas.

set -euo pipefail
export LC_ALL=C

say() { echo "restore-drill: $*"; }
fail() { echo "::error::restore-drill: $*" >&2; exit 1; }

START=$(date +%s)

say "step 1: checking the target is loopback (PGHOST must be 127.0.0.1 or localhost)"
case "${PGHOST:-}" in
  127.0.0.1 | localhost) ;;
  *) fail "loopback check failed: PGHOST is '${PGHOST:-<unset>}', expected 127.0.0.1 or localhost; a restore is never tested over a shared database" ;;
esac
if [ -z "${SOURCE_DATABASE_URL:-}" ]; then
  fail "source check failed: SOURCE_DATABASE_URL is empty, expected the session pooler URL of the database to dump"
fi
if [ ! -d server/db/migrations ]; then
  fail "working directory check failed: server/db/migrations not found under $PWD, run this from the repo root"
fi

say "step 2: printing client versions (pg_dump must be at least the source major version, 17)"
pg_dump --version
pg_restore --version
psql --version

DUMP="${RUNNER_TEMP:-/tmp}/restore-drill.dump"
trap 'rm -f "$DUMP"' EXIT

say "step 3: dumping schemas public and private from the source to $DUMP (custom format, no owners, no privileges)"
pg_dump "$SOURCE_DATABASE_URL" --format=custom --no-owner --no-privileges \
  --schema=public --schema=private --file="$DUMP" \
  || fail "step 3 failed: pg_dump exited non-zero for schemas public and private, see the pg_dump error above"
DUMP_BYTES=$(wc -c < "$DUMP" | tr -d ' ')
say "step 3: dump written, $DUMP_BYTES bytes"

say "step 4: dropping and recreating restore_drill on $PGHOST:$PGPORT, creating anon, authenticated and endzone_app as NOLOGIN where missing"
psql -X -v ON_ERROR_STOP=1 -d postgres <<'SQL' || fail "step 4 failed: could not recreate restore_drill or its roles, see the psql error above"
DROP DATABASE IF EXISTS restore_drill WITH (FORCE);
CREATE DATABASE restore_drill;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'endzone_app'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END
$$;
SQL

say "step 5: restoring $DUMP into restore_drill with pg_restore --exit-on-error"
pg_restore --no-owner --no-privileges --exit-on-error --dbname=restore_drill "$DUMP" \
  || fail "step 5 failed: pg_restore exited non-zero on restore_drill, see the pg_restore error above"

src_sql() { psql "$SOURCE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c "$1"; }
copy_sql() { psql -X -v ON_ERROR_STOP=1 -d restore_drill -At -c "$1"; }

# relkind r and p: ordinary and partitioned tables, counted from pg_class so the
# answer does not depend on which tables the connecting role may read.
TABLES_SQL="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'p')"

say "step 6: checking the copy against the source: tables in public and private"
SRC_TABLES=$(src_sql "$TABLES_SQL") || fail "table check failed: could not count tables on the source, see the psql error above"
COPY_TABLES=$(copy_sql "$TABLES_SQL") || fail "table check failed: could not count tables on the copy, see the psql error above"
[ "$SRC_TABLES" = "$COPY_TABLES" ] || fail "table count check failed: source=$SRC_TABLES copy=$COPY_TABLES (public and private)"
say "check ok: tables source=$SRC_TABLES copy=$COPY_TABLES"

say "step 6: checking the copy against the source: knex_migrations rows"
SRC_MIG=$(src_sql 'SELECT count(*) FROM public.knex_migrations') || fail "migration-row check failed: could not count knex_migrations on the source, see the psql error above"
COPY_MIG=$(copy_sql 'SELECT count(*) FROM public.knex_migrations') || fail "migration-row check failed: could not count knex_migrations on the copy, see the psql error above"
[ "$SRC_MIG" = "$COPY_MIG" ] || fail "knex_migrations row check failed: source=$SRC_MIG copy=$COPY_MIG"
say "check ok: knex_migrations rows source=$SRC_MIG copy=$COPY_MIG"

CORE_SUMMARY="skipped (DRILL_ALLOW_EMPTY=1)"
if [ "${DRILL_ALLOW_EMPTY:-0}" = "1" ]; then
  say "step 6: core-table row check skipped (DRILL_ALLOW_EMPTY=1)"
else
  say "step 6: checking each core table has at least one row on the copy"
  CORE_SUMMARY=""
  for t in users leagues teams players player_stats; do
    n=$(copy_sql "SELECT count(*) FROM public.$t") || fail "core-row check failed: could not count public.$t on the copy, see the psql error above"
    [ "$n" -ge 1 ] || fail "core-row check failed: public.$t has $n rows on the copy, expected at least 1"
    say "check ok: public.$t rows on the copy=$n"
    CORE_SUMMARY="${CORE_SUMMARY:+$CORE_SUMMARY, }$t=$n"
  done
fi

# knex keys a migration by its file name with extension, so pending is a basename diff.
refresh_pending() {
  RECORDED=$(copy_sql 'SELECT name FROM public.knex_migrations') || fail "migration check failed: could not read knex_migrations on the copy, see the psql error above"
  PENDING=$(comm -23 <(for f in server/db/migrations/*.js; do basename "$f"; done | sort) <(printf '%s\n' "$RECORDED" | sort))
}

say "step 7: listing migrations pending on the copy (files in server/db/migrations that knex has not recorded)"
refresh_pending
PENDING_BEFORE=$(printf '%s' "$PENDING" | grep -c . || true)
if [ -n "$PENDING" ]; then echo "$PENDING" | sed 's/^/restore-drill:   pending /'; fi

say "step 7: running npm run migrate with PGDATABASE=restore_drill NODE_ENV=test ($PENDING_BEFORE pending before the run)"
PGDATABASE=restore_drill NODE_ENV=test npm run migrate \
  || fail "step 7 failed: npm run migrate exited non-zero against restore_drill, see the knex output above"
refresh_pending
PENDING_AFTER=$(printf '%s' "$PENDING" | grep -c . || true)
[ "$PENDING_AFTER" = "0" ] || fail "migration check failed: $PENDING_AFTER migration(s) still pending on restore_drill after npm run migrate, expected 0"
say "check ok: migrations pending before=$PENDING_BEFORE, applied=$PENDING_BEFORE, pending after=$PENDING_AFTER"

SECONDS_TAKEN=$(( $(date +%s) - START ))
say "step 8: writing the run summary (counts only) and finishing"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Restore drill"
    echo
    echo "| Measure | Value |"
    echo "| --- | --- |"
    echo "| Dump size | $DUMP_BYTES bytes |"
    echo "| Tables in public and private (source / copy) | $SRC_TABLES / $COPY_TABLES |"
    echo "| knex_migrations rows (source / copy) | $SRC_MIG / $COPY_MIG |"
    echo "| Core table rows on the copy | $CORE_SUMMARY |"
    echo "| Migrations pending before / applied / pending after | $PENDING_BEFORE / $PENDING_BEFORE / $PENDING_AFTER |"
    echo "| Seconds taken | $SECONDS_TAKEN |"
  } >> "$GITHUB_STEP_SUMMARY"
fi
say "PASS: restore drill finished in ${SECONDS_TAKEN}s"
