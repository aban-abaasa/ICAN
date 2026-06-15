#!/bin/bash

# Deploy Supabase Edge Functions

set -e

echo "Deploying Supabase Edge Functions..."
echo ""

cd "$(dirname "$0")"
cd "./components/supabase"

echo "1. Deploying momo-request-payment..."
npx supabase functions deploy momo-request-payment

echo ""
echo "2. Deploying momo-transfer..."
npx supabase functions deploy momo-transfer

echo ""
echo "3. Deploying momo-collections..."
npx supabase functions deploy momo-collections

echo ""
echo "4. Deploying momo-remittance..."
npx supabase functions deploy momo-remittance

echo ""
echo "5. Deploying momo-transaction-status..."
npx supabase functions deploy momo-transaction-status

echo ""
echo "6. Deploying delete-account..."
npx supabase functions deploy delete-account --no-verify-jwt

echo ""
echo "All functions deployed successfully."
