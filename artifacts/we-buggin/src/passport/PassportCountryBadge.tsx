import './passport-country-badge.css';

export type PassportCountry = { code: string; name: string };

/** Display the saved, self-reported country; this is not a verification badge. */
export function PassportCountryBadge({ country }: { country?: PassportCountry | null }) {
  const code = country?.code.trim().toUpperCase();
  const name = country?.name.trim();
  if (!code || !/^[A-Z]{2}$/.test(code) || !name) return null;
  const flag = String.fromCodePoint(...[...code].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
  return <span className="pf-passport-country" role="img" aria-label={`Country: ${name}`}
    title={name} data-testid="passport-country-badge">
    <span aria-hidden="true">{flag}</span>
  </span>;
}
