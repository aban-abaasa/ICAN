#!/bin/bash

# Deploy all MOMO Edge Functions to Supabase

echo "🚀 Deploying MOMO Edge Functions..."
echo ""

cd "$(dirname "$0")"

# Deploy each function
echo "1️⃣ Deploying momo-request-payment..."
npx supabase functions deploy momo-request-payment

echo ""
echo "2️⃣ Deploying momo-transfer..."
npx supabase functions deploy momo-transfer

echo ""
echo "3️⃣ Deploying momo-collections..."
npx supabase functions deploy momo-collections

echo ""
echo "4️⃣ Deploying momo-remittance..."
npx supabase functions deploy momo-remittance

echo ""
echo "5️⃣ Deploying momo-transaction-status..."
npx supabase functions deploy momo-transaction-status

echo ""
echo "✅ All functions deployed successfully!"
