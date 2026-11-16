function App() {
  return (
    <iframe
      src={`${import.meta.env.BASE_URL}game/index.html`}
      title="Skullcraft"
      allow="fullscreen; autoplay; gamepad"
      allowFullScreen
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100dvh', border: 0, display: 'block', background: '#000' }}
    />
  );
}

export default App;
