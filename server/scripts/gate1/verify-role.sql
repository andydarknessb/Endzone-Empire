-- ===========================================================================
-- GATE 1: verify the temporary read-only role.
--
-- Runs as its own phase, and is also usable standalone at any time while the
-- role exists (including days later, to confirm nothing has been widened). It
-- mutates nothing: every statement here is a SELECT.
--
-- PLACEHOLDERS (see create-role.sql for the psql conventions):
--
--   psql -v role_name=backtest_ro_pit01 -v database_name=endzone_empire \
--        -v valid_until='2026-08-02T00:00:00Z' -f verify-role.sql
--
-- @placeholders: role_name, database_name, valid_until
--
--   :'role_name'      the role, as a quoted string LITERAL
--   :'database_name'  the database, as a quoted string LITERAL
--   :'valid_until'    the expiry to compare against, as a quoted string LITERAL
--
-- This file needs no identifier form of either name: nothing here is DDL, so
-- both arrive as arguments to has_*_privilege and as catalog comparisons.
--
-- WHAT "VERIFY" HAS TO MEAN
--
-- Checking that the role HAS the privileges it should is the easy half and the
-- useless half: `has_table_privilege` returning true on four tables says
-- nothing about a fifth. So the load-bearing checks below are ENUMERATIONS -
-- they list every privilege the role holds, anywhere in the cluster, and the
-- runner fails if the list is not exactly the expected one.
--
-- WHY aclexplode() AND NOT information_schema.role_table_grants
--
-- `information_schema.role_table_grants` shows only rows "where the grantor or
-- grantee is a currently enabled role". The admin running this is not
-- automatically a member of the backtest role, so the only rows it would see
-- are the ones IT granted. A privilege granted to the role by some other role
-- would be invisible, and the enumeration would pass while missing exactly the
-- thing it exists to catch. `aclexplode()` over the catalogs has no such
-- filter: it decodes the stored ACL itself.
--
-- WHAT IS DELIBERATELY NOT CHECKED, AND WHY
--
-- Privileges held by the PUBLIC pseudo-role apply to every role in the cluster,
-- including this one. In a default PostgreSQL that includes CONNECT on the
-- database, USAGE on schema public, and EXECUTE on every function. Those are
-- NOT enumerated as privileges "of" this role, because they are not: they are
-- properties of the cluster. This kit does not revoke anything from PUBLIC, and
-- must not - revoking a PUBLIC grant would change behaviour for the
-- application, for every other role, and for a database this backtest has no
-- business mutating. The consequence, stated plainly: the temporary role can
-- execute functions and connect to databases beyond what this file grants,
-- exactly as any other role in the cluster can. What it cannot do is READ any
-- table beyond the four below, because table privileges are not granted to
-- PUBLIC here, and the enumeration proves it.
--
-- NOINHERIT does not change any of the above. NOINHERIT governs privileges
-- reached through role MEMBERSHIP; PUBLIC is not a membership.
--
-- WHICH ACL CLASSES ARE ENUMERATED, AND WHICH ARE NOT
--
-- PostgreSQL stores ACLs in a dozen catalogs, and "the role holds exactly these
-- privileges" is only as true as the list of catalogs actually read. Enumerated
-- below: relations (pg_class.relacl), COLUMNS (pg_attribute.attacl), functions
-- and procedures (pg_proc.proacl), schemas (pg_namespace.nspacl), databases
-- (pg_database.datacl), and default privileges (pg_default_acl). Those cover
-- every class this kit grants, plus the two that are invisible to a naive check
-- and would matter most if set: column grants, which do not appear in relacl at
-- all, and default privileges, which apply to objects that do not exist yet.
--
-- NOT enumerated: types and domains (pg_type.typacl), languages
-- (pg_language.lanacl), foreign-data wrappers and foreign servers
-- (pg_foreign_data_wrapper.fdwacl, pg_foreign_server.srvacl), tablespaces
-- (pg_tablespace.spcacl), large objects (pg_largeobject_metadata.lomacl), and
-- PostgreSQL 15+ configuration-parameter grants (pg_parameter_acl.paracl).
--
-- The reason they are out of scope is a property of the WORKFLOW, not a claim
-- that they are harmless. This role is created fresh by create-role.sql, which
-- grants none of them, and verified immediately afterwards; the window in which
-- one could have been added is the seconds between the two, by someone who
-- already has admin rights on the cluster. What the omission does mean, said
-- plainly: if this verify is run standalone against a role that has existed for
-- days, a privilege in one of those classes would not be reported. None of them
-- confers table read access, which is the risk this kit exists to bound, but
-- USAGE on a language or a foreign server is not nothing, and a reader should
-- know the check does not look there.
-- ===========================================================================


