/**
 * 🧪 MOMO Backend Diagnostic Test
 * Tests the request-payment endpoint directly to see what's wrong
 */

const testPayloads = [
  {
    name: 'Test 1: Valid Uganda number (07x format)',
    payload: {
      amount: 5000,
      phoneNumber: '0701234567',
      currency: 'UGX',
      description: 'Test top-up'
    }
  },
  {
    name: 'Test 2: Valid Uganda number (256 format)',
    payload: {
      amount: 5000,
      phoneNumber: '256701234567',
      currency: 'UGX',
      description: 'Test top-up'
    }
  },
  {
    name: 'Test 3: Valid Uganda number (+256 format)',
    payload: {
      amount: 5000,
      phoneNumber: '+256701234567',
      currency: 'UGX',
      description: 'Test top-up'
    }
  },
  {
    name: 'Test 4: Missing phone number',
    payload: {
      amount: 5000,
      currency: 'UGX',
      description: 'Test top-up'
    }
  },
  {
    name: 'Test 5: Invalid amount',
    payload: {
      amount: -1000,
      phoneNumber: '256701234567',
      currency: 'UGX',
      description: 'Test top-up'
    }
  }
];

async function testEndpoint(testName, payload) {
  console.log(`\n${testName}`);
  console.log('─'.repeat(60));
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch('http://localhost:5000/api/momo/request-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ SUCCESS (200)');
      console.log('Response:', JSON.stringify(data, null, 2));
    } else {
      console.log(`❌ ERROR (${response.status})`);
      console.log('Response:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('❌ Network Error:', error.message);
  }
}

async function runTests() {
  console.log('\n🧪 MOMO REQUEST-PAYMENT ENDPOINT DIAGNOSTIC TEST');
  console.log('═'.repeat(60));
  console.log('Backend: http://localhost:5000\n');

  // Check if backend is running
  try {
    const healthCheck = await fetch('http://localhost:5000/health');
    if (!healthCheck.ok) {
      console.error('⚠️  Backend not responding properly to health check');
    }
  } catch (error) {
    console.error('❌ BACKEND NOT RUNNING!');
    console.error('   Start backend with: cd backend && npm start');
    process.exit(1);
  }

  console.log('✅ Backend is running\n');

  // Run all tests sequentially
  for (const test of testPayloads) {
    await testEndpoint(test.name, test.payload);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('📊 Test Summary Complete');
  console.log('═'.repeat(60) + '\n');
}

runTests();
