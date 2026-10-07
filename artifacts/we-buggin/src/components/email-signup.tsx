import { useState } from 'react';
import { useSignUp } from '@clerk/react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function EmailSignUp({ onContinue }: { onContinue: () => void }) {
  const { signUp, errors, fetchStatus } = useSignUp();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [code, setCode] = useState('');
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const busy = fetchStatus === 'fetching';
  const awaitingCode = signUp.status === 'missing_requirements' && signUp.unverifiedFields.includes('email_address');
  const mismatch = pw !== pw2;
  const clerkMsg = err ?? errors.global?.[0]?.message ?? null;

  const finish = async () => {
    try {
      const { error } = await signUp.finalize({ navigate: ({ decorateUrl }) => { window.location.assign(decorateUrl(`${basePath}/home`)); } });
      if (error) setErr(error.message);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not finish sign-up.'); }
  };
  const [other, setOther] = useState(false);
  const start = async () => {
    if (busy) return;
    setTried(true); setErr(null); setOther(false);
    if (!email.trim() || pw.length < 8 || mismatch) return;
    try {
      const r = await signUp.password({ emailAddress: email.trim(), password: pw });
      if (r.error) { setErr(r.error.message); return; }
      if (signUp.status === 'complete') { await finish(); return; }
      if (signUp.unverifiedFields.includes('email_address')) {
        const s = await signUp.verifications.sendEmailCode();
        if (s.error) setErr(s.error.message);
      } else setOther(true);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Sign-up failed. Try again.'); }
  };
  const verify = async () => {
    if (busy) return;
    setErr(null);
    try {
      const r = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (r.error) { setErr(r.error.message); return; }
      if (signUp.status === 'complete') await finish();
      else setOther(true);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Verification failed.'); }
  };
  const resend = async () => {
    if (busy) return;
    setErr(null);
    try {
      const r = await signUp.verifications.sendEmailCode();
      if (r.error) setErr(r.error.message);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not resend.'); }
  };

  return (
    <div className="ch-card">
      {other && <div className="ch-err" role="alert">More steps are needed to finish your account. <button type="button" className="bm-btn bm-btn-sm" onClick={onContinue}>Continue sign-up</button></div>}
      <h2>{awaitingCode ? 'Check your email' : 'Sign up with email'}</h2>
      {awaitingCode ? (
        <form noValidate className="ch-form" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <label>Verification code sent to {email || 'your email'}
            <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} data-testid="input-verify-code" />
            {errors.fields.code && <span className="ch-fe" role="alert">{errors.fields.code.message}</span>}
          </label>
          {clerkMsg && <div className="ch-err" role="alert">{clerkMsg}</div>}
          <p>
            <button type="submit" className="bm-btn bm-btn-primary" disabled={busy || !code.trim()} data-testid="button-verify">{busy ? 'Verifying...' : 'Verify and continue'}</button>{' '}
            <button type="button" className="bm-btn" disabled={busy} onClick={resend} data-testid="button-resend">Resend code</button>
          </p>
        </form>
      ) : (
        <form noValidate className="ch-form" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <label>Email
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
            {errors.fields.emailAddress && <span className="ch-fe" role="alert">{errors.fields.emailAddress.message}</span>}
            {tried && !email.trim() && <span className="ch-fe" role="alert">Enter your email.</span>}
          </label>
          <label>Password (8+ characters)
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="input-password" />
            {errors.fields.password && <span className="ch-fe" role="alert">{errors.fields.password.message}</span>}
            {tried && pw.length < 8 && <span className="ch-fe" role="alert">Use at least 8 characters.</span>}
          </label>
          <label>Confirm password
            <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={tried && mismatch} data-testid="input-confirm-password" />
            {(tried || pw2) && mismatch && <span className="ch-fe" role="alert">Passwords do not match.</span>}
          </label>
          <div id="clerk-captcha" />
          {clerkMsg && <div className="ch-err" role="alert">{clerkMsg}</div>}
          <p><button type="submit" className="bm-btn bm-btn-primary" disabled={busy} data-testid="button-signup-email">{busy ? 'Creating...' : 'Create account'}</button></p>
        </form>
      )}
    </div>
  );
}