-- @statement: verify_role_flags
-- Every attribute of the role, including the expiry, compared against what the
-- operator supplied on the command line. A role whose VALID UNTIL was silently
-- dropped is a role that never expires.
SELECT
  r.rolname                                   AS role_name,
  r.rolsuper                                  AS rolsuper,
  r.rolcreatedb                               AS rolcreatedb,
  r.rolcreaterole                             AS rolcreaterole,
  r.rolinherit                                AS rolinherit,
  r.rolreplication                            AS rolreplication,
  r.rolbypassrls                              AS rolbypassrls,
  r.rolcanlogin                               AS rolcanlogin,
  r.rolconnlimit                              AS rolconnlimit,
  r.rolvaliduntil                             AS rolvaliduntil,
  (r.rolvaliduntil = :'valid_until'::timestamptz) AS valid_until_matches,
  (r.rolvaliduntil > now())                   AS valid_until_in_future
FROM pg_roles r
WHERE r.rolname = :'role_name';


-- @statement: verify_role_settings
-- pg_db_role_setting holds per-role GUC defaults. setdatabase = 0 means the
-- setting applies to the role in EVERY database, which is what
-- `ALTER ROLE ... SET` (without IN DATABASE) produces and what is wanted here.
SELECT
  s.setdatabase AS set_database_oid,
  s.setconfig   AS set_config
FROM pg_db_role_setting s
JOIN pg_roles r ON r.oid = s.setrole
WHERE r.rolname = :'role_name'
ORDER BY s.setdatabase;


-- @statement: verify_effective_privileges
-- The positive half: the role really can do each thing it is supposed to do.
-- Read these as necessary but NOT sufficient - CONNECT, schema USAGE and
-- function EXECUTE would all report true from the PUBLIC grants alone. The
-- enumeration blocks below are what make the answer sufficient.
SELECT
  has_database_privilege(:'role_name', :'database_name', 'CONNECT')                       AS db_connect,
  has_schema_privilege(:'role_name', 'public', 'USAGE')                                   AS schema_usage,
  has_table_privilege(:'role_name', 'public.players', 'SELECT')                           AS select_players,
  has_table_privilege(:'role_name', 'public.player_stats', 'SELECT')                      AS select_player_stats,
  has_table_privilege(:'role_name', 'public.player_season_stats', 'SELECT')               AS select_player_season_stats,
  has_table_privilege(:'role_name', 'public.nfl_games', 'SELECT')                         AS select_nfl_games,
  has_function_privilege(:'role_name', 'public.fn_normalize_nfl_team(text)', 'EXECUTE')   AS execute_normalize,
  -- The negative half, spot-checked on the tables the role IS allowed to read:
  -- if any of these came back true the role could mutate the very data the
  -- backtest is measuring.
  has_table_privilege(:'role_name', 'public.players', 'INSERT')                           AS insert_players,
  has_table_privilege(:'role_name', 'public.players', 'UPDATE')                           AS update_players,
  has_table_privilege(:'role_name', 'public.players', 'DELETE')                           AS delete_players,
  has_table_privilege(:'role_name', 'public.nfl_games', 'UPDATE')                         AS update_nfl_games,
  has_schema_privilege(:'role_name', 'public', 'CREATE')                                  AS schema_create;


-- @statement: verify_relation_acl_enumeration
-- EVERY relation privilege held directly by this role, in every schema, decoded
-- from the stored ACL. The runner requires this to be exactly four rows, all
-- SELECT, on the four expected tables. Any fifth row fails the phase.
SELECT
  n.nspname          AS schema_name,
  c.relname          AS object_name,
  c.relkind          AS object_kind,
  a.privilege_type   AS privilege_type,
  a.is_grantable     AS is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) AS a
