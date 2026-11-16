function App() {
  return (
    <main style={{ position: 'fixed', inset: 0, background: '#000' }}>
    <header style={{ height: 44, display: 'flex', alignItems: 'center', padding: '0 12px' }}>
      <a href="/" style={{ color: '#fff', font: 'bold 16px system-ui', textDecoration: 'none', padding: '8px 12px', border: '1px solid #888', borderRadius: 6 }}>← Home</a>
    </header>
    <iframe
      src={`${import.meta.env.BASE_URL}game/index.html`}
      title="Skullcraft"
      allow="fullscreen; autoplay; gamepad"
      allowFullScreen
      style={{ width: '100%', height: 'calc(100dvh - 44px)', border: 0, display: 'block', background: '#000' }}
    />
    </main>
  );
}

export default App;
