import { Link } from 'wouter';
import { Attribution, Wordmark } from '@/components/brand';
import { IdentityAvatar } from '@/lib/identity';

const spiky = { emojiId: '1F60E', gender: 'Male', color: '#F7C531', hairColor: '#E8187F' } as const;
const pony = { emojiId: '1F642', gender: 'Female', color: '#E5BE96', hairColor: '#33B3F2' } as const;

const steps = [
  ['Claim a name', 'One dedicated username, 3 to 24 letters, digits or underscores. Yours for good.'],
  ['Build your face', 'Pick any emoji from the OpenMoji library, any body color, any hair color, spiky or ponytails.'],
  ['Open a room, talk', 'Share the room code. Friends know you by the face you chose, not by a pulsing circle.'],
];

export default function Landing() {
  return (
    <div className="min-h-[100dvh] overflow-x-hidden">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Wordmark />
        <nav className="flex items-center gap-2">
          <Link href="/sign-in" className="btn" data-testid="link-sign-in">Sign in</Link>
          <Link href="/sign-up" className="btn btn-pink hidden sm:inline-flex" data-testid="link-sign-up">Get a name</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-5xl items-center gap-6 px-5 pb-16 pt-8 md:grid-cols-[1.2fr_1fr]">
          <div className="rise">
            <p className="label-mono mb-3 inline-block rounded-full bg-secondary px-3 py-1 sticker-sm">Voice-first hangout</p>
            <h1 className="font-display text-6xl font-extrabold leading-[0.9] sm:text-8xl">
              Know your friends by <span className="text-primary">face</span>, hear them by <span className="text-[hsl(200_92%_42%)]">voice</span>.
            </h1>
            <p className="mt-6 max-w-lg text-lg">
              Big Apple Live is a room for talking. Everyone keeps one dedicated name and one hand-built emoji identity. No cameras. No avatars that wiggle when you speak.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/sign-up" className="btn btn-pink text-lg" data-testid="button-hero-sign-up">Claim your name</Link>
              <Link href="/sign-in" className="btn btn-yellow text-lg" data-testid="button-hero-sign-in">I already have one</Link>
            </div>
          </div>
          <div className="relative mx-auto grid w-full max-w-sm place-items-center" aria-hidden>
            <div className="sticker absolute inset-6 -rotate-3 bg-accent/40" />
            <div className="relative flex">
              <IdentityAvatar identity={spiky} size={190} className="-rotate-6" />
              <IdentityAvatar identity={pony} size={190} className="-ml-12 mt-10 rotate-3" />
            </div>
          </div>
        </section>

        <section className="bg-foreground py-16 text-background">
          <div className="mx-auto max-w-5xl px-5">
            <h2 className="font-display text-4xl font-extrabold sm:text-6xl">Still faces. Live voices.</h2>
            <p className="mt-4 max-w-2xl text-lg opacity-90">
              Your identity is a fixed visual anchor. It never mimics your mouth and never reacts to sound, so recognizing someone is about who they are, not whether they are talking.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-16">
          <h2 className="font-display text-4xl font-extrabold sm:text-5xl">Three moves.</h2>
          <ol className="mt-8 space-y-4">
            {steps.map(([t, d], i) => (
              <li key={t} className="sticker flex items-start gap-5 p-5" style={{ marginLeft: `${i * 2}rem` }}>
                <span className="font-display text-5xl font-extrabold text-primary">{i + 1}</span>
                <div>
                  <h3 className="text-2xl font-bold">{t}</h3>
                  <p className="mt-1">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-5xl px-5">
          <div className="sticker grid gap-6 bg-secondary p-8 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="font-display text-4xl font-extrabold">Any color. Your call.</h2>
              <p className="mt-2 max-w-xl">No preset swatches. Use the picker or type a hex for both your emoji body and your hair. Change it any time and every room updates.</p>
            </div>
            <Link href="/sign-up" className="btn btn-pink" data-testid="button-cta-sign-up">Build mine</Link>
          </div>
        </section>
      </main>
      <Attribution />
    </div>
  );
}
