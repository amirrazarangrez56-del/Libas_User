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
    const body = await req.json()
    const { response: encodedResponse } = body
    const xVerify = req.headers.get('X-VERIFY') || ''

    const saltKey   = Deno.env.get('PHONEPE_SALT_KEY')!
    const saltIndex = Deno.env.get('PHONEPE_SALT_INDEX')!

    // Verify the checksum from PhonePe
    const [receivedHash] = xVerify.split('###')
    const stringToHash   = encodedResponse + saltKey
    const msgBuffer      = new TextEncoder().encode(stringToHash)
    const hashBuffer     = await crypto.subtle.digest('SHA-256', msgBuffer)
    const computedHash   = Array.from(new Uint8Array(hashBuffer))
                             .map(b => b.toString(16).padStart(2,'0')).join('')

    if (computedHash !== receivedHash) {
      console.error('Checksum mismatch')
      return new Response('Invalid checksum', { status: 400 })
    }

    const decoded       = JSON.parse(atob(encodedResponse))
    const transactionId = decoded.data?.merchantTransactionId
    const paymentStatus = decoded.code === 'PAYMENT_SUCCESS' ? 'success' : 'failed'

    if (transactionId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      await supabase.from('orders')
        .update({ payment_status: paymentStatus })
        .eq('payment_id', transactionId)

      console.log(`Order ${transactionId} → ${paymentStatus}`)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
