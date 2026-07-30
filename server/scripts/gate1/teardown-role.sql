-- ===========================================================================
-- GATE 1: tear the temporary read-only role down.
--
-- Teardown is the half of a temporary credential that actually makes it
-- temporary. VALID UNTIL stops new logins at the expiry; it does not remove the
-- role, its grants, or its ACL entries, and it does not end a session that is
-- already open. This file does.
--
-- FAIL CLOSED. The runner runs the two `teardown_check_` blocks first and
-- ABORTS if either returns a row. It never auto-drops objects the role owns:
-- `DROP OWNED BY` would delete them, and `DROP ROLE ... CASCADE` does not
-- exist. If the role has somehow come to own something, that is a fact a human
-- needs to see before anything is destroyed.
--
-- IDEMPOTENT. Tearing down a role that does not exist is a clear no-op message
-- and exit code 0, not an error - so an operator who is unsure whether teardown
-- already ran can simply run it again.
--
-- PLACEHOLDERS (see create-role.sql for the psql conventions):
--
--   psql -v role_ident=backtest_ro_pit01 -v role_name=backtest_ro_pit01 \
--        -v database_ident=endzone_empire -v role_oid=16471 -f teardown-role.sql
--
-- @placeholders: role_ident, role_name, database_ident, role_oid
--
--   :"role_ident"      the role, as a quoted IDENTIFIER
--   :'role_name'       the role, as a quoted string LITERAL
--   :"database_ident"  the database, as a quoted IDENTIFIER
--   :'role_oid'        the role's OID, read from teardown_role_present BEFORE
--                      the drop, as a quoted string LITERAL. Running this file
--                      by hand means reading that value from the first
--                      statement's output and setting the variable before the
--                      last one. See teardown_confirm_absent for why the final
--                      check cannot simply look the role up again.
--
-- No expiry is needed: the role is going away regardless of when it would have.
-- ===========================================================================


-- @statement: teardown_role_present
-- Absent role, absent problem. The runner stops here and reports a no-op.
--
-- The OID is returned because the final confirmation needs it. After DROP ROLE
-- there is no pg_roles row, so any check phrased as
-- `WHERE refobjid = (SELECT oid FROM pg_roles WHERE rolname = ...)` compares
-- against NULL and finds nothing whether or not residue exists. The runner
-- captures this value up front and probes with the number.
SELECT
  oid           AS role_oid,
  rolname       AS role_name,
  rolvaliduntil AS valid_until,
  (rolvaliduntil IS NOT NULL AND rolvaliduntil <= now()) AS already_expired
FROM pg_roles
WHERE rolname = :'role_name';


-- @statement: teardown_check_ownership
-- Any row here ABORTS the teardown. See verify-role.sql for why deptype 'a' is
-- excluded: those are the grants this file is about to revoke.
SELECT
  s.deptype                 AS dependency_type,
  s.classid::regclass::text AS catalog_name,
  s.objid                   AS object_oid,
  d.datname                 AS database_name
FROM pg_shdepend s
LEFT JOIN pg_database d ON d.oid = s.dbid
WHERE s.refobjid = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
  AND s.deptype IN ('o', 'r')
ORDER BY s.deptype, s.objid;


-- @statement: teardown_check_memberships
-- A membership in either direction means someone else's access is entangled
-- with this role. Dropping it would silently change their privileges.
SELECT
  'member_of' AS direction,
  g.rolname   AS other_role
FROM pg_auth_members m
JOIN pg_roles g ON g.oid = m.roleid
WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
UNION ALL
SELECT
  'members'   AS direction,
  g.rolname   AS other_role
FROM pg_auth_members m
JOIN pg_roles g ON g.oid = m.member
WHERE m.roleid = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
ORDER BY direction, other_role;


-- ---------------------------------------------------------------------------
-- Everything below MUTATES. Both checks above have returned no rows.
-- ---------------------------------------------------------------------------


-- @statement: teardown_terminate_sessions
-- An open session survives both DROP ROLE's refusal and the role's own expiry,
-- and holds a read transaction against production. Close it first. Excluding
-- pg_backend_pid() is defensive only: the admin is not the role being dropped,
-- and if it somehow were, terminating our own backend mid-teardown is the one
-- way to leave this half-done.
--
-- The second argument is a timeout in milliseconds, and it is the difference
-- between "the signal was sent" and "the backend is gone". Without it
-- pg_terminate_backend returns as soon as SIGTERM is delivered, and
-- teardown_confirm_absent below could read pg_stat_activity while the backend
-- is still winding down and report a live session for a role that is already
-- dropped. Waiting here makes the final confirmation mean what it says.
SELECT
  pg_terminate_backend(pid, 10000) AS terminated,
  pid                              AS backend_pid
FROM pg_stat_activity
WHERE usename = :'role_name'
  AND pid <> pg_backend_pid();


-- @statement: teardown_revoke
-- The exact inverse of create-role.sql, written out rather than swept, so that
-- the teardown is reviewable against the creation line by line. DROP OWNED BY
-- below would remove these anyway; doing it explicitly first means a reader can
-- confirm the two files describe the same privilege set.
REVOKE EXECUTE ON FUNCTION public.fn_normalize_nfl_team(text) FROM :"role_ident";
REVOKE SELECT ON TABLE
  public.players,
  public.player_stats,
  public.player_season_stats,
  public.nfl_games
FROM :"role_ident";
REVOKE USAGE ON SCHEMA public FROM :"role_ident";
REVOKE CONNECT ON DATABASE :"database_ident" FROM :"role_ident";


-- @statement: teardown_reset_settings
-- Clears the pg_db_role_setting row. DROP ROLE removes it too; doing it
-- explicitly keeps the teardown's effects legible.
ALTER ROLE :"role_ident" RESET ALL;


-- @statement: teardown_drop_owned
-- The sweeper. The explicit REVOKEs above cover the privileges this kit
-- granted; DROP OWNED BY clears any remaining ACL entry in this database and on
-- shared objects, which is what DROP ROLE would otherwise refuse over. It is
-- safe to run only BECAUSE teardown_check_ownership returned no rows: with
-- nothing owned, this drops no objects.
DROP OWNED BY :"role_ident";


-- @statement: teardown_drop_role
DROP ROLE :"role_ident";


-- @statement: teardown_confirm_absent
-- Prove it. A teardown that reported success without checking would be the
-- easiest possible place for this whole kit to lie - and an earlier version of
-- this block did exactly that. Two of its three counts resolved the role
-- through `(SELECT oid FROM pg_roles WHERE rolname = ...)` and `usename`, both
-- of which go NULL the instant DROP ROLE succeeds, so they returned 0 whether
-- or not any residue survived. They confirmed nothing but their own phrasing.
--
-- The fix is to probe by the OID captured BEFORE the drop.
-- `pg_stat_activity.usesysid` keeps the numeric OID after the role is gone,
-- where `usename` cannot resolve it, so a session that outlived the drop is
-- visible here rather than silently counted as zero.
SELECT
  (SELECT count(*) FROM pg_roles WHERE rolname = :'role_name')          AS role_rows,
  (SELECT count(*) FROM pg_shdepend WHERE refobjid = :'role_oid')       AS shdepend_rows,
  (SELECT count(*) FROM pg_stat_activity WHERE usesysid = :'role_oid')  AS live_sessions;
