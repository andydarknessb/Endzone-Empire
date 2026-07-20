-- Run through a direct PostgreSQL connection as a privileged administrator.
-- Do not run ALTER SYSTEM through Supavisor transaction mode.

-- Role-scoped memory for new calculation-role sessions. work_mem is available
-- to every sort/hash node in a query, so validate memory headroom before using
-- 64 MB with high query concurrency.
ALTER ROLE postgres SET work_mem = '64MB';

-- Self-hosted PostgreSQL only. max_connections is a cluster-start parameter:
-- this writes postgresql.auto.conf but does not take effect until PostgreSQL is
-- restarted. Managed Supabase projects should resize compute or adjust the
-- Supavisor pool in Database Settings instead of running this statement.
ALTER SYSTEM SET max_connections = '300';

-- work_mem is visible to new sessions immediately; max_connections reports a
-- pending restart until the database has restarted.
SELECT name, setting, unit, context, pending_restart
FROM pg_settings
WHERE name IN ('max_connections', 'work_mem')
ORDER BY name;
