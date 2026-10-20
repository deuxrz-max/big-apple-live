import './_group.css';

export function Inspired() {
  const code = 'US';
  const flag = String.fromCodePoint(...[...code].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
  return (
    <main className="passport-country-mockup">
      <div className="passport-country-mockup__frame">
        <div className="passport-country-mockup__photo">
          <span className="pf-passport-country--inspired" role="img" aria-label="Country: United States — self-listed" title="United States — self-listed">
            <span className="seal" aria-hidden="true"><span className="code">{code}</span></span>
            <span className="details" aria-hidden="true">
              <span className="name"><span className="flag">{flag}</span><span>United States</span></span>
              <span className="self-listed">SELF-LISTED</span>
            </span>
          </span>
        </div>
        <p className="passport-country-mockup__caption">Passport-style country marker</p>
      </div>
    </main>
  );
}
