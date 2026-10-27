import { Link } from 'wouter';

export const APP_NAME = 'Big Apple Live';
export const BRAND_LOGO_PATH = `${import.meta.env.BASE_URL}brand/big-apple-live-approved.jpg`;

export function LogoImage({
  size,
  className = '',
  alt = 'Big Apple Live logo',
  title,
  animated = true,
}: {
  size?: number;
  className?: string;
  alt?: string;
  title?: string;
  animated?: boolean;
}) {
  return (
    <span
      className={`dw-logo-glass ${className}`.trim()}
      style={size ? { width: size, height: size } : undefined}
      title={title}
      data-animated={animated ? 'true' : 'false'}
    >
      <img className="dw-logo-glass-image" src={BRAND_LOGO_PATH} alt={alt}
        width={size} height={size} decoding="async" fetchPriority="high" />
    </span>
  );
}

export function AppLogo({ size = 36 }: { size?: number }) {
  return <LogoImage size={size} className="st-shield-logo" />;
}

export function Wordmark({ href = '/', className = '' }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`st-wordmark-lockup ${className}`.trim()} aria-label="Big Apple Live home" data-testid="link-home">
      <AppLogo />
      <span className="st-wordmark font-display text-xl font-extrabold">BIG APPLE LIVE</span>
    </Link>
  );
}

export function Attribution() {
  return (
    <footer className="mx-auto mt-16 max-w-5xl px-5 pb-10 text-xs text-muted-foreground" data-testid="text-attribution">
      Emoji artwork by{' '}
      <a className="font-bold underline" href="https://openmoji.org" target="_blank" rel="noreferrer">OpenMoji</a>, the open-source emoji and icon project, licensed{' '}
      <a className="font-bold underline" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
      Emoji bodies are recolored and hair is layered around them in Big Apple Live, so what you see is an adaptation shared under the same license.
    </footer>
  );
}
