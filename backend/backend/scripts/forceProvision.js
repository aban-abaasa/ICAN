const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// --- PASTE YOUR KEY HERE MANUALLY ---
const SUB_KEY = '7307f0bb655542248f520187b63b12d5'; 
const USER_ID = uuidv4();

async function runForceProvision() {
  console.log("🛠 Attempting Force Provisioning...");
  
  try {
    // 1. Create API User
    console.log("Step 1: Creating User...");
    await axios.post('https://sandbox.momodeveloper.mtn.com/v1_0/apiuser', 
      { providerCallbackHost: "webhook.site" }, 
      {
        headers: {
          'X-Reference-Id': USER_ID,
          'Ocp-Apim-Subscription-Key': SUB_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log("✅ User Created:", USER_ID);

    // 2. Get API Key
    console.log("Step 2: Getting API Key...");
    const res = await axios.post(`https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/${USER_ID}/apikey`, {}, {
      headers: { 'Ocp-Apim-Subscription-Key': SUB_KEY }
    });

    console.log("\n==========================================");
    console.log("🚀 SUCCESS!");
    console.log("MOMO_API_USER=" + USER_ID);
    console.log("MOMO_API_KEY=" + res.data.apiKey);
    console.log("==========================================\n");

  } catch (err) {
    console.error("❌ ERROR DETAILS:");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Data:", JSON.stringify(err.response.data));
    } else {
      console.error(err.message);
    }
  }
}

runForceProvision();
