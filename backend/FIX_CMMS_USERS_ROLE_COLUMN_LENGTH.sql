-- ================================================================
-- FIX: cmms_users.role too narrow for role names it actually stores
-- ================================================================
-- "Add User" (CMSSModule.jsx handleAddUser) inserts the company's role
-- definition name straight into cmms_users.role. Role names live in
-- cmms_role_definitions.role_name / cmms_roles.role_name, both
-- VARCHAR(100), but cmms_users.role was only VARCHAR(50) (see
-- CMMS_COMPLETE_SCHEMA.sql). Any company with a custom role name over
-- 50 characters gets:
--   "Error adding user to database: value too long for type
--    character varying(50)"
-- Local testing only ever used short default role names (Admin,
-- Technician, ...), so this never surfaced there — it's not an
-- environment difference, both point at the same Supabase project.
--
-- Widen to VARCHAR(100) to match the role-name source columns.
-- Run once in the Supabase SQL Editor.
-- ================================================================

ALTER TABLE public.cmms_users
  ALTER COLUMN role TYPE VARCHAR(100);

SELECT 'cmms_users.role widened to VARCHAR(100)' AS status;
