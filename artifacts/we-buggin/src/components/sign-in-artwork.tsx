import type { ReactNode } from 'react';
import { BRAND_LOGO_PATH, Wordmark } from './brand';
import './sign-in-artwork.css';

export function SignInArtwork({ children }: { children: ReactNode }) {
  return (
    <div className="ch st-sign-in">
      <Wordmark />
      <div className="st-sign-in-layout">
        <div className="st-sign-in-art" aria-hidden="true">
          <img src={BRAND_LOGO_PATH} alt="Deux Wild logo"
            decoding="async" fetchPriority="high" />
        </div>
        <div className="st-sign-in-form">{children}</div>
      </div>
    </div>
  );
}
