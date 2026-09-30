-- The email delivery scheduler is environment-specific, but every environment
-- that runs it needs pg_cron for scheduling and pg_net for the authenticated
-- HTTPS request to the application worker. The secret and job are configured
-- operationally so environment URLs and credentials never enter source control.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
