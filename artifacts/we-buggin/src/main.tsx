import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

// Preserve old bookmarks without maintaining a second app under the old prefix.
if (/^\/legacy-big-apple(?:\/|$)/.test(window.location.pathname)) {
  window.location.replace(
    (window.location.pathname.replace(/^\/legacy-big-apple/, '') || '/') +
    window.location.search + window.location.hash,
  );
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
