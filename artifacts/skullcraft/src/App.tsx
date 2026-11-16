function App() {
  const params = new URLSearchParams(window.location.search);
  const playerName = params.get('playerName')?.trim().slice(0, 40) ?? '';
  const requestedReturnTo = params.get('returnTo') ?? '';
  const returnTo = requestedReturnTo.startsWith('/rooms/') ? requestedReturnTo : '/';
  const gameParams = new URLSearchParams();
  if (playerName) gameParams.set('playerName', playerName);
  const gameQuery = gameParams.toString();
  return (
    <main style={{ position: 'fixed', inset: 0, background: '#000' }}>
    <header style={{ height: 44, display: 'flex', alignItems: 'center', padding: '0 12px' }}>
      <a href={returnTo} style={{ color: '#fff', font: 'bold 16px system-ui', textDecoration: 'none', padding: '8px 12px', border: '1px solid #888', borderRadius: 6 }}>{returnTo === '/' ? '← Home' : '← Back to Room'}</a>
    </header>
    <iframe
      src={`${import.meta.env.BASE_URL}game/index.html${gameQuery ? `?${gameQuery}` : ''}`}
      title="Skullcraft"
      allow="fullscreen; autoplay; gamepad"
      allowFullScreen
      style={{ width: '100%', height: 'calc(100dvh - 44px)', border: 0, display: 'block', background: '#000' }}
    />
    </main>
  );
}

export default App;
