import { Link } from 'wouter';

export function AppLogo({ size = 36 }: { size?: number }) {
  return <img className="st-shield-logo" src={`${import.meta.env.BASE_URL}streamtalk-shield.svg`} alt="Streamtalk shield"
    width={size} height={size} decoding="async" fetchPriority="high"
    style={{ objectFit: 'contain', flexShrink: 0 }} />;
}

export function Wordmark({ href = '/', className = '' }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`st-wordmark-lockup ${className}`.trim()} aria-label="STREAMTALK home" data-testid="link-home">
      <AppLogo />
      <span className="st-wordmark font-display text-xl font-extrabold">STREAMTALK</span>
    </Link>
  );
}

export function Attribution() {
  return (
    <footer className="mx-auto mt-16 max-w-5xl px-5 pb-10 text-xs text-muted-foreground" data-testid="text-attribution">
      Emoji artwork by{' '}
      <a className="font-bold underline" href="https://openmoji.org" target="_blank" rel="noreferrer">OpenMoji</a>, the open-source emoji and icon project, licensed{' '}
      <a className="font-bold underline" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
      Emoji bodies are recolored and hair is layered around them in Streamtalk, so what you see is an adaptation shared under the same license.
    </footer>
  );
}
