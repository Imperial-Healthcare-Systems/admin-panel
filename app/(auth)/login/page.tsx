'use client'

import { useState, FormEvent, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { ShieldCheck, Mail, KeyRound, QrCode, Loader2 } from 'lucide-react'

type Step = 'email' | 'otp' | 'totp-enroll' | 'totp-verify'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[var(--color-text-dim)] text-sm">Loading…</div>}>
      <LoginInner />
    </Suspense>
  )
}

function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  const callbackUrl = params.get('callbackUrl') ?? '/dashboard'

  const [step, setStep] = useState<Step>('email')
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [challengeToken, setChallengeToken] = useState('')
  const [otp, setOtp] = useState('')
  const [needsEnrollment, setNeedsEnrollment] = useState(false)

  const [enrollSecret, setEnrollSecret] = useState('')
  const [enrollQr, setEnrollQr] = useState('')
  const [totp, setTotp] = useState('')

  async function handleEmail(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to send OTP')
      if (!json.challengeToken) {
        // Generic privacy-preserving response when email isn't an admin.
        toast.success(json.message ?? 'If this address is registered, a code has been sent.')
        return
      }
      setMaskedEmail(json.maskedEmail)
      setChallengeToken(json.challengeToken)
      setNeedsEnrollment(json.needsTotpEnrollment)
      setStep('otp')
      toast.success('Code sent')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleOtp(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(otp)) {
      toast.error('Enter the 6-digit code')
      return
    }
    setBusy(true)
    try {
      if (needsEnrollment) {
        // Verify OTP via the setup route — it returns a fresh secret + QR.
        const res = await fetch('/api/auth/totp/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, otp, challengeToken }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Verification failed')
        setEnrollSecret(json.secret)
        setEnrollQr(json.qrDataUrl)
        setStep('totp-enroll')
      } else {
        setStep('totp-verify')
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleEnroll(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(totp)) {
      toast.error('Enter the 6-digit authenticator code')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/totp/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, challengeToken, secret: enrollSecret, totp }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Enrollment failed')
      // After enrollment, sign in with the same TOTP code.
      await completeSignIn(totp)
    } catch (err) {
      toast.error((err as Error).message)
      setBusy(false)
    }
  }

  async function handleTotpVerify(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(totp)) {
      toast.error('Enter the 6-digit authenticator code')
      return
    }
    setBusy(true)
    await completeSignIn(totp)
  }

  async function completeSignIn(totpCode: string) {
    const result = await signIn('credentials', {
      email,
      otp,
      challengeToken,
      totp: totpCode,
      redirect: false,
    })
    if (result?.error) {
      toast.error('Invalid credentials')
      setBusy(false)
      return
    }
    toast.success('Welcome to Imperial Admin')
    router.replace(callbackUrl)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-imperial-blue)] flex items-center justify-center">
            <ShieldCheck size={20} color="white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text)]">Imperial Admin Console</h1>
            <p className="text-xs text-[var(--color-text-dim)]">Internal operations only.</p>
          </div>
        </div>

        <div className="imp-card p-6">
          {step === 'email' && (
            <form onSubmit={handleEmail} className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Mail size={18} /> Sign in
              </h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                Enter your Imperial email to receive a verification code.
              </p>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@imperialhealthcare.cloud"
                className="imp-input"
              />
              <button type="submit" disabled={busy} className="imp-btn imp-btn-primary w-full justify-center">
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Send code
              </button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleOtp} className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <KeyRound size={18} /> Email code
              </h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                We sent a 6-digit code to <strong>{maskedEmail}</strong>. Valid for 10 minutes.
              </p>
              <input
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoFocus
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="imp-input text-center tracking-[0.5em] text-xl font-mono"
              />
              <button type="submit" disabled={busy} className="imp-btn imp-btn-primary w-full justify-center">
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Continue
              </button>
              <button
                type="button"
                onClick={() => setStep('email')}
                className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]"
              >
                Use a different email
              </button>
            </form>
          )}

          {step === 'totp-enroll' && (
            <form onSubmit={handleEnroll} className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <QrCode size={18} /> Set up authenticator
              </h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                Scan with Google Authenticator / 1Password / Authy. Then enter the 6-digit code shown.
              </p>
              {enrollQr && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={enrollQr}
                  alt="TOTP QR code"
                  className="mx-auto rounded-lg border border-[var(--color-border-strong)] bg-white p-2"
                />
              )}
              <details className="text-xs text-[var(--color-text-dim)]">
                <summary className="cursor-pointer">Can&apos;t scan? Show secret</summary>
                <code className="block mt-2 break-all bg-[var(--color-surface-2)] p-2 rounded">{enrollSecret}</code>
              </details>
              <input
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="imp-input text-center tracking-[0.5em] text-xl font-mono"
              />
              <button type="submit" disabled={busy} className="imp-btn imp-btn-primary w-full justify-center">
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Enroll &amp; sign in
              </button>
            </form>
          )}

          {step === 'totp-verify' && (
            <form onSubmit={handleTotpVerify} className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ShieldCheck size={18} /> Authenticator code
              </h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                Enter the 6-digit code from your authenticator app.
              </p>
              <input
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoFocus
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="imp-input text-center tracking-[0.5em] text-xl font-mono"
              />
              <button type="submit" disabled={busy} className="imp-btn imp-btn-primary w-full justify-center">
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Sign in
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-[var(--color-text-dim)] mt-4">
          CONFIDENTIAL — Imperial team only. Sessions expire after 8 hours.
        </p>
      </div>
    </div>
  )
}
