import React from "react";

const seats = Array.from({ length: 12 }, (_, index) => index + 1);

function Spark({ x, y, color = "#7188ff", size = 3 }: { x: number; y: number; color?: string; size?: number }) {
  return (
    <circle cx={x} cy={y} r={size} fill={color} opacity="0.85" />
  );
}

function Seat({ x, y, number, accent = false }: { x: number; y: number; number: number; accent?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width="69" height="44" rx="5" fill={accent ? "#111a3b" : "#101113"} stroke={accent ? "#7188ff" : "#36383d"} strokeWidth={accent ? "1.5" : "1"} />
      <circle cx={x + 34.5} cy={y + 12} r="7" fill={accent ? "#3b5bff" : "#292c32"} />
      <path d={`M${x + 22} ${y + 33}c0-6 4-10 12.5-10s12.5 4 12.5 10`} fill={accent ? "#3b5bff" : "#292c32"} />
      <text x={x + 34.5} y={y + 41} textAnchor="middle" fill="#9b9b96" fontSize="8" fontFamily="Barlow, sans-serif" letterSpacing="1">{String(number).padStart(2, "0")}</text>
    </g>
  );
}

function FlowArrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <path d={`M${x1} ${y1} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`} fill="none" stroke="#536fff" strokeWidth="1.5" strokeDasharray="4 5" markerEnd="url(#guideArrow)" />;
}

