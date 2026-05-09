import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getPhonePeToken(clientId: string, clientSecret: string, clientVersion: string): Promise<string> {
  const res = await fetch('https://api.phonepe.com/apis/identity-manager/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      client_version: clientVersion,
    }).toString(),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`)
  return data.access_token
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { orderId, transactionId } = await req.json()

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing orderId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const clientId      = Deno.env.get('PHONEPE_CLIENT_ID')!
    const clientSecret  = Deno.env.get('PHONEPE_CLIENT_SECRET')!
    const clientVersion = Deno.env.get('PHONEPE_CLIENT_VERSION') || '1'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Fetch the order from DB to get merchantOrderId / payment_id
    const { data: order, error: dbError } = await supabase
      .from('orders')
      .select('id, payment_id, payment_status, customer_name, total_amount, customer_phone, items')
      .eq('id', orderId)
      .single()

    if (dbError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // If already resolved, just return current status
    const currentStatus = (order.payment_status || '').toLowerCase()
    if (currentStatus === 'success' || currentStatus === 'paid') {
      return new Response(JSON.stringify({ status: 'success', order }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (currentStatus === 'failed' || currentStatus === 'cancelled') {
      return new Response(JSON.stringify({ status: 'failed', order }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Get OAuth token and query PhonePe Order Status API
    const merchantOrderId = transactionId || order.payment_id || orderId
    const token = await getPhonePeToken(clientId, clientSecret, clientVersion)

    const statusRes = await fetch(
      `https://api.phonepe.com/apis/pg/checkout/v2/order/${merchantOrderId}/status?details=false`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `O-Bearer ${token}`,
        },
      }
    )

    const statusData = await statusRes.json()
    console.log('PhonePe status response:', JSON.stringify(statusData))

    // 3. Determine payment result from PhonePe response
    const phonePeState = (statusData.state || statusData.status || '').toUpperCase()
    // States: COMPLETED, FAILED, PENDING, EXPIRED
    let newStatus: string
    if (
      phonePeState === 'COMPLETED' ||
      statusData.paymentDetails?.[0]?.state === 'COMPLETED' ||
      phonePeState === 'SUCCESS'
    ) {
      newStatus = 'success'
    } else if (phonePeState === 'FAILED' || phonePeState === 'EXPIRED') {
      newStatus = 'failed'
    } else {
      // Still pending
      newStatus = 'initiated'
    }

    // 4. Update DB with real status
    if (newStatus !== 'initiated') {
      await supabase
        .from('orders')
        .update({ payment_status: newStatus })
        .eq('id', orderId)
    }

    return new Response(JSON.stringify({ status: newStatus, order: { ...order, payment_status: newStatus }, raw: statusData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('check-status error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
