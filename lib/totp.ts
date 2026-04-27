import { authenticator } from 'otplib'
import QRCode from 'qrcode'

authenticator.options = { window: 1, step: 30 }

const ISSUER = 'Imperial Admin'

export function generateTotpSecret() {
  return authenticator.generateSecret()
}

export function buildOtpauthUri(email: string, secret: string) {
  return authenticator.keyuri(email, ISSUER, secret)
}

export async function buildQrDataUrl(email: string, secret: string) {
  const uri = buildOtpauthUri(email, secret)
  return QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
}

export function verifyTotp(token: string, secret: string) {
  if (!/^\d{6}$/.test(token)) return false
  try {
    return authenticator.check(token, secret)
  } catch {
    return false
  }
}
