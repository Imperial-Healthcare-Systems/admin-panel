import nodemailer from 'nodemailer'

const host = process.env.SMTP_HOST ?? ''
const port = Number(process.env.SMTP_PORT ?? 465)
const user = process.env.SMTP_USER ?? ''
const pass = process.env.SMTP_PASS ?? ''
const from = process.env.SMTP_FROM ?? 'Imperial Admin <admin@imperialhealthcare.cloud>'

let transporter: nodemailer.Transporter | null = null

function getTransporter() {
  if (!host || !user || !pass) return null
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    })
  }
  return transporter
}

export async function sendOtpEmail(to: string, otp: string, expiresInMinutes: number) {
  const t = getTransporter()
  if (!t) {
    // Dev fallback: surface OTP in server logs so login still works in local dev.
    console.warn(`[admin-otp] SMTP not configured. OTP for ${to}: ${otp}`)
    return { delivered: false, dev: true }
  }
  const subject = 'Imperial Admin Console — verification code'
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0F1E33;color:#E8EEF7;border-radius:12px;">
      <h2 style="font-family:Outfit,Inter,sans-serif;color:#E8EEF7;margin:0 0 8px;">Imperial Admin Console</h2>
      <p style="color:#94A8C2;margin:0 0 24px;font-size:14px;">Internal operations — confidential.</p>
      <p style="font-size:14px;color:#E8EEF7;">Use this code to sign in:</p>
      <div style="font-family:'SF Mono',monospace;font-size:32px;letter-spacing:8px;font-weight:700;color:#1E88E5;background:#0A1628;padding:16px;border-radius:8px;text-align:center;margin:16px 0;">${otp}</div>
      <p style="font-size:13px;color:#94A8C2;margin:0;">Valid for ${expiresInMinutes} minutes. If you did not request this code, ignore this email and notify security@imperialhealthcare.cloud immediately.</p>
    </div>
  `
  await t.sendMail({ from, to, subject, html })
  return { delivered: true }
}
