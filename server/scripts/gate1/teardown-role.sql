-- ===========================================================================
-- GATE 1: tear the temporary read-only role down.
--
-- Teardown is the half of a temporary credential that actually makes it
-- temporary. VALID UNTIL stops new logins at the expiry; it does not remove the
-- role, its grants, or its ACL entries, and it does not end a session that is
-- already open. This file does.
--
-- FAIL CLOSED. The runner runs the two `teardown_check_` blocks first and
-- ABORTS if either returns a row. It never auto-drops objects the role owns.
-- `DROP ROLE ... CASCADE` does not exist, and this file deliberately does not
-- use `DROP OWNED BY` either. If the role has somehow come to own something,
-- that is a fact a human needs to see before anything is destroyed.
--
-- RUN drop-rls-policies.sql FIRST, IF grant-rls-policies.sql EVER RAN. An RLS
-- policy that names a role records a shared dependency on it, and PostgreSQL
-- refuses to drop a role while one exists - SQLSTATE 2BP01. The ordering is
-- therefore the SERVER's, not a convention this file asks for; what this file
-- adds is that teardown_check_ownership stops one statement earlier and names
-- the phase that fixes it. The two phases run as different operators, because
-- DROP POLICY needs table ownership and DROP ROLE needs CREATEROLE, so the
-- forgotten step is a realistic one rather than a hypothetical.
--
-- WHY THERE IS NO `DROP OWNED BY`
--
-- There used to be, as a sweeper for residual ACL entries after the explicit
-- REVOKEs. It was removed for two independent reasons, the first discovered by
-- the disposable-Postgres lifecycle test failing in CI against a
-- production-shaped operator:
--
--   1. A non-superuser CREATEROLE role CANNOT run it on a role it created.
--      `DROP OWNED BY` requires the caller to hold the PRIVILEGES OF the target
--      role - superuser, an INHERIT membership, or the ability to SET ROLE to
--      it. The PG 16+ implicit creator-admin grant is ADMIN TRUE, INHERIT
--      FALSE, SET FALSE: ADMIN authorizes granting memberships and DROP ROLE,
--      but confers none of the role's privileges. PostgreSQL 16 also removed
--      the CREATEROLE shortcut that used to permit this. So the real Gate 1
--      operator, Supabase's hosted `postgres`, gets "permission denied to drop
--      objects" - which is exactly what CI reported.
--
--      The available workaround is worse than the problem: the operator holds
--      ADMIN OPTION, so it could re-grant the role to itself WITH INHERIT TRUE
--      and then qualify. That is the kit escalating its own access to the very
--      role it is dismantling, and verify-role.sql correctly rejects an
--      inherit-widened grant as a different relationship. It is not on the table.
--
--   2. Even where it works, it is the wrong instrument. Its whole job was to
--      silently delete ACL entries that DROP ROLE would otherwise refuse over.
--      Those entries are privileges nobody in this kit granted, on a role that
--      verify has already proven held exactly five. Deleting them destroys the
--      evidence of an over-grant on the way past. DROP ROLE's own dependency
--      check is the same check, made by the authority that owns it, and it
--      SURFACES the finding instead: it errors, the transaction rolls back,
--      nothing is dropped, and the dependency list reaches the operator.
--
-- The cost is that a residual ACL turns teardown into a clean abort rather than
-- a clean drop. That is the trade this file wants: see the philosophy above.
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
--
-- Role MEMBERSHIP is not an ownership dependency and does not appear here; it
-- lives in pg_auth_members and is checked by teardown_check_memberships below.
-- In particular the PG 16+ implicit creator-admin grant produces no row in this
-- block, so a clean result here says nothing about it either way.
--
-- THE POLICY ROWS, AND WHY TEARDOWN DOES NOT TOLERATE THEM
--
-- This is character for character the statement verify-role.sql runs, and a test
-- asserts that, but the two files DECIDE differently on the result and that is
-- deliberate. verify tolerates the four deptype 'r' rows that the kit's own RLS
-- policies produce, because after grant-rls-policies.sql they are the intended
-- state. Teardown tolerates none of them, because a policy naming a role is a
-- reason DROP ROLE will refuse: PostgreSQL raises SQLSTATE 2BP01 while any such
-- dependency exists. Aborting here rather than at the DROP is the same finding
-- one statement earlier, with a message that can name the fix - the
-- drop-rls-policies phase, which runs as the table owner. The server's own
-- refusal stays behind it as the authority; this block is only the legible
-- version of it.
--
-- The policy columns exist so that the abort message can distinguish "the role
-- owns a table" from "the operator forgot the policy-drop phase". They are
-- resolved from the catalog for the current database only; see verify-role.sql
-- for why the dbid test is part of is_policy_dependency.
SELECT
  s.deptype                            AS dependency_type,
  s.classid::regclass::text            AS catalog_name,
  s.objid                              AS object_oid,
  d.datname                            AS database_name,
  (s.classid = 'pg_policy'::regclass
     AND s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database()))
                                       AS is_policy_dependency,
  pol.polname                          AS policy_name,
  poln.nspname                         AS policy_schema,
  polrel.relname                       AS policy_table
