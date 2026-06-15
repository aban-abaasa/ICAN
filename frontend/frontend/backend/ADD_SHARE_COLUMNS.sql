-- =====================================================
-- ADD MISSING COLUMNS TO PITCHES TABLE
-- =====================================================
-- Add share management columns to pitches table

-- Check if columns exist and add them if needed
DO $$ 
BEGIN
  -- Add shares_available if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pitches' AND column_name = 'shares_available'
  ) THEN
    ALTER TABLE public.pitches 
    ADD COLUMN shares_available INTEGER DEFAULT 0;
  END IF;

  -- Add total_shares if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pitches' AND column_name = 'total_shares'
  ) THEN
    ALTER TABLE public.pitches 
    ADD COLUMN total_shares INTEGER DEFAULT 0;
  END IF;

  -- Add shares_sold if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pitches' AND column_name = 'shares_sold'
  ) THEN
    ALTER TABLE public.pitches 
    ADD COLUMN shares_sold INTEGER DEFAULT 0;
  END IF;

  -- Add share_price if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pitches' AND column_name = 'share_price'
  ) THEN
    ALTER TABLE public.pitches 
    ADD COLUMN share_price DECIMAL(15, 4) DEFAULT 0;
  END IF;
END $$;

-- Verify the columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'pitches' 
AND column_name IN ('shares_available', 'total_shares', 'shares_sold', 'share_price')
ORDER BY column_name;
