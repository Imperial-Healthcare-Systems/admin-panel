import crypto from 'node:crypto'

const OTP_LENGTH = 6
const OTP_TTL_MINUTES = 10
const MAX_VERIFY_ATTEMPTS = 5

type OtpPayload = {
  v: 1
  email: string
  otpHash: string
  exp: number
}

type OtpVerificationInput = {
  email: string
  otp: string
  challengeToken: string
}

type OtpVerificationResult = {
  valid: boolean
  error?: string
}

type AttemptState = {
  attempts: number
  exp: number
}

const globalOtpState = globalThis as typeof globalThis & {
  __imperialAdminOtpAttempts?: Map<string, AttemptState>
}

const otpAttempts = globalOtpState.__imperialAdminOtpAttempts ?? new Map<string, AttemptState>()
globalOtpState.__imperialAdminOtpAttempts = otpAttempts

function getAuthSecret() {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  if (!secret) throw new Error('Missing NEXTAUTH_SECRET or AUTH_SECRET for OTP authentication.')
  return secret
}

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function fromBase64Url<T>(value: string) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
}

function signValue(value: string) {
  return crypto.createHmac('sha256', getAuthSecret()).update(value).digest('base64url')
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function hashOtp(email: string, otp: string, exp: number) {
  return crypto
    .createHash('sha256')
    .update(`${email}:${otp}:${exp}:${getAuthSecret()}`)
    .digest('hex')
}

function getAttemptState(challengeToken: string, exp: number) {
  const existing = otpAttempts.get(challengeToken)
  if (!existing || existing.exp < Date.now()) {
    const fresh = { attempts: 0, exp }
    otpAttempts.set(challengeToken, fresh)
    return fresh
  }
  return existing
}

function incrementAttempt(challengeToken: string, exp: number) {
  const state = getAttemptState(challengeToken, exp)
  state.attempts += 1
  otpAttempts.set(challengeToken, state)
}

function clearAttempt(challengeToken: string) {
  otpAttempts.delete(challengeToken)
}

export function maskEmail(email: string) {
  const [localPart, domain = ''] = email.split('@')
  if (!localPart) return email
  const visible = localPart.slice(0, 2)
  const masked = '*'.repeat(Math.max(localPart.length - 2, 2))
  return `${visible}${masked}@${domain}`
}

export function createOtpChallenge(email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  const otp = crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0')
  const exp = Date.now() + OTP_TTL_MINUTES * 60 * 1000
  const payload: OtpPayload = {
    v: 1,
    email: normalizedEmail,
    otpHash: hashOtp(normalizedEmail, otp, exp),
    exp,
  }
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signature = signValue(encodedPayload)
  return {
    otp,
    challengeToken: `${encodedPayload}.${signature}`,
    expiresAt: exp,
    expiresInMinutes: OTP_TTL_MINUTES,
  }
}

export function verifyOtpChallenge({ email, otp, challengeToken }: OtpVerificationInput): OtpVerificationResult {
  try {
    if (!/^\d{6}$/.test(otp)) return { valid: false, error: 'Enter a valid 6-digit OTP.' }

    const [encodedPayload, signature] = challengeToken.split('.')
    if (!encodedPayload || !signature) return { valid: false, error: 'Invalid OTP challenge.' }

    const expectedSignature = signValue(encodedPayload)
    if (!safeCompare(signature, expectedSignature)) return { valid: false, error: 'Invalid OTP challenge.' }

    const payload = fromBase64Url<OtpPayload>(encodedPayload)
    if (payload.v !== 1) return { valid: false, error: 'Unsupported OTP challenge.' }

    if (payload.exp < Date.now()) {
      clearAttempt(challengeToken)
      return { valid: false, error: 'Your OTP has expired. Request a new code.' }
    }

    const attemptState = getAttemptState(challengeToken, payload.exp)
    if (attemptState.attempts >= MAX_VERIFY_ATTEMPTS) {
      return { valid: false, error: 'Too many invalid attempts. Request a new OTP.' }
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (payload.email !== normalizedEmail) {
      incrementAttempt(challengeToken, payload.exp)
      return { valid: false, error: 'This OTP does not match the current email.' }
    }

    const expectedOtpHash = hashOtp(normalizedEmail, otp, payload.exp)
    if (!safeCompare(payload.otpHash, expectedOtpHash)) {
      incrementAttempt(challengeToken, payload.exp)
      return { valid: false, error: 'Incorrect OTP. Please try again.' }
    }

    clearAttempt(challengeToken)
    return { valid: true }
  } catch {
    return { valid: false, error: 'Unable to verify OTP. Request a new code.' }
  }
}

// §4.1 of the bible references `verifyOtp`; IHRMS exports `verifyOtpChallenge`.
// Alias so the spec's call site reads identically.
export const verifyOtp = verifyOtpChallenge
