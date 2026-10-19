import type { ReactNode } from 'react';
import { LogoImage, Wordmark } from './brand';
import './sign-in-artwork.css';

export function SignInArtwork({ children }: { children: ReactNode }) {
  return (
    <div className="ch st-sign-in">
      <Wordmark />
      <div className="st-sign-in-layout">
        <div className="st-sign-in-art" aria-hidden="true">
          <LogoImage className="st-sign-in-art-logo" />
        </div>
        <div className="st-sign-in-form">{children}</div>
      </div>
    </div>
  );
}
