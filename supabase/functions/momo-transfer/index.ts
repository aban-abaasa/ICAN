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
      payee,
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

    // Call MOMO API for transfer/disbursement (server-side, no CORS issues)
    const momoResponse = await fetch(`${momoApiUrl}/v1_0/transfer`, {
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
        payee,
        payerMessage,
        payeeNote
      })
    })

    const momoData = await momoResponse.json()

    if (!momoResponse.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: momoData.message || 'MOMO Transfer API error',
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
        type: 'disbursement',
        data: momoData
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
