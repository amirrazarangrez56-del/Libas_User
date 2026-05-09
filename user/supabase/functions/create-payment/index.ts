import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { orderId, amount, customerPhone, customerName, siteUrl } = await req.json()

    const merchantId = Deno.env.get('PHONEPE_MERCHANT_ID')!
    const saltKey    = Deno.env.get('PHONEPE_SALT_KEY')!
    const saltIndex  = Deno.env.get('PHONEPE_SALT_INDEX')!

    const transactionId = `TXN${orderId.replace(/-/g,'').substring(0,16).toUpperCase()}`

    const payload = {
      merchantId,
      merchantTransactionId: transactionId,
      merchantUserId: `USER_${customerPhone}`,
      amount: Math.round(amount * 100), // in paise
      redirectUrl: `${siteUrl}/payment-callback.html?txn=${transactionId}&order=${orderId}`,
      redirectMode: 'REDIRECT',
      callbackUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/verify-payment`,
      mobileNumber: customerPhone,
      paymentInstrument: { type: 'PAY_PAGE' }
    }

    const base64Payload = btoa(JSON.stringify(payload))
    const stringToHash  = base64Payload + '/pg/v1/pay' + saltKey

    const msgBuffer  = new TextEncoder().encode(stringToHash)
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
    const hashHex    = Array.from(new Uint8Array(hashBuffer))
                         .map(b => b.toString(16).padStart(2,'0')).join('')
    const checksum   = hashHex + '###' + saltIndex

    // UAT sandbox endpoint. Switch to production when going live:
    // LIVE: https://api.phonepe.com/apis/hermes/pg/v1/pay
    const phonepeUrl = Deno.env.get('PHONEPE_ENV') === 'production'
      ? 'https://api.phonepe.com/apis/hermes/pg/v1/pay'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay'

    const phonepeRes = await fetch(phonepeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
        'accept': 'application/json'
      },
      body: JSON.stringify({ request: base64Payload })
    })

    const result = await phonepeRes.json()

    if (result.success) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      await supabase.from('orders')
        .update({ payment_id: transactionId, payment_status: 'initiated' })
        .eq('id', orderId)

      return new Response(JSON.stringify({
        success: true,
        redirectUrl: result.data.instrumentResponse.redirectInfo.url,
        transactionId
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } else {
      return new Response(JSON.stringify({ success: false, message: result.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})