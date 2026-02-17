/**
 * 🔐 Backend Function: Ensure Recipient Wallet Exists
 * 
 * Purpose: Create wallet for recipient if it doesn't exist
 * Uses SECURITY DEFINER to bypass RLS policies
 * Called from frontend when sending money to user without wallet in that currency
 */

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.ensure_recipient_wallet_exists(uuid, text);

-- Create function with SECURITY DEFINER (bypasses RLS)
CREATE OR REPLACE FUNCTION public.ensure_recipient_wallet_exists(p_user_id uuid, p_curr text)
RETURNS SETOF public.wallet_accounts AS $$
BEGIN
  -- Try to insert new wallet (will ignore if exists)
  INSERT INTO public.wallet_accounts (user_id, currency, balance)
  VALUES (p_user_id, p_curr, 0)
  ON CONFLICT DO NOTHING;
  
  -- Return the wallet
  RETURN QUERY SELECT * FROM public.wallet_accounts 
  WHERE user_id = p_user_id AND currency = p_curr;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant permission to authenticated users
GRANT EXECUTE ON FUNCTION public.ensure_recipient_wallet_exists(uuid, text) TO authenticated;

-- Verify function
SELECT 'Function created successfully' as status;
