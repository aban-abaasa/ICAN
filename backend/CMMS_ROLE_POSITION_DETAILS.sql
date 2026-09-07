-- ============================================================
-- CMMS Role Configuration -> Position Details
-- ============================================================
-- cmms_roles (see CMMS_ADMIN_MANAGED_ROLES.sql) is purely a permission
-- construct: display_name, permission_level, tool_access JSONB. It has no
-- HR/job facts. This adds an optional "Position Details" profile directly
-- onto the same role row so a company can define a role once (e.g.
-- "Warehouse Supervisor") and reuse its job title/department/salary/etc.
-- both for real employee context and to auto-fill a job posting (see
-- CMMS_ANNOUNCEMENTS_AND_JOBS.sql's cmms_announcements) instead of retyping
-- the same facts twice.
--
-- All columns are nullable -- a role can stay a pure permission bundle with
-- no Position Details set, and existing roles are unaffected.
--
-- Run after: CMMS_ADMIN_MANAGED_ROLES.sql, CMMS_ANNOUNCEMENTS_AND_JOBS.sql
-- (employment_type reuses the same value set as cmms_announcements).
-- Safe to run more than once.
-- ============================================================

ALTER TABLE public.cmms_roles
  ADD COLUMN IF NOT EXISTS job_title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS department VARCHAR(150),
  ADD COLUMN IF NOT EXISTS employment_type VARCHAR(30)
    CHECK (employment_type IS NULL OR employment_type IN
      ('full_time', 'part_time', 'contract', 'internship', 'temporary', 'volunteer')),
  ADD COLUMN IF NOT EXISTS positions_available INTEGER CHECK (positions_available IS NULL OR positions_available > 0),
  ADD COLUMN IF NOT EXISTS salary_range VARCHAR(150),
  ADD COLUMN IF NOT EXISTS job_description TEXT,
  ADD COLUMN IF NOT EXISTS responsibilities TEXT,
  ADD COLUMN IF NOT EXISTS required_skills TEXT;

COMMENT ON COLUMN public.cmms_roles.job_title IS 'Position Details: the job title a job posting created "from this role" should default to (e.g. "Warehouse Supervisor"). NULL = this role has no Position Details defined yet.';

NOTIFY pgrst, 'reload schema';

SELECT 'CMMS role Position Details columns installed' AS status;
