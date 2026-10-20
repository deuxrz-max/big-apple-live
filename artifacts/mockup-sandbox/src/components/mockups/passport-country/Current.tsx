import './_group.css';

export function Current() {
  const code = 'US';
  const flag = String.fromCodePoint(...[...code].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
  return (
    <main className="passport-country-mockup">
      <div className="passport-country-mockup__frame">
        <div className="passport-country-mockup__photo">
          <span className="pf-passport-country--current" role="img" aria-label="Country: United States" title="United States">
            {flag}
          </span>
        </div>
        <p className="passport-country-mockup__caption">Current Me-page country marker</p>
      </div>
    </main>
  );
}
