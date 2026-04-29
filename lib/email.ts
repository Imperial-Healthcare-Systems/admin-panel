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

export type OrgWelcomeParams = {
  orgName: string
  products: string[]            // e.g. ['IHRMS', 'ICRM']
  tier?: string
  seats?: number
  amountPerMonth?: number       // INR
  trialDays?: number
  trialEndsAt?: string | null
  starterCredits?: number
  ihrmsUrl?: string
  icrmUrl?: string
}

export async function sendOrgWelcomeEmail(to: string, p: OrgWelcomeParams) {
  const t = getTransporter()
  if (!t) {
    console.warn(`[org-welcome] SMTP not configured. Would have emailed ${to}: ${p.orgName} provisioned with ${p.products.join(' + ')}.`)
    return { delivered: false, dev: true }
  }

  const inr = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

  const productsHtml = p.products
    .map((prod) => `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#0A1628;color:#1E88E5;font-size:12px;font-weight:600;margin-right:6px;">${prod}</span>`)
    .join('')

  const trialEnds = p.trialEndsAt ? new Date(p.trialEndsAt) : null
  const trialEndsLabel = trialEnds
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'long' }).format(trialEnds)
    : null

  const detailRows: string[] = []
  if (p.tier && p.seats != null) {
    detailRows.push(`<tr><td style="color:#94A8C2;padding:6px 0;">Plan</td><td style="color:#E8EEF7;text-align:right;">${escapeHtml(p.tier)} · ${p.seats} seat${p.seats === 1 ? '' : 's'}</td></tr>`)
  }
  if (p.amountPerMonth != null && p.amountPerMonth > 0) {
    detailRows.push(`<tr><td style="color:#94A8C2;padding:6px 0;">Subscription</td><td style="color:#E8EEF7;text-align:right;">${inr(p.amountPerMonth)} / month</td></tr>`)
  }
  if (p.trialDays && p.trialDays > 0) {
    detailRows.push(`<tr><td style="color:#94A8C2;padding:6px 0;">Trial</td><td style="color:#E8EEF7;text-align:right;">${p.trialDays} days${trialEndsLabel ? ` · ends ${trialEndsLabel}` : ''}</td></tr>`)
  }
  if (p.starterCredits && p.starterCredits > 0) {
    detailRows.push(`<tr><td style="color:#94A8C2;padding:6px 0;">Starter credits</td><td style="color:#E8EEF7;text-align:right;">${p.starterCredits.toLocaleString('en-IN')}</td></tr>`)
  }

  const productLinks = [
    p.products.includes('IHRMS') && (p.ihrmsUrl ?? process.env.IHRMS_BASE_URL) ? `<a href="${p.ihrmsUrl ?? process.env.IHRMS_BASE_URL}" style="color:#1E88E5;text-decoration:none;">IHRMS Dashboard →</a>` : '',
    p.products.includes('ICRM') && (p.icrmUrl ?? process.env.ICRM_BASE_URL) ? `<a href="${p.icrmUrl ?? process.env.ICRM_BASE_URL}" style="color:#1E88E5;text-decoration:none;">ICRM Dashboard →</a>` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ')

  const subject = `Welcome to Imperial Healthcare — ${p.orgName} is live`
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0F1E33;color:#E8EEF7;border-radius:12px;">
      <div style="border-bottom:1px solid #1F3A5C;padding-bottom:12px;margin-bottom:18px;">
        <h2 style="font-family:Outfit,Inter,sans-serif;color:#E8EEF7;margin:0 0 4px;font-size:22px;">Imperial Healthcare Systems</h2>
        <p style="color:#94A8C2;margin:0;font-size:13px;">Your account is ready.</p>
      </div>

      <p style="font-size:15px;color:#E8EEF7;margin:0 0 12px;">Hi there,</p>
      <p style="font-size:14px;color:#E8EEF7;line-height:1.55;margin:0 0 18px;">
        We've provisioned <strong>${escapeHtml(p.orgName)}</strong> on the Imperial platform. Below are the products and benefits attached to your account.
      </p>

      <div style="margin:0 0 18px;">${productsHtml}</div>

      ${detailRows.length ? `
      <table style="width:100%;font-size:13px;border-collapse:collapse;border-top:1px solid #1F3A5C;border-bottom:1px solid #1F3A5C;margin:6px 0 18px;">
        ${detailRows.join('')}
      </table>` : ''}

      ${productLinks ? `<p style="font-size:13px;margin:0 0 18px;">${productLinks}</p>` : ''}

      <div style="background:#0A1628;border-radius:8px;padding:14px 16px;font-size:13px;color:#94A8C2;line-height:1.55;margin:0 0 18px;">
        <strong style="color:#E8EEF7;">Next step:</strong> a separate email will arrive shortly with credentials for your administrator user. If you don't see it within 24 hours, please reach out at the address below.
      </div>

      <p style="font-size:12px;color:#6B82A0;margin:0;">
        Need help? Email <a href="mailto:support@imperialhealthcare.cloud" style="color:#1E88E5;text-decoration:none;">support@imperialhealthcare.cloud</a>.
      </p>
    </div>
  `
  await t.sendMail({ from, to, subject, html })
  return { delivered: true }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
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
