-- Insert test user account record
-- This creates an account with PIN "1234" (hashed as MTIzNA==)
-- User ID (auth.users): 4c25b54b-d6e7-4fd2-b784-66021c41a5d4

INSERT INTO public.user_accounts (
  user_id,
  account_number,
  account_holder_name,
  email,
  phone_number,
  pin_hash,
  account_type,
  status
) VALUES (
  '4c25b54b-d6e7-4fd2-b784-66021c41a5d4',
  'ICAN-' || LPAD(FLOOR(RANDOM() * 10000000000000000)::TEXT, 15, '0'),
  'Test User',
  'test@ican.ug',
  '+256700000000',
  'MTIzNA==',
  'personal',
  'active'
)
ON CONFLICT (user_id) DO UPDATE SET
  pin_hash = 'MTIzNA==',
  status = 'active',
  updated_at = NOW();

-- Verify the record was created
SELECT id, user_id, account_number, account_holder_name, pin_hash, status FROM public.user_accounts 
WHERE user_id = '4c25b54b-d6e7-4fd2-b784-66021c41a5d4';
