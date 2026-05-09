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

function getRedirectUrl(result: Record<string, unknown>): string | null {
  const direct = result['redirectUrl']
  if (typeof direct === 'string' && direct.length > 0) return direct

  const data = result['data'] as Record<string, unknown> | undefined
  const instrumentResponse = data?.['instrumentResponse'] as Record<string, unknown> | undefined
  const redirectInfo = instrumentResponse?.['redirectInfo'] as Record<string, unknown> | undefined
  const nested = redirectInfo?.['url']
  if (typeof nested === 'string' && nested.length > 0) return nested

  const paymentPage = result['paymentPage'] as Record<string, unknown> | undefined
  const pageUrl = paymentPage?.['url']
  if (typeof pageUrl === 'string' && pageUrl.length > 0) return pageUrl

  return null
}

async function sha256Hex(input: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function tryOauthCheckout(
  orderId: string,
  transactionId: string,
  amount: number,
  customerPhone: string,
  siteUrl: string,
): Promise<{ success: boolean; result: Record<string, unknown>; status: number }> {
  const clientId = Deno.env.get('PHONEPE_CLIENT_ID')
  const clientSecret = Deno.env.get('PHONEPE_CLIENT_SECRET')
  const clientVersion = Deno.env.get('PHONEPE_CLIENT_VERSION')

  if (!clientId || !clientSecret || !clientVersion) {
    return {
      success: false,
      result: { message: 'OAuth credentials not configured' },
      status: 500,
    }
  }

  const accessToken = await getPhonePeToken(clientId, clientSecret, clientVersion)
  console.log('Token obtained')

  const payload = {
    merchantOrderId: transactionId,
    amount: Math.round(amount * 100),
    expireAfter: 1200,
    paymentFlow: {
      type: 'PG_CHECKOUT',
      message: 'Payment for Libas Collection order',
      merchantUrls: {
        redirectUrl: `${siteUrl}/payment-callback.html?txn=${transactionId}&order=${orderId}`,
        callbackUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/verify-payment`,
      },
    },
  }

  console.log('Payload:', JSON.stringify(payload))

  const envMode = (Deno.env.get('PHONEPE_ENV') || 'production').toLowerCase()
  const hosts = envMode === 'preprod'
    ? ['https://api-preprod.phonepe.com', 'https://api.phonepe.com']
    : ['https://api.phonepe.com', 'https://api-preprod.phonepe.com']
  
  // Prioritize V2 Checkout API as confirmed by Postman
  const paths = [
    '/apis/pg/checkout/v2/pay',
    '/apis/pg/checkout/v1/pay',
    '/apis/hermes/checkout/v1/pay',
  ]
  const endpoints = hosts.flatMap((host) => paths.map((path) => `${host}${path}`))

  let lastStatus = 0
  let lastRaw = ''
  let lastResult: Record<string, unknown> = {}

  for (const url of endpoints) {
    console.log('Trying:', url)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `O-Bearer ${accessToken}`,
        'accept': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    lastStatus = res.status
    lastRaw = await res.text()
    console.log(`[${url}] Status: ${lastStatus} | Body: ${lastRaw}`)

    try { 
      lastResult = JSON.parse(lastRaw) 
    } catch (_) { 
      lastResult = { raw: lastRaw } 
    }

    // Success check for V2 (returns orderId and state) or V1 (returns success: true)
    if (lastStatus === 200 && (lastResult['orderId'] || lastResult['success'] === true)) {
      return { success: true, result: lastResult, status: lastStatus }
    }

    const messageValue = lastResult['message']
    const mappingNotFound =
      typeof messageValue === 'string'
      && messageValue.toLowerCase().includes('api mapping not found')
    if (mappingNotFound || lastStatus === 404) continue
    
    // If we got a real error response from a known endpoint, stop and report it
    if (lastRaw && lastRaw.length > 5) break
  }

  return { success: false, result: lastResult, status: lastStatus }
}

async function tryLegacyPgPay(
  orderId: string,
  transactionId: string,
  amount: number,
  customerPhone: string,
  siteUrl: string,
): Promise<{ success: boolean; result: Record<string, unknown>; status: number }> {
  const merchantId = Deno.env.get('PHONEPE_MERCHANT_ID')
  const saltKey = Deno.env.get('PHONEPE_SALT_KEY')
  const saltIndex = Deno.env.get('PHONEPE_SALT_INDEX')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')

  if (!merchantId || !saltKey || !saltIndex || !supabaseUrl) {
    const missing: string[] = []
    if (!merchantId) missing.push('PHONEPE_MERCHANT_ID')
    if (!saltKey) missing.push('PHONEPE_SALT_KEY')
    if (!saltIndex) missing.push('PHONEPE_SALT_INDEX')
    if (!supabaseUrl) missing.push('SUPABASE_URL')
    console.error('Legacy PG credentials not configured. Missing:', missing.join(', '))
    return {
      success: false,
      result: {
        message: 'Legacy PG credentials not configured',
        missing_keys: missing,
      },
      status: 500,
    }
  }

  const envMode = (Deno.env.get('PHONEPE_ENV') || 'production').toLowerCase()
  const baseUrl = envMode === 'preprod'
    ? 'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay'
    : 'https://api.phonepe.com/apis/hermes/pg/v1/pay'

  const payload = {
    merchantId,
    merchantTransactionId: transactionId,
    merchantUserId: `USER_${customerPhone}`,
    amount: Math.round(amount * 100),
    redirectUrl: `${siteUrl}/payment-callback.html?txn=${transactionId}&order=${orderId}`,
    redirectMode: 'REDIRECT',
    callbackUrl: `${supabaseUrl}/functions/v1/verify-payment`,
    mobileNumber: customerPhone,
    paymentInstrument: { type: 'PAY_PAGE' },
  }
  const base64Payload = btoa(JSON.stringify(payload))
  const checksum = `${await sha256Hex(base64Payload + '/pg/v1/pay' + saltKey)}###${saltIndex}`

  console.log('Trying legacy pg/v1/pay:', baseUrl)
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-VERIFY': checksum,
      'accept': 'application/json',
    },
    body: JSON.stringify({ request: base64Payload }),
  })

  const raw = await res.text()
  console.log(`[${baseUrl}] Status: ${res.status} | Body: ${raw}`)
  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(raw) } catch (_) { parsed = { raw } }
  return { success: parsed['success'] === true, result: parsed, status: res.status }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { orderId, amount, customerPhone, customerName, siteUrl } = await req.json()

    const transactionId = `TXN${orderId.replace(/-/g,'').substring(0,16).toUpperCase()}`
    let finalResult: Record<string, unknown> = {}
    let finalStatus = 0

    const oauthAttempt = await tryOauthCheckout(orderId, transactionId, amount, customerPhone, siteUrl)
    let isSuccess = oauthAttempt.success
    finalResult = oauthAttempt.result
    finalStatus = oauthAttempt.status

    const oauthMessage = finalResult['message']
    const shouldFallbackToLegacy =
      oauthAttempt.success !== true
      && typeof oauthMessage === 'string'
      && oauthMessage.toLowerCase().includes('api mapping not found')

    if (shouldFallbackToLegacy) {
      console.log('OAuth route mapping unavailable, trying legacy pg/v1/pay')
      const legacyAttempt = await tryLegacyPgPay(orderId, transactionId, amount, customerPhone, siteUrl)
      isSuccess = legacyAttempt.success
      finalResult = legacyAttempt.result
      finalStatus = legacyAttempt.status
      if (legacyAttempt.success === true) {
        console.log('Legacy pg/v1/pay succeeded')
      }
    }

    if (isSuccess) {
      // Save to DB
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      await supabase.from('orders')
        .update({ payment_id: transactionId, payment_status: 'initiated' })
        .eq('id', orderId)

      // Handle both old and new response formats
      const redirectUrl = getRedirectUrl(finalResult)

      return new Response(JSON.stringify({
        success: true,
        redirectUrl,
        transactionId,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } else {
      return new Response(JSON.stringify({
        success: false,
        message: finalResult['message'] || finalResult['error'] || `HTTP ${finalStatus}`,
        phonepe_result: finalResult,
        http_status: finalStatus,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  } catch (err) {
    console.error('Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
