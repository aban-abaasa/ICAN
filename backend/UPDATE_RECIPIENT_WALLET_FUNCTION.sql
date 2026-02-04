/**
 * 🔐 Backend Function: Update Recipient Wallet Balance
 * 
 * Purpose: Add money to recipient's wallet, bypassing RLS policies
 * Uses SECURITY DEFINER to allow third-party transfers
 * Called from frontend when sending money between ICAN users
 */

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.update_recipient_wallet_balance(uuid, text, numeric);

-- Create function with SECURITY DEFINER (bypasses RLS)
CREATE OR REPLACE FUNCTION public.update_recipient_wallet_balance(
  p_user_id uuid,
  p_curr text,
  p_amount numeric
)
RETURNS SETOF public.wallet_accounts AS $$
BEGIN
  -- Update the recipient's wallet balance
  UPDATE public.wallet_accounts
  SET balance = balance + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id AND currency = p_curr;
  
  -- Return the updated wallet
  RETURN QUERY SELECT * FROM public.wallet_accounts 
  WHERE user_id = p_user_id AND currency = p_curr;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant permission to authenticated users
GRANT EXECUTE ON FUNCTION public.update_recipient_wallet_balance(uuid, text, numeric) TO authenticated;

-- Verify function
SELECT 'Function created successfully' as status;
