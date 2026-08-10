-- Unified business management, supplier marketplace, and adaptive CMMS.
-- Additive migration. Run after the shared business authority migrations.

CREATE TABLE IF NOT EXISTS public.business_category_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  operating_mode TEXT NOT NULL DEFAULT 'operational'
    CHECK (operating_mode IN ('retail_adapter', 'operational', 'enterprise')),
  default_modules JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_departments JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_profile_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, module_key)
);

CREATE TABLE IF NOT EXISTS public.business_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  department_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, department_name)
);

CREATE TABLE IF NOT EXISTS public.business_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  visibility_scope TEXT NOT NULL DEFAULT 'department'
    CHECK (visibility_scope IN ('own', 'department', 'company')),
  is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, role_key)
);

CREATE TABLE IF NOT EXISTS public.business_role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_role_id UUID NOT NULL REFERENCES public.business_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS public.business_member_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  auth_user_id UUID NOT NULL,
  business_role_id UUID NOT NULL REFERENCES public.business_roles(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.business_departments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  assigned_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, auth_user_id, business_role_id, department_id)
);

CREATE TABLE IF NOT EXISTS public.supplier_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL UNIQUE REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  supplier_user_id UUID NOT NULL,
  supplier_type TEXT NOT NULL DEFAULT 'supplier',
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  service_regions JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- BodaGoera remains the shared transport layer for every published supplier,
-- including wholesale businesses and factories that also sell their own
-- goods or raw materials. Supplier delivery is still available as a fallback.
ALTER TABLE public.supplier_directory
  ADD COLUMN IF NOT EXISTS transport_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS transport_provider TEXT NOT NULL DEFAULT 'bodagoera',
  ADD COLUMN IF NOT EXISTS transport_modes JSONB NOT NULL DEFAULT '["mybodaguy_delivery","supplier_delivery"]'::jsonb;

CREATE TABLE IF NOT EXISTS public.supplier_business_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  buyer_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('requested', 'active', 'paused', 'ended')),
  terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_business_profile_id, buyer_business_profile_id)
);

CREATE TABLE IF NOT EXISTS public.supplier_catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  unit TEXT NOT NULL DEFAULT 'unit',
  min_order_qty NUMERIC(18,4) NOT NULL DEFAULT 1 CHECK (min_order_qty > 0),
  price_per_unit NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (price_per_unit >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade older catalogue tables created before metadata was introduced.
ALTER TABLE public.supplier_catalog_items
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_supplier
  ON public.supplier_catalog_items(supplier_business_profile_id, is_available);

-- Import existing Supermarketa supplier products into the shared catalogue
-- when those legacy tables are installed. This is intentionally guarded so
-- deployments that do not use the legacy product tables still succeed.
DO $$
BEGIN
  IF to_regclass('public.products') IS NOT NULL
     AND to_regclass('public.suppliers') IS NOT NULL
     AND to_regclass('public.categories') IS NOT NULL THEN
    INSERT INTO public.supplier_catalog_items
      (supplier_business_profile_id, name, category, unit, min_order_qty, price_per_unit, currency, metadata)
    SELECT bp.id,
           p.name,
           COALESCE(NULLIF(trim(c.name), ''), 'general'),
           'unit',
           1,
           COALESCE(p.cost_price, 0),
           'UGX',
           jsonb_build_object('source', 'supermarketa_products', 'source_product_id', p.id)
      FROM public.products p
      JOIN public.suppliers s ON s.id = p.supplier_id
      LEFT JOIN public.categories c ON c.id = p.category_id
      JOIN public.business_profiles bp
        ON bp.user_id = s.user_id
       AND COALESCE(bp.status, 'active') = 'active'
     WHERE COALESCE(p.is_active, TRUE) = TRUE
       AND p.supplier_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.supplier_catalog_items existing
          WHERE existing.supplier_business_profile_id = bp.id
            AND existing.metadata ->> 'source_product_id' = p.id::TEXT
       );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.supplier_marketplace_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  supplier_business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  supplier_catalog_item_id UUID REFERENCES public.supplier_catalog_items(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL UNIQUE,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(18,4),
  currency TEXT NOT NULL DEFAULT 'UGX',
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'quoted', 'accepted', 'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled')),
  delivery_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_marketplace_orders
  ADD COLUMN IF NOT EXISTS transport_provider TEXT NOT NULL DEFAULT 'bodagoera',
  ADD COLUMN IF NOT EXISTS transport_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS transport_method TEXT,
  ADD COLUMN IF NOT EXISTS preferred_vehicle_type TEXT,
  ADD COLUMN IF NOT EXISTS bodago_delivery_request_id UUID,
  ADD COLUMN IF NOT EXISTS pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;

