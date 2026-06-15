/**
 * 🔧 FIX: ADD MISSING COLUMNS TO wallet_transactions TABLE
 * 
 * Adds payment_method and notes columns if they don't exist
 * Run this if cash-in functions fail with column not found errors
 */

-- Add payment_method column if it doesn't exist
ALTER TABLE public.wallet_transactions
ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'agent';

-- Add notes column if it doesn't exist
ALTER TABLE public.wallet_transactions
ADD COLUMN IF NOT EXISTS notes text;

-- Verify columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'wallet_transactions' 
AND column_name IN ('payment_method', 'notes');

-- Status
SELECT 'wallet_transactions table columns verified/added' as status;
