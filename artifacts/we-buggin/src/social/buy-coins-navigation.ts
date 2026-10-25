const rechargePaths = new Set(['/community/coins', '/community/credits']);

/** Store only an internal return address on this browser history entry. */
export function buyCoinsReturnState() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const pathname = base && window.location.pathname.startsWith(`${base}/`)
    ? window.location.pathname.slice(base.length) : window.location.pathname;
  return { buyCoinsReturnTo: `${pathname}${window.location.search}${window.location.hash}` };
}

export function buyCoinsBackTarget(state: unknown): string {
  const target = state && typeof state === 'object' && 'buyCoinsReturnTo' in state
    ? state.buyCoinsReturnTo : null;
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')
    || /[\\\u0000-\u0020]/.test(target)) return '/home';
  if (rechargePaths.has(target.split(/[?#]/)[0].replace(/\/$/, ''))) return '/home';
  return target;
}
