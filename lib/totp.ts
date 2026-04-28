// RFC 4648 base32 + RFC 6238 TOTP, implemented inline.
//
// Why not otplib: under Next.js's Webpack bundling, otplib's `thirty-two`
// plugin fails to load and `authenticator.generateSecret()` throws
// "Cannot read properties of undefined (reading '0')". The same root
// cause affects `check()` at verify time. Rather than ship a runtime
// liability, we use Node's built-in crypto + ~40 lines of plain code.
import crypto from 'node:crypto'
import QRCode from 'qrcode'

const ISSUER = 'Imperial Admin'
const STEP = 30
const DIGITS = 6
const VERIFY_WINDOW = 4 // accept ±2 minutes of clock skew between server and authenticator
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(s: string): Buffer {
  const cleaned = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function totpAt(secret: string, timeMs: number): string {
  let counter = Math.floor(timeMs / 1000 / STEP)
  const buf = Buffer.alloc(8)
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff
    counter = Math.floor(counter / 256)
  }
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0')
}

export function generateTotpSecret(): string {
  // 20 random bytes = 160 bits, the spec-recommended HOTP/TOTP secret length.
  return base32Encode(crypto.randomBytes(20))
}

export function buildOtpauthUri(email: string, secret: string): string {
  // Build query manually so issuer uses %20 for space (matching the label).
  // URLSearchParams produces `+` for space, which some Authenticator apps
  // accept but display as a literal "+" — confusing, and a few apps refuse
  // to register the entry when the label/issuer disagree.
  const label = encodeURIComponent(`${ISSUER}:${email}`)
  const enc = (s: string) => encodeURIComponent(s)
  const params =
    `secret=${secret}` +
    `&issuer=${enc(ISSUER)}` +
    `&algorithm=SHA1` +
    `&digits=${DIGITS}` +
    `&period=${STEP}`
  return `otpauth://totp/${label}?${params}`
}

export async function buildQrDataUrl(email: string, secret: string): Promise<string> {
  const uri = buildOtpauthUri(email, secret)
  return QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
}

export function verifyTotp(token: string, secret: string): boolean {
  if (!/^\d{6}$/.test(token)) return false
  if (!secret) return false
  const now = Date.now()
  const expectedCodes: string[] = []
  for (let i = -VERIFY_WINDOW; i <= VERIFY_WINDOW; i++) {
    try {
      const code = totpAt(secret, now + i * STEP * 1000)
      expectedCodes.push(code)
      if (code === token) return true
    } catch {
      return false
    }
  }
  // Diagnostic — comment out once enrollment is working in production.
  console.warn(
    `[totp] verify failed. got=${token} expected_window=${expectedCodes.join(',')} secret_prefix=${secret.slice(0, 4)}…(${secret.length} chars)`,
  )
  return false
}
