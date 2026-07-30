-- ===========================================================================
-- GATE 1 AMENDMENT: the row-level-security policies the four read grants need.
--
-- THIS FILE IS AN AUTHORIZATION ARTIFACT, on the same terms as create-role.sql.
-- It is the exact, complete set of mutations this phase performs. The runner
-- (server/scripts/run-backtest-role.js) reads this file and substitutes ONLY
-- validated identifiers into the psql-style placeholders below. It never
-- assembles a policy, a table name, a command or a role in JavaScript.
--
-- WHY IT EXISTS
--
-- Gate 1 created the role with CONNECT, schema USAGE and SELECT on exactly four
-- tables, and verify proved all five grants present. Gate 2's extraction dry run
-- then read ZERO rows from players, player_stats and nfl_games, and real rows
-- from player_season_stats. Nothing was wrong with the grants. Those three
-- tables carry relrowsecurity = true and NO POLICIES AT ALL, and row-level
-- security with no policy is deny-all for every role that is not the table
-- owner. relforcerowsecurity is false, so the application - which connects AS
-- the owner - is exempt and never noticed. A SELECT privilege decides whether
-- the role may ask; a policy decides which rows it is answered with.
--
-- No migration in this repository enables RLS on those tables, so it was done
-- out of band, most likely from a hosting-console advisor.
--
-- WHAT IT CREATES
--
-- One PERMISSIVE policy per granted table, FOR SELECT, TO the backtest role
-- alone, with an unconditional USING (true). That is the narrowest instrument
-- that makes the already-approved SELECT grants mean what they say: it adds no
-- table, it names no other role, and it permits nothing but reading.
--
-- WHY player_season_stats GETS ONE TOO, EVEN THOUGH RLS IS OFF THERE
--
-- PostgreSQL consults policies only when relrowsecurity is on, so that policy is
-- inert the day it is created. It is created anyway because the four tables are
-- ONE read surface: whoever enabled RLS on the other three would say the same
-- thing about this one. Without the dormant policy, that flip would take the
-- role's read surface from four tables to three in silence - which is precisely
-- how this defect reached production contact. With it, the flip is a no-op.
--
-- WHY NOT BYPASSRLS
--
-- Two independent reasons, either one sufficient:
--
--   1. It is structurally unavailable. Only a SUPERUSER may grant BYPASSRLS,
--      and the Gate 1 admin operator is Supabase's hosted `postgres`
--      (rolsuper = false, rolcreaterole = true). `ALTER ROLE ... BYPASSRLS`
--      issued by it is denied.
--   2. Even from a superuser it would be the wrong instrument. BYPASSRLS is a
--      ROLE attribute, not a table one: it exempts the role from row-level
--      security on EVERY protected table in the database, present and future,
--      rather than on the four it holds SELECT on. A policy is bounded by the
--      object it sits on, and that bound is the whole design of this kit.
--      create-role.sql states NOBYPASSRLS explicitly and verify-role.sql
--      asserts it; nothing here weakens either.
--
-- WHO RUNS IT
--
-- The TABLE OWNER, not the Gate 1 admin operator. CREATE POLICY is gated on
-- ownership of the table, and CREATEROLE is not ownership: in production the
-- four tables are owned by the application role. That is a second, different
-- credential, read from its own environment variable
-- (BACKTEST_OWNER_DATABASE_URL) for the same reason the admin one is - so that
-- a shell holding either cannot silently perform the other's work. The runner
-- resolves the owner from pg_class and ABORTS unless current_user owns all four.
--
-- WHAT IT NEVER DOES
--
-- No statement here contains ALTER TABLE ... ENABLE, DISABLE or FORCE ROW LEVEL
-- SECURITY. Disabling RLS would remove a protection the database owner chose
-- for reasons this kit knows nothing about, and FORCE would apply RLS to the
-- owner as well, which is the application itself. The runner reads
-- relrowsecurity and relforcerowsecurity before and after the mutation and rolls
-- back if either moved.
--
-- IDEMPOTENT, FAIL CLOSED. A policy of the kit's name is never dropped and
-- re-created here. Either all four kit policies are absent, and all four are
-- created, or all four are already present in EXACTLY the expected shape and
-- the phase is a no-op. Anything else - a same-named policy of a different
-- shape, a policy this kit did not create sitting on a granted table, or a
-- partial set - ABORTS with nothing changed. The mutation runs in one
-- transaction whose post-conditions are asserted BEFORE the COMMIT, so a policy
-- that did not land in the expected shape is rolled back rather than reported.
--
-- PLACEHOLDERS (see create-role.sql for the psql conventions):
--
--   psql -v role_ident=backtest_ro_pit01 -v role_name=backtest_ro_pit01 \
--        -v policy_ident=backtest_ro_pit01_select -f grant-rls-policies.sql
--
-- @placeholders: role_ident, role_name, policy_ident
--
--   :"role_ident"    the role, as a quoted IDENTIFIER
--   :'role_name'     the role, as a quoted string LITERAL
--   :"policy_ident"  the policy name, as a quoted IDENTIFIER. Derived from the
--                    role rather than supplied - <role>_select - so that every
--                    policy this kit can make is identifiable at a glance and
--                    belongs to exactly one role.
--
-- No expiry is needed: a policy has none. The role's VALID UNTIL governs logins
-- and is checked by verify-role.sql.
--
-- AUTHORIZATION. Executing this against production requires the user's explicit
-- Gate 1 approval, on the same terms as create-role.sql. Nothing in the
-- repository is permitted to run it automatically.
-- ===========================================================================


