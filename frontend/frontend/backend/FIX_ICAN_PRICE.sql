-- 🔧 FIX: Correct ICAN Coin Price in Database
-- Issue: price_ugx was set to 1.35 (USD rate) instead of 5000
-- This caused conversion errors in Trading Center

-- Check current price
SELECT 'CURRENT PRICES' as check;
SELECT * FROM ican_coin_market_prices 
ORDER BY timestamp DESC 
LIMIT 5;

-- Fix: Update all records with wrong price_ugx < 1000 to correct value
UPDATE ican_coin_market_prices
SET price_ugx = 5000
WHERE price_ugx < 1000;

-- Verify fix
SELECT 'AFTER FIX' as check;
SELECT * FROM ican_coin_market_prices 
ORDER BY timestamp DESC 
LIMIT 5;

-- Insert new price record (if needed)
INSERT INTO ican_coin_market_prices (price_ugx, percentage_change_24h, market_cap, timestamp)
VALUES (5000, 0, NULL, NOW());

SELECT '✅ PRICE CORRECTION COMPLETE' as status;
SELECT 'New ICAN Rate: 1 coin = 5,000 UGX' as rate;
SELECT 'Trading Center should now show: 50,000 UGX = 10 ICAN coins' as expected_result;
