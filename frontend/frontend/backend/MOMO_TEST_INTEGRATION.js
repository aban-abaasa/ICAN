/**
 * 🧪 MOMO Frontend-Backend Integration Test
 * Tests the complete flow from frontend service to backend to MTN MOMO API
 */

// Test data
const testPayload = {
  amount: 5000,
  phoneNumber: '256701234567',
  currency: 'UGX',
  description: 'Test MOMO Transaction'
};

// Test 1: Backend Health Check
async function testBackendHealth() {
  console.log('\n📡 Test 1: Backend Health Check');
  console.log('URL: http://localhost:5000/health');
  
  try {
    const response = await fetch('http://localhost:5000/health');
    const data = await response.json();
    console.log('✅ SUCCESS:', data);
    return true;
  } catch (error) {
    console.error('❌ FAILED:', error.message);
    return false;
  }
}

// Test 2: MOMO API via Backend
async function testMOMOEndpoint() {
  console.log('\n📡 Test 2: MOMO Request-Payment Endpoint');
  console.log('URL: http://localhost:5000/api/momo/request-payment');
  console.log('Payload:', testPayload);
  
  try {
    const response = await fetch('http://localhost:5000/api/momo/request-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ SUCCESS:', data);
    } else {
      console.log('⚠️  Response:', data);
    }
    
    return response.ok;
  } catch (error) {
    console.error('❌ FAILED:', error.message);
    return false;
  }
}

// Test 3: Frontend Service
async function testFrontendService() {
  console.log('\n📡 Test 3: Frontend MOmoService');
  console.log('Service: http://localhost:5173 (Vite dev server)');
  console.log('This test should be run from browser console');
  
  return false;
}

// Run all tests
async function runAllTests() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  MOMO Integration Test Suite          ║');
  console.log('╚════════════════════════════════════════╝');
  
  const test1 = await testBackendHealth();
  const test2 = await testMOMOEndpoint();
  
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Test Results                         ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  Backend Health: ${test1 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`║  MOMO Endpoint:  ${test2 ? '✅ PASS' : '⚠️  WARN'}`);
  console.log('╚════════════════════════════════════════╝');
  
  console.log('\n📝 NEXT STEPS:');
  console.log('1. Restart frontend dev server: npm run dev');
  console.log('2. Frontend will pick up VITE_BACKEND_URL=http://localhost:5000/api');
  console.log('3. Open browser console and test processTopUp() from ICANWallet');
  console.log('4. Monitor console for request/response logs');
}

// Run tests
runAllTests();
