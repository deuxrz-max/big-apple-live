import { Link } from 'wouter';

export function AppLogo({ size = 36 }: { size?: number }) {
  return <img src={`${import.meta.env.BASE_URL}streamtalk-logo.webp`} alt="Streamtalk logo"
    width={size} height={size} decoding="async"
    style={{ objectFit: 'contain', flexShrink: 0 }} />;
}

export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2" data-testid="link-home">
      <AppLogo />
      <span className="font-display text-xl font-extrabold">Streamtalk</span>
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