-- @statement: policy_preflight_context
-- The accident guard, same as create-role.sql's: the runner refuses to continue
-- unless the server reports exactly the database named on the command line, so
-- a correct command aimed at the wrong connection string stops here rather than
-- writing policies into some other cluster.
--
-- It does NOT report SUPERUSER or CREATEROLE, because this phase needs neither.
-- What it needs is ownership, and ownership is resolved per table by
-- policy_table_rls_state below rather than inferred from a role attribute.
SELECT
  current_database() AS database_name,
  current_user       AS connected_role;


-- @statement: policy_preflight_role_present
-- FAIL CLOSED if the role is absent. `CREATE POLICY ... TO` a role that does not
-- exist raises a bare "role does not exist", and the shape check below would
-- read every existing policy as foreign, because the role OID it compares
-- against would be NULL. Both are correct refusals wearing an unreadable
-- message. This block is what lets the message say what actually happened.
SELECT
  rolname     AS role_name,
  rolcanlogin AS can_login
FROM pg_roles
WHERE rolname = :'role_name';


-- @statement: policy_table_rls_state
-- The four granted tables: who owns them, and their row-security flags.
--
-- OWNERSHIP is the authorization for everything below, and it is resolved from
-- pg_class rather than assumed from the connection string: a connection string
-- says which credential was used and nothing about what that credential owns.
--
-- relrowsecurity is REPORTED, never asserted on. Whether RLS is enabled is the
-- database owner's decision, and this kit's job is to be correct under either
-- answer. relforcerowsecurity IS asserted on, and must be false: FORCE applies
-- row-level security to the table's OWNER as well, so a true here would mean the
-- application itself is being filtered by policies written for a backtest role.
--
-- The runner also reads this block AFTER the mutation and rolls back if any flag
-- moved, which is what makes "this file never touches RLS itself" a checked
-- claim rather than a promise.
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
-- EVERY policy on the four granted tables, whoever made it, read from pg_policy
-- rather than the pg_policies view so that the role match is an OID comparison
-- instead of a rendered name.
--
-- roles_are_exactly_the_role is the load-bearing column: polroles must EQUAL the
-- one-element array holding this role's OID. A policy naming the role and
-- somebody else is a different policy, and one naming PUBLIC would apply to
-- every role in the cluster. When the role does not exist the subquery yields
-- NULL, the array comparison yields NULL, and NULL is not true - so an absent
-- role fails this check closed.
--
-- using_is_unconditional compares the deparsed qualifier against 'true'. That is
-- a rendered EXPRESSION, not a rendered object signature: there is no OID for
-- "the boolean constant true", and the comparison can only fail closed, because
-- any rendering the runner does not recognise aborts the phase. using_expression
-- rides alongside it for DIAGNOSTICS and is never the match criterion.
--
-- polcmd is a single character: 'r' is FOR SELECT, '*' is FOR ALL, and 'a', 'w'
-- and 'd' are INSERT, UPDATE and DELETE. Only 'r' is accepted.
--
-- A policy this kit did not create, sitting on one of these tables, is a hard
-- finding rather than a curiosity: a RESTRICTIVE policy narrows what the role
-- reads with no error anywhere, which would shrink Gate 2's snapshot silently.
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
-- Everything below MUTATES. The runner has checked the four blocks above and
-- runs the rest inside one transaction whose post-conditions are asserted
-- before the COMMIT.
-- ---------------------------------------------------------------------------


-- @statement: create_policies
-- Four policies, one per granted table, named individually. Deliberately NOT
-- generated by a DO block looping over a table list: a loop is a place where a
-- fifth table could arrive without a reviewer seeing it, and the whole claim of
-- this directory is that the reviewer reads the mutation itself.
--
-- AS PERMISSIVE, FOR SELECT and TO :"role_ident" are stated explicitly even
-- where they are the default, for the same reason create-role.sql states every
-- role flag: a reader should not have to know PostgreSQL's defaults to know what
-- this permits, and a future PostgreSQL that changes one cannot change it.
--
-- USING (true) is unconditional ON PURPOSE. The bound on what the role can read
-- is the SELECT grant, which names four tables and nothing else. A row predicate
-- here would reshape the snapshot Gate 2 measures without appearing anywhere in
-- the extraction, and a backtest run against a quietly filtered copy of
-- production is worse than no backtest.
--
-- There is no WITH CHECK clause because FOR SELECT takes none: WITH CHECK
-- governs rows being written, and this role holds no write privilege anywhere.
--
-- Policy names are per-table, so the same name on four tables is four distinct
-- policies rather than a collision.
CREATE POLICY :"policy_ident" ON public.players
  AS PERMISSIVE FOR SELECT TO :"role_ident" USING (true);
CREATE POLICY :"policy_ident" ON public.player_stats
  AS PERMISSIVE FOR SELECT TO :"role_ident" USING (true);
CREATE POLICY :"policy_ident" ON public.player_season_stats
  AS PERMISSIVE FOR SELECT TO :"role_ident" USING (true);
CREATE POLICY :"policy_ident" ON public.nfl_games
  AS PERMISSIVE FOR SELECT TO :"role_ident" USING (true);
