import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

let redis: Redis | null = null
if (url && token) redis = new Redis({ url, token })

// Section 8: 60 req/min per admin
export const adminLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, '1 m'),
      analytics: true,
      prefix: 'imp:admin',
    })
  : null

// Tighter limit on auth routes (OTP / TOTP) to slow brute-force.
export const authLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '1 m'),
      analytics: true,
      prefix: 'imp:auth',
    })
  : null

export async function checkLimit(
  limiter: Ratelimit | null,
  identifier: string,
): Promise<{ ok: boolean; remaining: number; reset: number }> {
  if (!limiter) return { ok: true, remaining: 999, reset: 0 }
  const result = await limiter.limit(identifier)
  return { ok: result.success, remaining: result.remaining, reset: result.reset }
}
