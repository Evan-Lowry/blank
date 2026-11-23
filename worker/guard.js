// Abuse guards for the public write endpoints.
//  - rateLimit: per-IP limits per hour, kept in D1 (the Workers Rate Limiting binding only supports 10 or 60 second
//    periods, so it cannot express hourly limits). Only a keyed hash of the IP is stored, never the address.
//  - verifyTurnstile: Cloudflare Turnstile, checked on the server. Skipped when TURNSTILE_SECRET is not set.
const rateWindow = 3600;
const rateDefaults = { export: 20, report: 10, 'sync-create': 5 };
const rateVars = { export: 'RATE_EXPORT_PER_HOUR', report: 'RATE_REPORT_PER_HOUR', 'sync-create': 'RATE_SYNC_CREATE_PER_HOUR' };

function rateLimitFor(env, bucket) {
  const value = env[rateVars[bucket]];
  return value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : rateDefaults[bucket];
}

// A keyed hash of the caller's IP, different for every bucket and hour, so rows cannot be linked or reversed.
async function callerHash(request, env, bucket, windowStart) {
  const ip = request.headers.get('cf-connecting-ip') || 'no-ip';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.RATE_LIMIT_SALT || 'blank-rate-limit'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bucket + ':' + windowStart + ':' + ip));
  return [...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Counts this request. Returns { message, retryAfter } when the caller is over the limit, otherwise undefined.
// A limit of 0 turns the check off. If the database check itself fails, the request is allowed (and logged).
async function rateLimit(request, env, bucket) {
  const limit = rateLimitFor(env, bucket);
  if (!env.DB || limit <= 0) return;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % rateWindow);
  try {
    // The update only happens while the count is under the limit, so blocked requests stop writing.
    const counted = await env.DB.prepare(
      'INSERT INTO rate_limits (bucket, key_hash, window_start, count) VALUES (?, ?, ?, 1) ' +
      'ON CONFLICT (bucket, key_hash, window_start) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count'
    ).bind(bucket, await callerHash(request, env, bucket, windowStart), windowStart, limit).first();
    if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(windowStart - rateWindow).run();
    if (counted) return;
  } catch (error) {
    console.error('Rate limit check failed:', error.name, String(error.message).split('\n')[0]);
    return;
  }
  const retryAfter = windowStart + rateWindow - now;
  console.error('RATE_LIMITED:', bucket);
  return { message: 'Too many requests. Please try again in about ' + Math.max(1, Math.ceil(retryAfter / 60)) + ' minutes.', retryAfter };
}

// Checks the Turnstile token with Cloudflare. Returns { status, message } on failure, otherwise undefined.
// TURNSTILE_SECRET unset: skipped, so local development works without any Cloudflare setup.
async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET) return;
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return { status: 403, message: 'Please complete the verification check and try again.' };
  }
  let result;
  try {
    const form = new FormData();
    form.set('secret', env.TURNSTILE_SECRET);
    form.set('response', token);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    result = await response.json();
  } catch {
    return { status: 503, message: 'The verification check is unavailable right now. Try again in a moment.' };
  }
  return result?.success === true ? undefined : { status: 403, message: 'Verification failed. Reload the page and try again.' };
}

// Turnstile's public site key, safe to put in the page. Anything that is not a plain key is ignored.
function turnstileSiteKey(env) {
  return /^[0-9A-Za-z_-]{10,64}$/.test(env.TURNSTILE_SITE_KEY || '') ? env.TURNSTILE_SITE_KEY : '';
}
