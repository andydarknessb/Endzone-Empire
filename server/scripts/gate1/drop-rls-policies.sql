-- ===========================================================================
-- GATE 1 AMENDMENT: drop the row-level-security policies grant-rls-policies.sql
-- created.
--
-- The exact inverse of grant-rls-policies.sql, and it runs as the same operator:
-- DROP POLICY is gated on ownership of the table, exactly as CREATE POLICY is,
-- so this phase reads BACKTEST_OWNER_DATABASE_URL and not the admin credential.
--
-- WHERE IT SITS IN THE SEQUENCE
--
-- BEFORE the role teardown, and this is an ordering PostgreSQL enforces for
-- itself rather than one the kit merely documents. A policy that names a role
-- records a shared dependency on it (pg_shdepend, deptype 'r'), and DROP ROLE
-- refuses while any such dependency exists - SQLSTATE 2BP01, "role ... cannot be
-- dropped because some objects depend on it". So an operator who forgets this
-- phase does not silently orphan four policies: the teardown stops, and
-- teardown-role.sql's own ownership check stops it one step earlier still, with
-- a message that names this phase as the fix.
--
-- WHY NO `IF EXISTS`
--
-- DROP POLICY IF EXISTS would turn "the policy this file is responsible for is
-- not there" into silence, and that state is a finding: something outside this
-- kit removed it, and whatever else that something did is unknown. The runner
-- decides between the two legitimate states before issuing anything - all four
-- kit policies present, or none at all - so the plain DROP below only ever runs
-- against policies that have already been read out of the catalog and matched
-- against the expected shape, field by field.
--
-- A same-named policy whose shape does NOT match is never dropped. Something
-- other than this kit made it, so nothing here describes what it permits, and
-- deleting it would destroy the evidence of that on the way past. That is the
-- same judgement teardown-role.sql makes about a residual ACL entry.
--
-- WHAT IT NEVER DOES
--
-- No statement here contains ALTER TABLE ... ENABLE, DISABLE or FORCE ROW LEVEL
-- SECURITY. In particular it does NOT turn RLS off to "clean up": the three
-- tables arrived with RLS enabled and must leave with RLS enabled. The runner
-- reads the flags before and after and rolls back if either moved.
--
-- IDEMPOTENT. Dropping policies that are not there is a clear no-op message and
-- exit code 0, not an error, so an operator who is unsure whether this already
-- ran can simply run it again.
--
-- PLACEHOLDERS (see create-role.sql for the psql conventions):
--
--   psql -v role_name=backtest_ro_pit01 \
--        -v policy_ident=backtest_ro_pit01_select -f drop-rls-policies.sql
--
-- @placeholders: role_name, policy_ident
--
--   :'role_name'     the role, as a quoted string LITERAL
--   :"policy_ident"  the policy name, as a quoted IDENTIFIER
--
-- There is no identifier form of the role here: this file names the role only to
-- read the catalog, never to grant or revoke anything to it.
--
-- AUTHORIZATION. Executing this against production requires the user's explicit
-- Gate 1 approval, on the same terms as create-role.sql.
-- ===========================================================================


-- @statement: policy_preflight_context
-- The accident guard. Identical to grant-rls-policies.sql's, and a test asserts
-- the two are the same statement: a drop that could be aimed at a database the
-- grant could not would be a way to remove policies from the wrong cluster.
SELECT
  current_database() AS database_name,
  current_user       AS connected_role;


-- @statement: policy_preflight_role_present
-- The role must still exist. It is what the shape check below resolves the
-- policy's role array against, and with the role gone that comparison is NULL
-- for every policy - which would report four kit policies as four foreign ones
-- and abort with a message about the wrong thing.
SELECT
  rolname     AS role_name,
  rolcanlogin AS can_login
FROM pg_roles
WHERE rolname = :'role_name';


-- @statement: policy_table_rls_state
-- The four granted tables: who owns them, and their row-security flags. Dropping
-- a policy needs the same ownership creating one does, so the same check gates
-- both phases. See grant-rls-policies.sql for the full reasoning; this block is
-- character-for-character the same statement, and a test asserts it.
SELECT
  c.oid                                        AS table_oid,
  n.nspname                                    AS schema_name,
  c.relname                                    AS table_name,
  c.relkind                                    AS table_kind,
  pg_get_userbyid(c.relowner)                  AS table_owner,
  (pg_get_userbyid(c.relowner) = current_user) AS owner_is_connected_role,
  c.relrowsecurity                             AS row_security_enabled,
  c.relforcerowsecurity                        AS row_security_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('players', 'player_stats', 'player_season_stats', 'nfl_games')
ORDER BY c.relname;


-- @statement: policy_table_policies
-- EVERY policy on the four granted tables, in the same shape the grant phase
-- reads, so that the two phases cannot disagree about what a kit policy is. The
-- runner requires each policy it is about to drop to match that shape field by
-- field before the DROP below is issued at all.
SELECT
  p.oid                                         AS policy_oid,
  c.oid                                         AS table_oid,
  n.nspname                                     AS schema_name,
  c.relname                                     AS table_name,
  p.polname                                     AS policy_name,
  p.polcmd                                      AS policy_command,
  p.polpermissive                               AS policy_permissive,
  (p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = :'role_name')]::oid[])
                                                AS roles_are_exactly_the_role,
  (0::oid = ANY(p.polroles))                    AS applies_to_public,
  ARRAY(SELECT COALESCE(r.rolname::text, 'oid:' || pr.role_oid::text)
          FROM unnest(p.polroles) AS pr(role_oid)
          LEFT JOIN pg_roles r ON r.oid = pr.role_oid
         ORDER BY 1)                            AS policy_roles,
  (pg_get_expr(p.polqual, p.polrelid) = 'true') AS using_is_unconditional,
  pg_get_expr(p.polqual, p.polrelid)            AS using_expression,
  (p.polwithcheck IS NULL)                      AS has_no_with_check
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('players', 'player_stats', 'player_season_stats', 'nfl_games')
ORDER BY c.relname, p.polname;


-- ---------------------------------------------------------------------------
-- Everything below MUTATES. All four blocks above have been checked, and the
-- runner has matched every policy named here against the expected shape.
-- ---------------------------------------------------------------------------


-- @statement: drop_policies
-- Four policies, one per granted table, named individually and in the same order
-- grant-rls-policies.sql creates them, so the two files read as inverses line by
-- line. No IF EXISTS: see the header.
--
-- The SELECT grants are NOT revoked here. They are create-role.sql's, and
-- teardown-role.sql revokes them; dropping the policies only removes the row
-- visibility this amendment added, which is what unblocks DROP ROLE.
DROP POLICY :"policy_ident" ON public.players;
DROP POLICY :"policy_ident" ON public.player_stats;
DROP POLICY :"policy_ident" ON public.player_season_stats;
DROP POLICY :"policy_ident" ON public.nfl_games;
