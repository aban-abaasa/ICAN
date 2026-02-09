require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  try {
    console.log('Creating pitch for DAb...\n');
    
    const pitchId = '077e9c93-test-dab-pitch-001';  // Use consistent ID
    
    const { data, error } = await supabase
      .from('pitches')
      .insert({
        id: pitchId,
        business_profile_id: '35a1d558-d256-465b-bb16-b023eafb5388',
        pitch_title: 'DAb Growth Investment Round 1',
        pitch_description: 'Investment opportunity for DAb business expansion',
        pitch_type: 'equity',
        target_investment_amount: 50000,
        share_price: 1000,
        available_shares: 50,
        equity_percentage_offered: 10,
        minimum_investment: 5000,
        pitch_status: 'active',
        document_status: 'completed',
        created_at: new Date().toISOString()
      })
      .select();
    
    if (error) throw error;
    
    console.log('✅ Pitch created successfully!');
    console.log('Pitch ID:', pitchId);
    console.log('Title:', data[0].pitch_title);
    console.log('Share Price:', data[0].share_price);
    console.log('Available Shares:', data[0].available_shares);
    
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
