import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const {
      transactionId,
      referenceId
    } = await req.json()

    if (!transactionId && !referenceId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'transactionId or referenceId required'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

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

    // Check transaction status
    const statusUrl = transactionId 
      ? `${momoApiUrl}/v1_0/requeststatus/${transactionId}`
      : `${momoApiUrl}/v1_0/transactionstatus/${referenceId}`

    const momoResponse = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': momoApiKey
      }
    })

    const momoData = await momoResponse.json()

    if (!momoResponse.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: momoData.message || 'Failed to get transaction status',
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
        transactionId: transactionId || referenceId,
        status: momoData.status,
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
