-- Check ALL shareholders for each business profile (including inactive/pending)

-- Query 1: Show DAb business profile and ALL its shareholders (any status)
SELECT
  bp.id,
  bp.business_name,
  bp.user_id as owner_id,
  COUNT(bco.id) as total_shareholders
FROM business_profiles bp
LEFT JOIN business_co_owners bco 
  ON bco.business_profile_id = bp.id
WHERE bp.business_name = 'DAb'
GROUP BY bp.id, bp.business_name, bp.user_id;

-- Query 2: List ALL shareholders of DAb (show names, emails, and status)
SELECT
  bco.id,
  bco.owner_name,
  bco.owner_email,
  bco.user_id,
  bco.ownership_share,
  bco.status,
  CASE 
    WHEN bco.status = 'active' OR bco.status IS NULL THEN '✅ Active'
    WHEN bco.status = 'pending' THEN '⏳ Pending'
    WHEN bco.status = 'inactive' THEN '❌ Inactive'
    ELSE '❓ ' || bco.status
  END as status_label
FROM business_co_owners bco
WHERE bco.business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAb' LIMIT 1
)
ORDER BY bco.created_at;

-- Query 3: Count shareholders by status
SELECT
  CASE 
    WHEN status = 'active' OR status IS NULL THEN 'Active'
    WHEN status = 'pending' THEN 'Pending'
    WHEN status = 'inactive' THEN 'Inactive'
    ELSE status
  END as status_group,
  COUNT(*) as count
FROM business_co_owners
WHERE business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAb' LIMIT 1
)
GROUP BY status_group
ORDER BY count DESC;
