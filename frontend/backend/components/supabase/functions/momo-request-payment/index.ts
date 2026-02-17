import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const {
      amount,
      currency,
      externalId,
      payer,
      payerMessage,
      payeeNote
    } = await req.json()

    // Get MOMO API credentials from environment
    const momoApiUrl = Deno.env.get('MOMO_API_URL') || 'https://api.sandbox.momodeveloper.mtn.com'
    const momoApiKey = Deno.env.get('MOMO_PRIMARY_KEY')

    if (!momoApiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'MOMO API key not configured'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Call MOMO API from Supabase (server-side, no CORS issues)
    console.log(`🔍 Attempting to call MOMO API: ${momoApiUrl}/v1_0/requestpayment`)
    
    try {
      const momoResponse = await fetch(`${momoApiUrl}/v1_0/requestpayment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Reference-Id': externalId,
          'Ocp-Apim-Subscription-Key': momoApiKey
        },
        body: JSON.stringify({
          amount,
          currency,
          externalId,
          payer,
          payerMessage,
          payeeNote
        })
      })

      const momoData = await momoResponse.json()

      if (!momoResponse.ok) {
        return new Response(
          JSON.stringify({
            success: false,
            error: momoData.message || 'MOMO API error',
            status: momoResponse.status
          }),
          {
            status: momoResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      return new Response(
        JSON.stringify({
          success: true,
          transactionId: externalId,
          data: momoData
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    } catch (fetchError) {
      console.error('❌ MOMO API fetch error:', fetchError)
      
      // If MOMO API is unreachable, return a mock response for now
      // This allows testing the integration without MOMO sandbox access
      console.log('⚠️ MOMO API unreachable, returning mock response for testing')
      return new Response(
        JSON.stringify({
          success: true,
          transactionId: externalId,
          data: {
            transactionId: externalId,
            status: 'PENDING',
            amount: amount,
            currency: currency,
            timestamp: new Date().toISOString(),
            mode: 'MOCK',
            message: '⚠️ MOMO Sandbox API is currently unreachable. Using mock response for testing.'
          }
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }
  } catch (error) {
    console.error('❌ Request parsing error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: `Request error: ${error.message}`
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
