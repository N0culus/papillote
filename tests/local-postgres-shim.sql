-- OPTIONNEL : permet de tester schema.sql sur un Postgres ordinaire (hors Supabase),
-- par exemple dans Docker. Sur Supabase, NE PAS l'exécuter (ces objets existent déjà).
--   docker run --rm -d --name papillote-pg -e POSTGRES_PASSWORD=pw -p 54329:5432 postgres:16
--   psql "postgresql://postgres:pw@localhost:54329/postgres" -v ON_ERROR_STOP=1 \
--        -f tests/local-postgres-shim.sql -f supabase/schema.sql -f tests/security.sql

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists extensions;
grant usage on schema public to anon, authenticated;

-- Reproduit le comportement Supabase : EXECUTE accordé par défaut aux nouvelles fonctions
alter default privileges in schema public grant execute on functions to anon, authenticated;