WHERE c.relacl IS NOT NULL
  AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
ORDER BY n.nspname, c.relname, a.privilege_type;


-- @statement: verify_column_acl_enumeration
-- COLUMN-level privileges live in pg_attribute.attacl, NOT pg_class.relacl, so
-- `GRANT SELECT (ssn) ON public.users TO role` is completely invisible to the
-- relation enumeration above: pg_class.relacl for that table stays untouched.
-- A column grant is a real read privilege on a table this role is not supposed
-- to be able to read at all, and it is the one ACL class most likely to be
-- added by a well-meaning "just let it see this one field". Expected: no rows.
SELECT
  n.nspname          AS schema_name,
  c.relname          AS object_name,
  att.attname        AS column_name,
  a.privilege_type   AS privilege_type,
  a.is_grantable     AS is_grantable
FROM pg_attribute att
JOIN pg_class c ON c.oid = att.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(att.attacl) AS a
WHERE att.attacl IS NOT NULL
  AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
ORDER BY n.nspname, c.relname, att.attname, a.privilege_type;


-- @statement: verify_function_acl_enumeration
-- Every FUNCTION privilege held directly by this role. Expected: exactly one
-- EXECUTE, on fn_normalize_nfl_team(text).
SELECT
  n.nspname                                 AS schema_name,
  p.proname                                 AS object_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  a.privilege_type                          AS privilege_type,
  a.is_grantable                            AS is_grantable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) AS a
WHERE p.proacl IS NOT NULL
  AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
ORDER BY n.nspname, p.proname, a.privilege_type;


-- @statement: verify_schema_acl_enumeration
-- Every SCHEMA privilege held directly by this role. Expected: exactly one
-- USAGE, on public. A CREATE here would let the role make tables.
SELECT
  n.nspname        AS object_name,
  a.privilege_type AS privilege_type,
  a.is_grantable   AS is_grantable
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(n.nspacl) AS a
WHERE n.nspacl IS NOT NULL
  AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
ORDER BY n.nspname, a.privilege_type;


-- @statement: verify_database_acl_enumeration
-- Every DATABASE privilege held directly by this role, across the whole
-- cluster. Expected: exactly one CONNECT, on the named database. A CONNECT on
-- some OTHER database would be a surprise worth failing on.
SELECT
  d.datname        AS object_name,
  a.privilege_type AS privilege_type,
  a.is_grantable   AS is_grantable
FROM pg_database d
CROSS JOIN LATERAL aclexplode(d.datacl) AS a
WHERE d.datacl IS NOT NULL
  AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
ORDER BY d.datname, a.privilege_type;


-- @statement: verify_default_acl_enumeration
-- DEFAULT privileges: an ACL that applies automatically to objects created in
-- future. These are invisible to every "what can this role read" check that
-- looks only at objects existing today, which is precisely why they are
-- enumerated. Expected: no rows at all.
SELECT
  COALESCE(n.nspname, '(all schemas)') AS schema_name,
  d.defaclobjtype                      AS object_type,
  a.privilege_type                     AS privilege_type
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
ORDER BY schema_name, d.defaclobjtype, a.privilege_type;


-- @statement: verify_no_ownership
-- pg_shdepend records every dependency on a shared object such as a role.
-- deptype 'o' means the role OWNS the object; 'r' means an RLS policy names it.
-- Either would mean the role has become load-bearing for something, and would
-- make a later DROP ROLE either fail or cascade. deptype 'a' (an ACL entry) is
-- EXPECTED and excluded here: those are the grants above, and they are checked
-- by name in the enumeration blocks rather than counted here.
SELECT
  s.deptype                            AS dependency_type,
  s.classid::regclass::text            AS catalog_name,
  s.objid                              AS object_oid,
  d.datname                            AS database_name
FROM pg_shdepend s
LEFT JOIN pg_database d ON d.oid = s.dbid
WHERE s.refobjid = (SELECT oid FROM pg_roles WHERE rolname = :'role_name')
  AND s.deptype IN ('o', 'r')
ORDER BY s.deptype, s.objid;


-- @statement: verify_no_memberships
-- Both directions. `member_of` would give the role someone else's privileges;
-- `members` would give someone else this role's login. Expected: no rows.
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
