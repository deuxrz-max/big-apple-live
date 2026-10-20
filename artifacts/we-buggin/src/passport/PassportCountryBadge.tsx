import './passport-country-badge.css';

export type PassportCountry = { code: string; name: string };

/** Display the saved, self-reported country; this is not a verification badge. */
export function PassportCountryBadge({ country }: { country?: PassportCountry | null }) {
  const code = country?.code.trim().toUpperCase();
  const name = country?.name.trim();
  if (!code || !/^[A-Z]{2}$/.test(code) || !name) return null;
  const flag = String.fromCodePoint(...[...code].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
  return <span className="pf-passport-country" role="img" aria-label={`Country: ${name} — self-listed`}
    title={`${name} — self-listed`} data-testid="passport-country-badge">
    <span className="pf-passport-country__seal" aria-hidden="true">
      <span className="pf-passport-country__code">{code}</span>
    </span>
    <span className="pf-passport-country__details" aria-hidden="true">
      <span className="pf-passport-country__name">
        <span className="pf-passport-country__flag">{flag}</span>
        <span>{name}</span>
      </span>
      <span className="pf-passport-country__self-listed">SELF-LISTED</span>
    </span>
  </span>;
}