FROM pg_shdepend s
LEFT JOIN pg_database d ON d.oid = s.dbid
LEFT JOIN pg_policy pol
       ON s.classid = 'pg_policy'::regclass
      AND s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND pol.oid = s.objid
LEFT JOIN pg_class polrel ON polrel.oid = pol.polrelid
LEFT JOIN pg_namespace poln ON poln.oid = polrel.relnamespace
WHERE s.refobjid = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
  AND s.deptype IN ('o', 'r')
ORDER BY s.deptype, s.objid;


-- @statement: teardown_check_memberships
-- A membership in either direction means someone else's access is entangled
-- with this role, and dropping it would silently change their privileges - with
-- ONE exception, identified by exactly the same structural test verify-role.sql
-- applies. See that file for the full account of the PG 16+ implicit
-- creator-admin grant.
--
-- The exception is NOT revoked here, deliberately. Its grantor is the bootstrap
-- superuser, and PostgreSQL does not let the creator modify a grant it did not
-- make; attempting it would fail, and if it somehow succeeded it would strip the
-- ADMIN OPTION that authorizes the DROP ROLE this teardown is about to perform.
-- Dropping a role removes its memberships automatically, so there is nothing to
-- clean up by hand.
SELECT
  'members'::text                 AS direction,
  m.rolname                       AS other_role,
  (m.rolname = current_user)      AS other_role_is_connected_role,
  g.oid                           AS grantor_oid,
  g.rolname                       AS grantor_name,
  g.rolsuper                      AS grantor_is_superuser,
  (g.oid = 10)                    AS grantor_is_bootstrap,
  am.admin_option                 AS admin_option,
  am.inherit_option               AS inherit_option,
  am.set_option                   AS set_option
FROM pg_auth_members am
LEFT JOIN pg_roles m ON m.oid = am.member
LEFT JOIN pg_roles g ON g.oid = am.grantor
WHERE am.roleid = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
UNION ALL
SELECT
  'member_of'::text,
  r.rolname,
  (r.rolname = current_user),
  g.oid,
  g.rolname,
  g.rolsuper,
  (g.oid = 10),
  am.admin_option,
  am.inherit_option,
  am.set_option
FROM pg_auth_members am
LEFT JOIN pg_roles r ON r.oid = am.roleid
LEFT JOIN pg_roles g ON g.oid = am.grantor
WHERE am.member = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
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
-- the teardown is reviewable against the creation line by line. Since there is
-- no sweeper (see the header), these REVOKEs are not a legibility nicety - they
-- are the ONLY thing that clears the kit's own ACL entries, and DROP ROLE below
-- will refuse if any of them is missed.
--
-- The operator is the grantor of all five, which is what makes it authorized to
-- revoke them. This block ran successfully in CI as a non-superuser CREATEROLE
-- operator.
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


-- @statement: teardown_drop_role
-- The drop, and also the LAST FAIL-CLOSED CHECK.
--
-- PostgreSQL refuses to drop a role that anything still depends on, and reports
-- what: "role X cannot be dropped because some objects depend on it", with a
-- DETAIL listing the privileges and objects (including counts for other
-- databases in the cluster). Since there is no sweeper ahead of it, that check
-- is load-bearing rather than decorative. It consults pg_shdepend, which is the
-- same catalog any hand-written residual check would have to read, so this is
-- the authoritative version of that check rather than a reimplementation that
-- could drift from it.
--
-- Reaching this statement means: the role owns nothing and no RLS policy names
-- it (teardown_check_ownership), it has no membership beyond the implicit
-- creator-admin grant (teardown_check_memberships), it has no live session
-- (teardown_terminate_sessions), and the kit's own five grants have been revoked
-- (teardown_revoke). If it still fails, something outside this kit granted the
-- role a privilege or pointed a policy at it, and that is a finding: the
-- transaction rolls back, nothing is dropped, and a human reads the dependency
-- list. The runner surfaces the DETAIL, not just the summary line.
--
-- The refusal is SQLSTATE 2BP01 (dependent_objects_still_exist), and the
-- lifecycle test pins it against a real server for the policy case specifically,
-- so that "DROP ROLE enforces the ordering for us" stays a checked claim rather
-- than a comment that could rot.
--
-- Role MEMBERSHIPS need no cleanup here. DROP ROLE automatically revokes
-- memberships of the target role in other roles and of other roles in it, which
-- is how the implicit creator-admin grant goes away without this file ever
-- issuing a REVOKE that its own grantor would refuse.
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
