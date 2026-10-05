-- Stub tables for the v2 (business) tests: columns as in the real schema. Not a migration.
\set ON_ERROR_STOP on
ALTER TABLE public.supermarkets ADD COLUMN IF NOT EXISTS pichin_business_profile_id UUID;

CREATE TABLE public.business_profiles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, business_name VARCHAR, country VARCHAR,
  verification_status VARCHAR, supermarket_id UUID);
CREATE TABLE public.business_profile_members (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_profile_id UUID, user_id UUID, role TEXT, status TEXT);
CREATE TABLE public.business_app_links (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_profile_id UUID, app_key TEXT, source_entity_id UUID, status TEXT);
CREATE TABLE public.cmms_company_profiles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_name VARCHAR, business_profile_id UUID,
  pichin_business_profile_id UUID, branch_name VARCHAR);
CREATE TABLE public.cmms_departments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cmms_company_id UUID, department_name VARCHAR, annual_budget NUMERIC,
  budget_used NUMERIC, is_active BOOLEAN DEFAULT TRUE);
CREATE TABLE public.cmms_inventory_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cmms_company_id UUID, item_code VARCHAR, item_name VARCHAR, category VARCHAR,
  quantity_in_stock NUMERIC, reorder_level NUMERIC, reorder_quantity NUMERIC, unit_of_measure VARCHAR, supplier_name VARCHAR, lead_time_days INTEGER,
  is_active BOOLEAN DEFAULT TRUE, item_kind VARCHAR, asset_tag VARCHAR, serial_number VARCHAR, manufacturer VARCHAR, model VARCHAR, acquisition_date DATE,
  acquisition_cost NUMERIC, useful_life_years INTEGER, salvage_value NUMERIC, depreciation_method VARCHAR, asset_condition VARCHAR, asset_status VARCHAR,
  warranty_expiry DATE, disposed_at TIMESTAMPTZ, unit_price NUMERIC, assigned_storeman_id UUID, created_by UUID);
CREATE TABLE public.cmms_inventory_transactions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cmms_company_id UUID, item_id UUID, txn_type VARCHAR,
  quantity NUMERIC, txn_date TIMESTAMPTZ DEFAULT now(), actor_email VARCHAR);
CREATE TABLE public.cmms_requisitions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cmms_company_id UUID, department_id UUID, requisition_number VARCHAR,
  requisition_date TIMESTAMPTZ DEFAULT now(), requested_by_email VARCHAR, requested_by_name VARCHAR, purpose VARCHAR, urgency_level VARCHAR, status VARCHAR,
  total_estimated_cost NUMERIC, budget_sufficient BOOLEAN, required_by_date DATE, expected_delivery_date TIMESTAMPTZ, actual_delivery_date TIMESTAMPTZ);
CREATE TABLE public.cmms_job_assignments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID, assigned_to_user_id UUID, job_title VARCHAR,
  job_description TEXT, assignment_status VARCHAR, due_date DATE, priority VARCHAR, progress_percentage SMALLINT, last_progress_update TIMESTAMPTZ);

CREATE TABLE public.products (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, category TEXT, barcode TEXT, image_url TEXT, supermarket_id UUID,
  is_active BOOLEAN DEFAULT TRUE, sku VARCHAR, cost_price NUMERIC, selling_price NUMERIC, unit TEXT, brand VARCHAR, is_service BOOLEAN DEFAULT FALSE,
  track_inventory BOOLEAN DEFAULT TRUE, expiry_date DATE, reorder_level NUMERIC, clearance_original_price NUMERIC, clearance_published_at TIMESTAMPTZ);
CREATE TABLE public.inventory (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), supermarket_id UUID, product_id UUID, quantity INTEGER, current_stock NUMERIC,
  reserved_stock NUMERIC DEFAULT 0, minimum_stock NUMERIC, reorder_point NUMERIC);
CREATE TABLE public.product_inventory_batches (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID, supermarket_id UUID, batch_number TEXT,
  expiry_date DATE, current_stock NUMERIC, purchase_price NUMERIC, selling_price NUMERIC, status TEXT);

CREATE TABLE public.payment_requests (id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL, payment_code VARCHAR(50) UNIQUE NOT NULL, amount NUMERIC(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD', description TEXT, status VARCHAR(20) NOT NULL DEFAULT 'pending', payer_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
  payment_method VARCHAR(10) NOT NULL DEFAULT 'ican', recipient_classification TEXT NOT NULL DEFAULT 'personal', recipient_business_profile_id UUID, recipient_name TEXT);

CREATE TABLE public.ican_coin_transactions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, type TEXT, transaction_type TEXT, ican_amount NUMERIC,
  status TEXT, timestamp TIMESTAMPTZ DEFAULT now(), created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.user_accounts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, ican_coin_balance NUMERIC, ican_coin_total_purchased NUMERIC,
  ican_coin_total_sold NUMERIC);
CREATE TABLE public.icaneracoin_integrity_chain (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), seq BIGINT UNIQUE, event_type TEXT, row_snapshot JSONB,
  previous_hash TEXT, chain_hash TEXT, created_at TIMESTAMPTZ DEFAULT now());

CREATE TYPE mbg_ride_status AS ENUM ('pending', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TABLE public.mbg_customers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID);
CREATE TABLE public.mbg_rides (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID, rider_id UUID, status mbg_ride_status DEFAULT 'pending',
  distance_km NUMERIC, fare NUMERIC, requested_at TIMESTAMPTZ DEFAULT now(), accepted_at TIMESTAMPTZ, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());

-- The platform's existing country lookup (franchise layer) and the table it reads, as the developer accounts reuse them.
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS country_code VARCHAR;
CREATE OR REPLACE FUNCTION public.ican_franchise_country_of(p_user UUID, p_business UUID) RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT upper(country_code)::VARCHAR FROM public.user_accounts WHERE user_id = p_user AND country_code IS NOT NULL LIMIT 1 $$;
