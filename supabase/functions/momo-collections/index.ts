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
      description,
      callbackUrl
    } = await req.json()

    // Get MOMO API credentials from environment (Collections keys)
    const momoApiUrl = Deno.env.get('MOMO_API_URL') || 'https://api.sandbox.momodeveloper.mtn.com'
    const momoCollectionsKey = Deno.env.get('MOMO_COLLECTIONS_PRIMARY_KEY')

    if (!momoCollectionsKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'MOMO Collections API key not configured'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Call MOMO Collections API (server-side, no CORS issues)
    const momoResponse = await fetch(`${momoApiUrl}/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Reference-Id': externalId,
        'Ocp-Apim-Subscription-Key': momoCollectionsKey
      },
      body: JSON.stringify({
        amount,
        currency,
        externalId,
        payer,
        payerMessage: description || 'Payment request from ICAN',
        payeeNote: 'Please complete payment'
      })
    })

    const momoData = await momoResponse.json()

    if (!momoResponse.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: momoData.message || 'MOMO Collections API error',
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
        type: 'collection',
        status: 'pending',
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
