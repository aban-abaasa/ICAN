-- Show the actual avatar URL that's saved
SELECT id, email, full_name, avatar_url 
FROM profiles 
WHERE avatar_url IS NOT NULL;
