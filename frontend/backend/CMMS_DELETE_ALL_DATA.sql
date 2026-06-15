-- ============================================================
-- CMMS DELETE ALL DATA
-- Deletes ALL existing CMMS records from:
-- 1) Every public table named cmms_*
-- 2) Legacy CMMS tables: companies, users, user_roles, roles (if they exist)
-- ============================================================
-- WARNING: This is destructive and irreversible.
-- Run in Supabase SQL Editor.

BEGIN;

-- --------------------------------------------
-- Preview current row counts (CMMS tables)
-- --------------------------------------------
DO $$
DECLARE
  rec RECORD;
  row_count BIGINT;
BEGIN
  RAISE NOTICE '--- CMMS row counts before delete ---';
  FOR rec IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'cmms\_%' ESCAPE '\'
    ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', rec.tablename) INTO row_count;
    RAISE NOTICE 'public.%: % rows', rec.tablename, row_count;
  END LOOP;
END $$;

-- --------------------------------------------
-- Truncate all cmms_* tables
-- --------------------------------------------
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'cmms\_%' ESCAPE '\'
    ORDER BY tablename
  LOOP
    EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', rec.tablename);
  END LOOP;
END $$;

-- --------------------------------------------
-- Truncate legacy CMMS tables if present
-- --------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles', 'users', 'companies', 'roles']
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
    END IF;
  END LOOP;
END $$;

-- --------------------------------------------
-- Verify row counts after delete (CMMS tables)
-- --------------------------------------------
DO $$
DECLARE
  rec RECORD;
  row_count BIGINT;
BEGIN
  RAISE NOTICE '--- CMMS row counts after delete ---';
  FOR rec IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'cmms\_%' ESCAPE '\'
    ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', rec.tablename) INTO row_count;
    RAISE NOTICE 'public.%: % rows', rec.tablename, row_count;
  END LOOP;
END $$;

COMMIT;