export function BeamVisualGuide() {
  return (
    <div className="beam-guide">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600;700&display=swap" />
      <style>{`
        .beam-guide{width:1050px;height:1680px;box-sizing:border-box;position:relative;overflow:hidden;background:#050505;color:#f2f2ee;font-family:'Barlow',system-ui,sans-serif;padding:45px 56px 36px;line-height:1.35}
        .beam-guide *{box-sizing:border-box}
        .beam-guide:before,.beam-guide:after{content:"";position:absolute;pointer-events:none;border-radius:50%;filter:blur(2px);z-index:0}
        .beam-guide:before{width:560px;height:560px;left:-340px;top:200px;background:radial-gradient(circle,rgba(59,91,255,.17),rgba(59,91,255,0) 70%)}
        .beam-guide:after{width:620px;height:620px;right:-360px;top:580px;background:radial-gradient(circle,rgba(80,64,211,.12),rgba(80,64,211,0) 68%)}
        .bg-content{position:relative;z-index:1}
        .bg-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
        .bg-brand{font-family:'Barlow Condensed',sans-serif;font-size:19px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
        .bg-brand span{color:#8294ff}
        .bg-badge{border:1px solid #36383d;color:#a7a7a1;padding:7px 11px;font-size:10px;letter-spacing:.15em;text-transform:uppercase}
        .bg-eyebrow{color:#8da1ff;font-size:11px;letter-spacing:.19em;text-transform:uppercase;font-weight:700;margin-bottom:9px}
        .bg-title{font-family:'Barlow Condensed',sans-serif;font-size:66px;line-height:.91;letter-spacing:-.02em;font-weight:800;text-transform:uppercase;margin:0;max-width:700px}
        .bg-intro{color:#a7a7a1;font-size:15px;margin:14px 0 23px;max-width:620px}
        .bg-rule{height:1px;background:#303136;margin:20px 0 21px}
        .bg-section-head{display:flex;align-items:baseline;gap:13px;margin-bottom:13px}
        .bg-num{font-family:'Barlow Condensed',sans-serif;color:#8194ff;font-size:14px;font-weight:800;letter-spacing:.12em}
        .bg-h2{font-family:'Barlow Condensed',sans-serif;font-size:27px;font-weight:800;text-transform:uppercase;line-height:1;margin:0;letter-spacing:.015em}
        .bg-sub{font-size:12px;color:#9b9b96;margin-left:auto}
        .bg-panel{border:1px solid #303136;background:rgba(11,12,15,.76)}
        .bg-layout{padding:17px 19px 14px}
        .bg-layout-svg{display:block;width:100%;height:293px}
        .bg-callouts{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:9px}
        .bg-callout{border-left:2px solid #3b5bff;padding:4px 8px 4px 10px;color:#b8b8b2;font-size:12px}
        .bg-callout b{display:block;color:#f2f2ee;font-size:12px;margin-bottom:2px}
        .bg-activity{display:grid;grid-template-columns:1.1fr .9fr;gap:15px}
        .bg-chart{padding:17px 17px 13px}
        .bg-chart svg{width:100%;height:169px;display:block}
        .bg-chart-legend{display:flex;justify-content:space-between;color:#9b9b96;font-size:10px;margin-top:3px;letter-spacing:.04em}
        .bg-activity-notes{padding:18px 20px;display:flex;flex-direction:column;justify-content:center;gap:14px}
        .bg-note-row{display:flex;align-items:flex-start;gap:11px;color:#b9b9b3;font-size:12px}
        .bg-dot{width:7px;height:7px;flex:none;border-radius:50%;margin-top:5px;background:#7188ff;box-shadow:0 0 12px #526fff80}
        .bg-note-row strong{color:#f2f2ee;font-weight:600}
        .bg-cycle{padding:17px 19px 16px}
        .bg-cycle-svg{display:block;width:100%;height:160px}
        .bg-cycle-foot{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #292b30;padding-top:11px;color:#c2c2bd;font-size:12px}
        .bg-cycle-foot strong{color:#f2f2ee}
        .bg-shared{display:flex;align-items:center;gap:12px;padding:11px 14px;margin-top:11px;border:1px solid #303136;background:#0b0c10}
        .bg-shared-mark{width:28px;height:28px;display:grid;place-items:center;flex:none}
        .bg-shared-text{font-size:12px;color:#b9b9b3}
        .bg-shared-text b{color:#f2f2ee}
        .bg-caveat{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
        .bg-caveat-item{min-height:69px;border:1px solid #303136;padding:11px 13px;color:#a9a9a3;font-size:11px;background:rgba(11,12,15,.68)}
        .bg-caveat-item b{display:block;color:#f2f2ee;font-size:12px;margin-bottom:4px}
        .bg-footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #303136;padding-top:13px;margin-top:17px;color:#8e8e89;font-size:10px}
        .bg-footer strong{color:#b9b9b3;font-weight:600}
      `}</style>
      <div className="bg-content">
        <header className="bg-top">
          <div className="bg-brand">We <span>Buggin</span> / Beam</div>
          <div className="bg-badge">Visual guide · current experience</div>
        </header>

        <div className="bg-eyebrow">A room that moves with the moment</div>
        <h1 className="bg-title">How Beam<br />comes together</h1>
        <p className="bg-intro">A shared room for faces, chat and ambient color. Here’s the simple map of what stays put—and what shifts around you.</p>

        <section>
          <div className="bg-section-head">
            <span className="bg-num">01 / LAYOUT</span>
            <h2 className="bg-h2">One room, two anchors</h2>
            <span className="bg-sub">12-seat schematic · not a live screenshot</span>
          </div>
          <div className="bg-panel bg-layout">
            <svg className="bg-layout-svg" viewBox="0 0 920 293" role="img" aria-label="Schematic of Beam with a participant grid above a separate chat stream and composer">
              <defs>
                <radialGradient id="layoutAura"><stop stopColor="#3b5bff" stopOpacity=".29" /><stop offset="1" stopColor="#3b5bff" stopOpacity="0" /></radialGradient>
                <marker id="guideArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="#7188ff" strokeWidth="1.2" /></marker>
              </defs>
              <ellipse cx="410" cy="110" rx="350" ry="125" fill="url(#layoutAura)" />
              <text x="12" y="19" fill="#8e8e89" fontSize="10" fontFamily="Barlow, sans-serif" letterSpacing="1.7">PARTICIPANT GRID · ANCHORED ABOVE CHAT</text>
              <g>
                {seats.map((number) => {
                   const col = (number - 1) % 4;
                   const row = Math.floor((number - 1) / 4);
                   return <Seat key={number} x={16 + col * 79} y={31 + row * 49} number={number} accent={number === 1} />;
                })}
              </g>
              <FlowArrow x1={345} y1={90} x2={656} y2={90} />
              <text x="674" y="79" fill="#f2f2ee" fontSize="12" fontWeight="700" fontFamily="Barlow, sans-serif">THE GRID STAYS PUT</text>
              <text x="674" y="96" fill="#9b9b96" fontSize="11" fontFamily="Barlow, sans-serif">Ambient effects sit behind</text>
              <text x="674" y="111" fill="#9b9b96" fontSize="11" fontFamily="Barlow, sans-serif">content; boxes don’t move.</text>

              <path d="M14 183H906" stroke="#373940" strokeWidth="1" />
              <text x="14" y="201" fill="#8e8e89" fontSize="10" fontFamily="Barlow, sans-serif" letterSpacing="1.7">BORDERLESS CHAT STREAM</text>
              <g fontFamily="Barlow, sans-serif">
                <circle cx="24" cy="224" r="5" fill="#51545c" /><text x="38" y="228" fill="#d8d8d3" fontSize="11">A message appears in the room</text>
                <circle cx="24" cy="246" r="5" fill="#7188ff" /><text x="38" y="250" fill="#d8d8d3" fontSize="11">Chat stays in its own scroll area</text>
                <path d="M12 262H600" stroke="#292b30" />
                <rect x="12" y="271" width="588" height="15" rx="2" fill="#0e0f12" stroke="#35373d" />
                <text x="24" y="282" fill="#71716c" fontSize="9">Write a message…</text>
                <rect x="565" y="271" width="35" height="15" rx="2" fill="#3b5bff" />
                <path d="M616 271v15" stroke="#34363b" />
                <text x="637" y="224" fill="#f2f2ee" fontSize="12" fontWeight="700">OLDER CHAT?</text>
                <text x="637" y="242" fill="#9b9b96" fontSize="11">Scroll the chat only.</text>
                <text x="637" y="258" fill="#9b9b96" fontSize="11">The participant grid stays anchored.</text>
                <text x="637" y="282" fill="#8da1ff" fontSize="10" fontWeight="700">COMPOSER AT THE BOTTOM</text>
              </g>
            </svg>
            <div className="bg-callouts">
              <div className="bg-callout"><b>Grid above</b>Participants keep their place.</div>
              <div className="bg-callout"><b>Chat scrolls alone</b>Older messages never shift the grid.</div>
              <div className="bg-callout"><b>Ambient, not structural</b>Soft light stays behind all content.</div>
            </div>
          </div>
        </section>

        <div className="bg-rule" />

        <section>
          <div className="bg-section-head">
            <span className="bg-num">02 / ACTIVITY</span>
            <h2 className="bg-h2">The room has a pulse</h2>
            <span className="bg-sub">Energy responds to real activity</span>
          </div>
          <div className="bg-activity">
            <div className="bg-panel bg-chart">
              <svg viewBox="0 0 490 170" role="img" aria-label="Joins, messages and reactions feed room energy. Activity makes the visuals livelier; quiet time lets them settle.">
                <g fontFamily="Barlow, sans-serif" fontSize="13" textAnchor="middle">
                  {["Joins", "Messages", "Reactions"].map((label, index) => (
                    <g key={label}>
                      <rect x={8 + index * 170} y="8" width="132" height="36" rx="5" fill="#101625" stroke="#475bca" />
                      <text x={74 + index * 170} y="31" fill="#f2f2ee">{label}</text>
                    </g>
                  ))}
                  <path d="M74 44V61H244M244 44V72M414 44V61H244" fill="none" stroke="#536fff" strokeWidth="1.5" />
                  <rect x="134" y="74" width="220" height="40" rx="5" fill="#172451" stroke="#7188ff" />
                  <text x="244" y="99" fill="#f2f2ee" fontWeight="700">Shared room energy</text>
                  <path d="M188 114V130H112M300 114V130H376" fill="none" stroke="#536fff" strokeWidth="1.5" />
                  <text x="112" y="149" fill="#c6ceff">Activity: livelier visuals</text>
                  <text x="376" y="149" fill="#a4a49e">Quiet: visuals settle</text>
                </g>
              </svg>
              <div className="bg-chart-legend"><span>VISUAL ENERGY</span><span>How activity affects the room</span></div>
            </div>
            <div className="bg-panel bg-activity-notes">
              <div className="bg-note-row"><i className="bg-dot" /><span><strong>Accepted joins</strong> add energy to the room.</span></div>
              <div className="bg-note-row"><i className="bg-dot" /><span><strong>Messages and reactions</strong> lift the atmosphere too.</span></div>
              <div className="bg-note-row"><i className="bg-dot" /><span><strong>Quiet time</strong> lets energy gradually settle again.</span></div>
            </div>
          </div>
        </section>

        <div className="bg-rule" />

        <section>
          <div className="bg-section-head">
            <span className="bg-num">03 / SCENES</span>
            <h2 className="bg-h2">A gentle 45-second cycle</h2>
            <span className="bg-sub">Keeps going, even when it’s quiet</span>
          </div>
          <div className="bg-panel bg-cycle">
            <svg className="bg-cycle-svg" viewBox="0 0 920 160" role="img" aria-label="The ambient scene loops from Drift through Bloom and Aurora back to Drift, changing every 45 seconds">
              <defs>
                <linearGradient id="cycleGlow" x1="0" x2="1"><stop stopColor="#3b5bff" stopOpacity=".05" /><stop offset=".5" stopColor="#6f7cff" stopOpacity=".3" /><stop offset="1" stopColor="#916cff" stopOpacity=".06" /></linearGradient>
                <marker id="cycleArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="#7188ff" strokeWidth="1.2" /></marker>
              </defs>
              <path d="M82 80 C205 18 309 18 430 80 S656 142 840 80" fill="none" stroke="url(#cycleGlow)" strokeWidth="22" />
              <path d="M82 80 C205 18 309 18 430 80 S656 142 840 80" fill="none" stroke="#475bca" strokeWidth="1.5" strokeDasharray="5 7" markerEnd="url(#cycleArrow)" />
              <g fontFamily="Barlow, sans-serif" textAnchor="middle">
                <g transform="translate(95 80)">
                  <circle r="33" fill="#101625" stroke="#5668ce" />
                  <path d="M-18 6c9-16 18 16 36 0M-18 12c9-16 18 16 36 0" fill="none" stroke="#8094ff" strokeWidth="2" />
                  <text y="58" fill="#f2f2ee" fontSize="14" fontWeight="700">DRIFT</text>
                  <text y="74" fill="#9b9b96" fontSize="10">Rising lights</text>
                </g>
                <g transform="translate(380 80)">
                  <circle r="33" fill="#161429" stroke="#7c66d7" />
                  <circle r="17" fill="none" stroke="#b4a4ff" strokeWidth="1.4" /><circle r="10" fill="none" stroke="#8b78ea" strokeWidth="1.4" /><circle r="3" fill="#dad0ff" />
                  <text y="58" fill="#f2f2ee" fontSize="14" fontWeight="700">BLOOM</text>
                  <text y="74" fill="#9b9b96" fontSize="10">Expanding glows</text>
                </g>
                <g transform="translate(665 80)">
                  <circle r="33" fill="#111a2b" stroke="#4f78b9" />
                  <path d="M-23-7c9-11 16 11 25 0s16 11 22 0M-23 2c9-11 16 11 25 0s16 11 22 0M-23 11c9-11 16 11 25 0s16 11 22 0" fill="none" stroke="#7ac5ef" strokeWidth="1.5" />
                  <text y="58" fill="#f2f2ee" fontSize="14" fontWeight="700">AURORA</text>
                  <text y="74" fill="#9b9b96" fontSize="10">Soft waves</text>
                </g>
                <g transform="translate(848 80)">
                  <circle r="16" fill="#101625" stroke="#5668ce" />
                  <path d="M-8 3c4-7 8 7 16 0" fill="none" stroke="#8094ff" strokeWidth="1.5" />
                  <text y="58" fill="#f2f2ee" fontSize="12" fontWeight="700">DRIFT</text>
                </g>
              </g>
              <g fill="#8da1ff" fontFamily="Barlow, sans-serif" fontSize="10" fontWeight="700" letterSpacing="1">
                <text x="191" y="42">45 SEC</text><text x="489" y="42">45 SEC</text><text x="747" y="42">45 SEC</text>
              </g>
            </svg>
            <div className="bg-cycle-foot"><span><strong>Drift → Bloom → Aurora → Drift</strong></span><span>A new scene every 45 seconds, whether the room is busy or still.</span></div>
          </div>
          <div className="bg-shared">
            <div className="bg-shared-mark">
              <svg width="27" height="27" viewBox="0 0 27 27" aria-hidden="true"><circle cx="9" cy="9" r="4" fill="#8094ff" /><circle cx="18" cy="9" r="4" fill="#596dce" /><path d="M2 22c.4-5 2.7-7 7-7s6.6 2 7 7M11 22c.4-5 2.7-7 7-7s6.6 2 7 7" fill="none" stroke="#8094ff" strokeWidth="1.4" /></svg>
            </div>
            <div className="bg-shared-text"><b>One Beam, one shared scene.</b> Everyone in the same Beam sees the same atmosphere; other Beams have their own.</div>
          </div>
          <div className="bg-caveat">
            <div className="bg-caveat-item"><b>Emoji color has its own timing</b>Supported emojis in sent messages or reactions trigger bursts. The dominant emoji color is chosen every <strong>3 minutes</strong>—not every 45 seconds.</div>
            <div className="bg-caveat-item"><b>Reduced motion</b>Visual intensity stays steady and the artwork remains static.</div>
            <div className="bg-caveat-item"><b>Automatic events are visual only</b>No automatic games, prompts or audio. Microphones still require consent.</div>
            <div className="bg-caveat-item"><b>Already in the app</b>People & discovery, plus credits, gifts and rewards.</div>
          </div>
        </section>

        <footer className="bg-footer">
          <span><strong>Streamtalk / BEAM</strong> &nbsp; A quick visual guide to what’s here now.</span>
          <span>LAYOUT · ACTIVITY · SHARED SCENES</span>
        </footer>
      </div>
    </div>
  );
}

export default BeamVisualGuide;