CREATE TABLE IF NOT EXISTS public.cmms_external_asset_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  -- Kept as an optional UUID so this migration also works in deployments
  -- where CMMS_ASSET_INVENTORY_FOUNDATION.sql has not been installed yet.
  -- The application-level link remains valid once the CMMS asset table exists.
  cmms_asset_id UUID,
  app_key TEXT NOT NULL,
  source_entity_id UUID NOT NULL,
  source_of_truth TEXT NOT NULL DEFAULT 'source_app'
    CHECK (source_of_truth IN ('source_app', 'cmms', 'shared')),
  sync_status TEXT NOT NULL DEFAULT 'active'
    CHECK (sync_status IN ('active', 'paused', 'error', 'retired')),
  last_source_event_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_key, source_entity_id)
);

CREATE TABLE IF NOT EXISTS public.cmms_operational_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  app_key TEXT NOT NULL,
  source_entity_id UUID,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_profile_id, app_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_business_profile_modules_profile ON public.business_profile_modules(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_business_departments_profile ON public.business_departments(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_business_member_roles_user ON public.business_member_roles(auth_user_id, business_profile_id);
CREATE INDEX IF NOT EXISTS idx_supplier_directory_published ON public.supplier_directory(is_published, supplier_type);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_buyer ON public.supplier_marketplace_orders(buyer_business_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_supplier ON public.supplier_marketplace_orders(supplier_business_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_cmms_events_business ON public.cmms_operational_events(business_profile_id, event_at DESC);

INSERT INTO public.business_category_templates
  (category_key, display_name, operating_mode, default_modules, default_departments, default_roles, required_documents)
VALUES
('retail', 'Retail', 'retail_adapter', '{"inventory":true,"supplier_marketplace":true,"cmms_assets":true,"maintenance":true,"reports":true}', '["Store Operations","Inventory","Finance"]', '["business_admin","store_manager","inventory_receiver","cashier"]', '[]'),
('wholesale', 'Wholesale', 'retail_adapter', '{"inventory":true,"supplier_marketplace":true,"cmms_assets":true,"warehouse":true,"maintenance":true,"reports":true,"bodagoera_transport":true}', '["Warehouse","Procurement","Sales","Finance"]', '["business_admin","warehouse_manager","inventory_receiver","buyer"]', '[]'),
('factory', 'Factory / Manufacturing', 'operational', '{"assets":true,"inventory":true,"maintenance":true,"work_orders":true,"bom":true,"wip_locks":true,"supplier_marketplace":true,"reports":true,"bodagoera_transport":true}', '["Production","Maintenance","Warehouse","Quality","Finance"]', '["business_admin","production_manager","technician","storeman","quality_manager"]', '["registration","operating_license"]'),
('supplier', 'Supplier / Raw Materials', 'operational', '{"supplier_marketplace":true,"catalog":true,"orders":true,"delivery":true,"bodagoera_transport":true,"reports":true}', '["Sales","Fulfilment","Finance"]', '["business_admin","sales_manager","fulfilment_manager"]', '[]'),
('restaurant', 'Restaurant / Hospitality', 'retail_adapter', '{"inventory":true,"supplier_marketplace":true,"maintenance":true,"reports":true}', '["Operations","Kitchen","Procurement","Finance"]', '["business_admin","operations_manager","inventory_receiver"]', '[]'),
('pharmacy', 'Pharmacy', 'retail_adapter', '{"inventory":true,"supplier_marketplace":true,"lot_tracking":true,"maintenance":true,"reports":true}', '["Dispensary","Inventory","Procurement","Finance"]', '["business_admin","pharmacist","inventory_receiver"]', '["professional_license"]'),
('school', 'School', 'enterprise', '{"assets":true,"maintenance":true,"occupancy":true,"sanitation":true,"inventory":true,"reports":true}', '["Administration","Teaching","Facilities","Procurement","Finance"]', '["business_admin","department_head","facility_manager","inventory_receiver"]', '["registration"]'),
('hospital', 'Hospital / Clinic', 'enterprise', '{"assets":true,"maintenance":true,"occupancy":true,"sanitation":true,"inventory":true,"milestone_gates":true,"reports":true}', '["Clinical","Facilities","Pharmacy","Procurement","Finance"]', '["business_admin","clinical_manager","facility_manager","inventory_receiver"]', '["registration","health_license"]'),
('construction', 'Construction', 'enterprise', '{"assets":true,"projects":true,"maintenance":true,"inventory":true,"milestones":true,"supplier_marketplace":true,"reports":true}', '["Projects","Sites","Equipment","Procurement","Finance"]', '["business_admin","project_manager","site_manager","storeman"]', '["registration","project_license"]'),
('project_management', 'Project Management', 'enterprise', '{"projects":true,"milestones":true,"approvals":true,"reports":true}', '["Projects","Delivery","Finance"]', '["business_admin","project_manager","reviewer"]', '[]'),
('government', 'Government / Infrastructure', 'enterprise', '{"assets":true,"projects":true,"fleet":true,"inspections":true,"escrow_gates":true,"milestones":true,"reports":true}', '["Administration","Projects","Fleet","Procurement","Audit"]', '["business_admin","project_manager","inspector","finance_approver","auditor"]', '["registration","mandate"]'),
('law_firm', 'Law Firm', 'enterprise', '{"matters":true,"documents":true,"approvals":true,"reports":true}', '["Matters","Research","Client Services","Finance"]', '["business_admin","matter_manager","reviewer"]', '["registration","professional_license"]'),
('audit_firm', 'Audit / Accounting Firm', 'enterprise', '{"engagements":true,"documents":true,"approvals":true,"reports":true}', '["Engagements","Review","Client Services","Finance"]', '["business_admin","engagement_manager","reviewer","auditor"]', '["registration","professional_license"]'),
('professional_services', 'Professional Services', 'enterprise', '{"projects":true,"tasks":true,"reports":true}', '["Delivery","Client Services","Finance"]', '["business_admin","project_manager","reviewer"]', '[]'),
('other', 'Other Organisation', 'operational', '{"assets":true,"tasks":true,"inventory":true,"reports":true}', '["Operations","Finance"]', '["business_admin","department_manager","member"]', '[]')
ON CONFLICT (category_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  operating_mode = EXCLUDED.operating_mode,
  default_modules = EXCLUDED.default_modules,
  default_departments = EXCLUDED.default_departments,
  default_roles = EXCLUDED.default_roles,
  required_documents = EXCLUDED.required_documents,
  updated_at = now();

ALTER TABLE public.business_category_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_category_templates_read ON public.business_category_templates;
CREATE POLICY business_category_templates_read ON public.business_category_templates FOR SELECT TO authenticated USING (is_active = TRUE);

ALTER TABLE public.business_profile_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_business_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_marketplace_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_external_asset_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmms_operational_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.unified_business_admin(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ican_business_admin(p_business_profile_id)
    OR EXISTS (SELECT 1 FROM public.business_member_roles bmr
               JOIN public.business_roles br ON br.id = bmr.business_role_id
              WHERE bmr.business_profile_id = p_business_profile_id
                AND bmr.auth_user_id = auth.uid()
                AND bmr.status = 'active'
                AND br.role_key = 'business_admin');
$$;

CREATE OR REPLACE FUNCTION public.unified_business_member(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ican_business_member(p_business_profile_id)
    OR EXISTS (SELECT 1 FROM public.business_member_roles bmr
              WHERE bmr.business_profile_id = p_business_profile_id
                AND bmr.auth_user_id = auth.uid()
                AND bmr.status = 'active');
$$;

DROP POLICY IF EXISTS business_profile_modules_access ON public.business_profile_modules;
CREATE POLICY business_profile_modules_access ON public.business_profile_modules FOR ALL TO authenticated
  USING (public.unified_business_member(business_profile_id))
  WITH CHECK (public.unified_business_admin(business_profile_id));
DROP POLICY IF EXISTS business_departments_access ON public.business_departments;
CREATE POLICY business_departments_access ON public.business_departments FOR ALL TO authenticated
  USING (public.unified_business_member(business_profile_id))
  WITH CHECK (public.unified_business_admin(business_profile_id));
DROP POLICY IF EXISTS business_roles_access ON public.business_roles;
CREATE POLICY business_roles_access ON public.business_roles FOR ALL TO authenticated
  USING (public.unified_business_member(business_profile_id))
  WITH CHECK (public.unified_business_admin(business_profile_id));
DROP POLICY IF EXISTS business_member_roles_access ON public.business_member_roles;
CREATE POLICY business_member_roles_access ON public.business_member_roles FOR ALL TO authenticated
  USING (public.unified_business_member(business_profile_id))
  WITH CHECK (public.unified_business_admin(business_profile_id));
DROP POLICY IF EXISTS business_role_permissions_access ON public.business_role_permissions;
CREATE POLICY business_role_permissions_access ON public.business_role_permissions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.business_roles br WHERE br.id = business_role_id AND public.unified_business_member(br.business_profile_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.business_roles br WHERE br.id = business_role_id AND public.unified_business_admin(br.business_profile_id)));

DROP POLICY IF EXISTS supplier_directory_public_read ON public.supplier_directory;
CREATE POLICY supplier_directory_public_read ON public.supplier_directory FOR SELECT TO authenticated USING (is_published = TRUE OR public.unified_business_member(business_profile_id));
DROP POLICY IF EXISTS supplier_directory_owner_write ON public.supplier_directory;
CREATE POLICY supplier_directory_owner_write ON public.supplier_directory FOR ALL TO authenticated
  USING (public.unified_business_admin(business_profile_id)) WITH CHECK (public.unified_business_admin(business_profile_id));
DROP POLICY IF EXISTS supplier_catalog_public_read ON public.supplier_catalog_items;
CREATE POLICY supplier_catalog_public_read ON public.supplier_catalog_items FOR SELECT TO authenticated
  USING (is_available = TRUE OR public.unified_business_member(supplier_business_profile_id));
DROP POLICY IF EXISTS supplier_catalog_owner_write ON public.supplier_catalog_items;
CREATE POLICY supplier_catalog_owner_write ON public.supplier_catalog_items FOR ALL TO authenticated
  USING (public.unified_business_admin(supplier_business_profile_id))
  WITH CHECK (public.unified_business_admin(supplier_business_profile_id));
DROP POLICY IF EXISTS supplier_relationship_access ON public.supplier_business_relationships;
CREATE POLICY supplier_relationship_access ON public.supplier_business_relationships FOR ALL TO authenticated
  USING (public.unified_business_member(supplier_business_profile_id) OR public.unified_business_member(buyer_business_profile_id))
  WITH CHECK (public.unified_business_admin(supplier_business_profile_id) OR public.unified_business_admin(buyer_business_profile_id));
DROP POLICY IF EXISTS supplier_orders_access ON public.supplier_marketplace_orders;
CREATE POLICY supplier_orders_access ON public.supplier_marketplace_orders FOR ALL TO authenticated
  USING (public.unified_business_member(buyer_business_profile_id) OR public.unified_business_member(supplier_business_profile_id))
  WITH CHECK (public.unified_business_member(buyer_business_profile_id));
DROP POLICY IF EXISTS cmms_external_links_access ON public.cmms_external_asset_links;
CREATE POLICY cmms_external_links_access ON public.cmms_external_asset_links FOR ALL TO authenticated
  USING (public.unified_business_member(business_profile_id))
  WITH CHECK (public.unified_business_admin(business_profile_id));
DROP POLICY IF EXISTS cmms_events_access ON public.cmms_operational_events;
CREATE POLICY cmms_events_access ON public.cmms_operational_events FOR SELECT TO authenticated
  USING (public.unified_business_member(business_profile_id));

CREATE OR REPLACE FUNCTION public.create_business_profile_from_category(
  p_business_name TEXT,
  p_category_key TEXT,
  p_business_type TEXT DEFAULT NULL,
  p_source_app TEXT DEFAULT 'pichin',
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile_id UUID; v_template public.business_category_templates%ROWTYPE; v_item JSONB; v_role_id UUID; v_module_key TEXT; v_module_enabled BOOLEAN; v_role_key TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_template FROM public.business_category_templates WHERE category_key = lower(trim(p_category_key)) AND is_active;
  IF v_template.id IS NULL THEN RAISE EXCEPTION 'Unsupported business category'; END IF;
  IF NULLIF(trim(p_business_name), '') IS NULL THEN RAISE EXCEPTION 'Business name is required'; END IF;
  INSERT INTO public.business_profiles (user_id, business_name, business_type, description, status, metadata)
  VALUES (auth.uid(), trim(p_business_name), COALESCE(p_business_type, v_template.display_name),
          'Business profile created from the unified business management area.', 'active',
          jsonb_build_object('source', lower(COALESCE(p_source_app, 'pichin')), 'category_key', v_template.category_key,
                             'operating_mode', v_template.operating_mode) || COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_profile_id;
  FOR v_module_key, v_module_enabled IN SELECT key, value::boolean FROM jsonb_each_text(v_template.default_modules) LOOP
    INSERT INTO public.business_profile_modules (business_profile_id, module_key, enabled)
    VALUES (v_profile_id, v_module_key, COALESCE(v_module_enabled, TRUE));
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_template.default_departments) LOOP
    INSERT INTO public.business_departments (business_profile_id, department_name, created_by)
    VALUES (v_profile_id, trim(v_item #>> '{}'), auth.uid());
  END LOOP;
  FOR v_role_key IN SELECT value #>> '{}' FROM jsonb_array_elements(v_template.default_roles) LOOP
    INSERT INTO public.business_roles (business_profile_id, role_key, display_name, visibility_scope, is_system_role)
    VALUES (v_profile_id, trim(v_role_key), initcap(replace(trim(v_role_key), '_', ' ')),
            CASE WHEN trim(v_role_key) = 'business_admin' THEN 'company' ELSE 'department' END, TRUE)
    RETURNING id INTO v_role_id;
    INSERT INTO public.business_role_permissions (business_role_id, permission_key, allowed)
    SELECT v_role_id, permission_key, allowed FROM (VALUES
      ('view_inventory', TRUE), ('receive_inventory', FALSE), ('edit_inventory', FALSE), ('adjust_stock', FALSE),
      ('create_tasks', FALSE), ('assign_tasks', FALSE), ('accept_assigned_tasks', TRUE), ('create_work_orders', FALSE),
      ('approve_work_orders', FALSE), ('manage_assets', FALSE), ('approve_disposal', FALSE), ('view_reports', TRUE),
      ('view_department_reports', TRUE), ('view_company_reports', FALSE), ('manage_suppliers', FALSE),
      ('create_purchase_orders', FALSE), ('approve_purchase_orders', FALSE), ('approve_budgets', FALSE),
      ('unlock_milestones', FALSE), ('manage_users_roles', FALSE)
    ) permissions(permission_key, allowed)
    WHERE (trim(v_role_key) = 'business_admin')
       OR (trim(v_role_key) IN ('store_manager','warehouse_manager','production_manager','project_manager') AND permission_key IN ('receive_inventory','edit_inventory','adjust_stock','create_tasks','assign_tasks','create_work_orders','manage_assets','view_reports','view_department_reports','create_purchase_orders'))
       OR (trim(v_role_key) IN ('storeman','inventory_receiver','fulfilment_manager') AND permission_key IN ('view_inventory','receive_inventory','view_reports'))
       OR (trim(v_role_key) IN ('technician','facility_manager','site_manager') AND permission_key IN ('view_inventory','accept_assigned_tasks','create_work_orders','view_reports','view_department_reports'))
       OR (trim(v_role_key) IN ('reviewer','auditor') AND permission_key IN ('view_reports','view_department_reports','accept_assigned_tasks'));
  END LOOP;
  INSERT INTO public.business_member_roles (business_profile_id, auth_user_id, business_role_id, status, assigned_by)
  SELECT v_profile_id, auth.uid(), id, 'active', auth.uid() FROM public.business_roles
   WHERE business_profile_id = v_profile_id AND role_key = 'business_admin';
  RETURN v_profile_id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_business_category_templates()
RETURNS SETOF public.business_category_templates LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.business_category_templates WHERE is_active ORDER BY display_name;
$$;

CREATE OR REPLACE FUNCTION public.search_global_suppliers(p_search TEXT DEFAULT NULL, p_category TEXT DEFAULT NULL)
RETURNS TABLE (business_profile_id UUID, business_name TEXT, supplier_type TEXT, service_regions JSONB, catalog_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sd.business_profile_id, bp.business_name, sd.supplier_type, sd.service_regions,
         (SELECT count(*) FROM public.supplier_catalog_items sci WHERE sci.supplier_business_profile_id = sd.business_profile_id AND sci.is_available = TRUE)
    FROM public.supplier_directory sd JOIN public.business_profiles bp ON bp.id = sd.business_profile_id
   WHERE sd.is_published = TRUE AND COALESCE(bp.status, 'active') = 'active'
     AND (NULLIF(trim(p_search), '') IS NULL OR bp.business_name ILIKE '%' || trim(p_search) || '%')
     AND (NULLIF(trim(p_category), '') IS NULL OR EXISTS (SELECT 1 FROM public.supplier_catalog_items sci WHERE sci.supplier_business_profile_id = sd.business_profile_id AND sci.category ILIKE '%' || trim(p_category) || '%' AND sci.is_available = TRUE))
   ORDER BY bp.business_name;
$$;

-- Versioned result shape so existing clients of search_global_suppliers keep
-- working while newer clients can display transport availability.
CREATE OR REPLACE FUNCTION public.search_global_suppliers_v2(p_search TEXT DEFAULT NULL, p_category TEXT DEFAULT NULL)
RETURNS TABLE (business_profile_id UUID, business_name TEXT, supplier_type TEXT, service_regions JSONB, catalog_count BIGINT, transport_enabled BOOLEAN, transport_provider TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sd.business_profile_id, bp.business_name, sd.supplier_type, sd.service_regions,
         (SELECT count(*) FROM public.supplier_catalog_items sci WHERE sci.supplier_business_profile_id = sd.business_profile_id AND sci.is_available = TRUE),
         sd.transport_enabled, sd.transport_provider
    FROM public.supplier_directory sd JOIN public.business_profiles bp ON bp.id = sd.business_profile_id
   WHERE sd.is_published = TRUE AND COALESCE(bp.status, 'active') = 'active'
     AND (NULLIF(trim(p_search), '') IS NULL OR bp.business_name ILIKE '%' || trim(p_search) || '%')
     AND (NULLIF(trim(p_category), '') IS NULL OR EXISTS (SELECT 1 FROM public.supplier_catalog_items sci WHERE sci.supplier_business_profile_id = sd.business_profile_id AND sci.category ILIKE '%' || trim(p_category) || '%' AND sci.is_available = TRUE))
   ORDER BY bp.business_name;
$$;

-- Wholesale and factory profiles opt into supplier publishing explicitly, but
-- once published they receive the same global directory and BodaGoera path as
-- dedicated supplier profiles.
CREATE OR REPLACE FUNCTION public.publish_business_as_supplier(
  p_business_profile_id UUID,
  p_supplier_type TEXT DEFAULT 'supplier'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_owner UUID;
BEGIN
  IF NOT public.unified_business_admin(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business administrator access required';
  END IF;
  SELECT user_id INTO v_owner FROM public.business_profiles
   WHERE id = p_business_profile_id AND COALESCE(status, 'active') = 'active';
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Business profile not found or inactive'; END IF;
  INSERT INTO public.supplier_directory
    (business_profile_id, supplier_user_id, supplier_type, is_published, transport_enabled, transport_provider)
  VALUES (p_business_profile_id, v_owner, COALESCE(NULLIF(trim(p_supplier_type), ''), 'supplier'), TRUE, TRUE, 'bodagoera')
  ON CONFLICT (business_profile_id) DO UPDATE SET
    supplier_user_id = EXCLUDED.supplier_user_id,
    supplier_type = EXCLUDED.supplier_type,
    is_published = TRUE,
    transport_enabled = TRUE,
    transport_provider = 'bodagoera',
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.create_business_department(
  p_business_profile_id UUID, p_department_name TEXT, p_description TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.unified_business_admin(p_business_profile_id) THEN RAISE EXCEPTION 'Business administrator access required'; END IF;
  INSERT INTO public.business_departments (business_profile_id, department_name, description, created_by)
  VALUES (p_business_profile_id, trim(p_department_name), p_description, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.create_business_role(
  p_business_profile_id UUID, p_role_key TEXT, p_display_name TEXT,
  p_visibility_scope TEXT DEFAULT 'department', p_permissions JSONB DEFAULT '[]'::jsonb
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role_id UUID; v_permission JSONB;
BEGIN
  IF NOT public.unified_business_admin(p_business_profile_id) THEN RAISE EXCEPTION 'Business administrator access required'; END IF;
  INSERT INTO public.business_roles (business_profile_id, role_key, display_name, visibility_scope, is_system_role)
  VALUES (p_business_profile_id, trim(p_role_key), trim(p_display_name), COALESCE(p_visibility_scope, 'department'), FALSE)
  RETURNING id INTO v_role_id;
  FOR v_permission IN SELECT value FROM jsonb_array_elements(COALESCE(p_permissions, '[]'::jsonb)) LOOP
    INSERT INTO public.business_role_permissions (business_role_id, permission_key, allowed)
    VALUES (v_role_id, v_permission->>'permission_key', COALESCE((v_permission->>'allowed')::boolean, TRUE));
  END LOOP;
  RETURN v_role_id;
END; $$;

CREATE OR REPLACE FUNCTION public.link_cmms_external_asset(
  p_business_profile_id UUID, p_cmms_asset_id UUID, p_app_key TEXT, p_source_entity_id UUID,
  p_source_of_truth TEXT DEFAULT 'source_app', p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.unified_business_admin(p_business_profile_id) THEN RAISE EXCEPTION 'Business administrator access required'; END IF;
  INSERT INTO public.cmms_external_asset_links (business_profile_id, cmms_asset_id, app_key, source_entity_id, source_of_truth, metadata, created_by)
  VALUES (p_business_profile_id, p_cmms_asset_id, lower(trim(p_app_key)), p_source_entity_id, p_source_of_truth, COALESCE(p_metadata, '{}'::jsonb), auth.uid())
  ON CONFLICT (app_key, source_entity_id) DO UPDATE SET business_profile_id = EXCLUDED.business_profile_id, cmms_asset_id = EXCLUDED.cmms_asset_id, source_of_truth = EXCLUDED.source_of_truth, metadata = public.cmms_external_asset_links.metadata || EXCLUDED.metadata, sync_status = 'active', updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.ingest_cmms_operational_event(
  p_business_profile_id UUID, p_app_key TEXT, p_source_entity_id UUID, p_event_type TEXT,
  p_idempotency_key TEXT, p_payload JSONB DEFAULT '{}'::jsonb, p_event_at TIMESTAMPTZ DEFAULT now()
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.unified_business_member(p_business_profile_id) THEN RAISE EXCEPTION 'Business membership required'; END IF;
  INSERT INTO public.cmms_operational_events (business_profile_id, app_key, source_entity_id, event_type, idempotency_key, payload, event_at, created_by)
  VALUES (p_business_profile_id, lower(trim(p_app_key)), p_source_entity_id, lower(trim(p_event_type)), trim(p_idempotency_key), COALESCE(p_payload, '{}'::jsonb), COALESCE(p_event_at, now()), auth.uid())
  ON CONFLICT (business_profile_id, app_key, idempotency_key) DO UPDATE SET payload = EXCLUDED.payload, event_at = EXCLUDED.event_at
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_business_profile_from_category(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_category_templates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_global_suppliers(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_global_suppliers_v2(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_business_as_supplier(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_business_department(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_business_role(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_cmms_external_asset(UUID, UUID, TEXT, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_cmms_operational_event(UUID, TEXT, UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ) TO authenticated;

-- Existing supplier businesses become globally discoverable without requiring
-- a new store-by-store application. Historical applications remain intact.
INSERT INTO public.supplier_directory (business_profile_id, supplier_user_id, supplier_type)
SELECT bp.id, bp.user_id, 'supplier'
  FROM public.business_profiles bp
 WHERE (
       lower(COALESCE(bp.metadata ->> 'source', '')) = 'supermarketa_supplier'
       OR lower(COALESCE(bp.business_type, '')) LIKE '%wholesale%'
       OR lower(COALESCE(bp.business_type, '')) LIKE '%supplier%'
       OR lower(COALESCE(bp.business_type, '')) LIKE '%factory%'
       OR lower(COALESCE(bp.business_type, '')) LIKE '%hardware%'
       OR lower(COALESCE(bp.business_type, '')) LIKE '%raw material%'
      )
   AND COALESCE(bp.status, 'active') = 'active'
   AND bp.user_id IS NOT NULL
ON CONFLICT (business_profile_id) DO UPDATE SET
  supplier_user_id = EXCLUDED.supplier_user_id,
  is_published = TRUE, transport_enabled = TRUE, transport_provider = 'bodagoera', updated_at = now();

-- New supplier profiles are published automatically. Store-by-store approval
-- remains available only as historical data and is not required for orders.
CREATE OR REPLACE FUNCTION public.publish_supplier_business_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND COALESCE(NEW.status, 'active') = 'active'
     AND (
       lower(COALESCE(NEW.metadata ->> 'source', '')) = 'supermarketa_supplier'
       OR lower(COALESCE(NEW.business_type, '')) LIKE '%wholesale%'
       OR lower(COALESCE(NEW.business_type, '')) LIKE '%supplier%'
       OR lower(COALESCE(NEW.business_type, '')) LIKE '%factory%'
       OR lower(COALESCE(NEW.business_type, '')) LIKE '%hardware%'
       OR lower(COALESCE(NEW.business_type, '')) LIKE '%raw material%'
     ) THEN
    INSERT INTO public.supplier_directory (business_profile_id, supplier_user_id, supplier_type, transport_enabled, transport_provider)
    VALUES (NEW.id, NEW.user_id,
      CASE
        WHEN lower(COALESCE(NEW.business_type, '')) LIKE '%wholesale%' THEN 'wholesaler'
        WHEN lower(COALESCE(NEW.business_type, '')) LIKE '%hardware%' THEN 'hardware'
        WHEN lower(COALESCE(NEW.business_type, '')) LIKE '%factory%' THEN 'factory'
        ELSE 'supplier'
      END, TRUE, 'bodagoera')
    ON CONFLICT (business_profile_id) DO UPDATE
      SET supplier_user_id = EXCLUDED.supplier_user_id,
          supplier_type = EXCLUDED.supplier_type,
          is_published = TRUE,
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publish_supplier_business_profile_trigger ON public.business_profiles;
CREATE TRIGGER publish_supplier_business_profile_trigger
AFTER INSERT OR UPDATE OF metadata, business_type, status, user_id ON public.business_profiles
FOR EACH ROW EXECUTE FUNCTION public.publish_supplier_business_profile();

NOTIFY pgrst, 'reload schema';
