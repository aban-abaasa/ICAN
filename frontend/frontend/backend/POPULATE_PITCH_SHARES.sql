-- =====================================================
-- POPULATE PITCH WITH SHARE DATA (CORRECTED)
-- =====================================================
-- Update the DAb Investment Pitch with share information

-- Step 1: Find the DAb pitch
SELECT id, title, shares_available, total_shares, share_price
FROM public.pitches
WHERE title ILIKE '%dab%'
LIMIT 10;

-- Step 2: Update by pitch title
UPDATE public.pitches
SET 
  total_shares = 5,
  shares_available = 5,
  shares_sold = 0,
  share_price = 100.00,
  updated_at = NOW()
WHERE title ILIKE '%dab%investment%';

-- Step 3: Verify the update
SELECT id, title, total_shares, shares_available, share_price
FROM public.pitches
WHERE total_shares > 0
ORDER BY updated_at DESC;
