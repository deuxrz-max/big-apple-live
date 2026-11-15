import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Phaser from "phaser";
import { Link, useSearch } from "wouter";
import { AlertTriangle, Flame, ShieldCheck } from "lucide-react";
import { cityBySlug } from "./aethelgard-cities";
import { BattleBoardScene, type BoardView } from "./BattleBoardScene";
import {
  activeCharacter,
  applySkill,
  applySwap,
  botTurn,
  createBattleState,
  skipScaredTurn,
  validSkillTarget,
  type BattleCharacter,
  type BattleSide,
  type BattleState,
  type Cell,
  type SkillTarget,
} from "./battle-engine";
import "./battle.css";

type TargetMode = "board" | "ally" | "enemy" | null;

const skillMode = (character: BattleCharacter): TargetMode =>
  character.skill === "blast" ? "board" : character.skill === "strike" ? "enemy" : "ally";

function defeatedIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="26" r="19" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle cx="25" cy="25" r="2.5" fill="currentColor" />
      <circle cx="39" cy="25" r="2.5" fill="currentColor" />
      <path d="M24 37h16M17 51l30-30M47 51 17 21" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function BattleCard({
  character,
  active,
  isHumanTurn,
  targetable,
  onChooseTarget,
  onActivateSkill,
}: {
  character: BattleCharacter;
  active: boolean;
  isHumanTurn: boolean;
  targetable: boolean;
  onChooseTarget: (id: string) => void;
  onActivateSkill: (character: BattleCharacter) => void;
}) {
  const alive = character.hp > 0;
  const canUseSkill = isHumanTurn && active && alive && character.effects.scaredTurns <= 0 && character.mana >= character.skillCost;
  const hpRatio = Math.max(0, character.hp / character.maxHp);
  const manaRatio = Math.min(1, character.mana / character.skillCost);
  const cardClass = [
    "battle-card",
    active ? "is-active" : "",
    targetable ? "is-targetable" : "",
    !alive ? "is-dead" : "",
    character.bossId ? "is-boss" : "",
    character.effects.immuneTurns > 0 ? "is-immune" : "",
  ].filter(Boolean).join(" ");

  return (
    <article
      className={cardClass}
      style={{ "--mana-color": manaColor(character.manaGem) } as CSSProperties}
      data-testid={`battle-character-${character.id}`}
    >
      <div className="battle-card-inner">
        <div className="battle-card-front">
          <img className="battle-card-art" src={`${import.meta.env.BASE_URL}battle-assets/cards/card_frame_grey_starter.jpg`} alt="" />
          <span className="battle-level">{character.level}</span>
          <span className="battle-portrait" aria-hidden="true">
            {character.portrait
              ? <img src={`${import.meta.env.BASE_URL}${character.portrait}`} alt="" />
              : character.name.slice(0, 1)}
          </span>
          <span className="battle-job-mark" aria-hidden="true">{character.bossId ? "B" : character.job.slice(0, 1)}</span>
          <span className="battle-side-mark" aria-hidden="true">{character.bossId ? "B" : "H"}</span>
          <span className="battle-card-name">{character.name}</span>
          {character.bossId ? (
            <div className="battle-boss-fields" aria-label={`${character.hp} of ${character.maxHp} health, ${character.mana} of ${character.skillCost} mana`}>
              <span className="battle-boss-field" title={`${character.cityOfOrigin} · HP ${character.hp}/${character.maxHp}`}>
                <span>{character.cityOfOrigin}</span>
                <i className="is-health" style={{ width: `${hpRatio * 100}%` }} />
              </span>
              <span className="battle-boss-field" title={`Boss · Mana ${character.mana}/${character.skillCost}`}>
                <span>Boss</span>
                <i className="is-mana" style={{ width: `${manaRatio * 100}%` }} />
              </span>
            </div>
          ) : (
            <>
              <span className="battle-card-job">{character.job}</span>
              <div className="battle-card-bars" aria-label={`${character.hp} of ${character.maxHp} health, ${character.mana} of ${character.skillCost} mana`}>
                <span className="battle-stat-track"><i style={{ width: `${hpRatio * 100}%` }} /><b>HP {character.hp}</b></span>
                <span className="battle-stat-track mana"><i style={{ width: `${manaRatio * 100}%` }} /><b>{character.mana}/{character.skillCost}</b></span>
              </div>
            </>
          )}
          {(character.effects.immuneTurns > 0 || character.effects.burnTurns > 0 || character.effects.scaredTurns > 0) && (
            <div className="battle-card-effects" aria-label="Active effects">
              {character.effects.immuneTurns > 0 && (
                <span className="battle-effect is-immune" data-testid={`effect-immune-${character.id}`}>
                  <ShieldCheck size={8} aria-hidden="true" /> IMMUNE {character.effects.immuneTurns}
                </span>
              )}
              {character.effects.burnTurns > 0 && (
                <span className="battle-effect is-burning" data-testid={`effect-burn-${character.id}`}>
                  <Flame size={8} aria-hidden="true" /> BURN {character.effects.burnTurns}
                </span>
              )}
              {character.effects.scaredTurns > 0 && (
                <span className="battle-effect is-scared" data-testid={`effect-scared-${character.id}`}>
                  <AlertTriangle size={8} aria-hidden="true" /> SCARED
                </span>
              )}
            </div>
          )}
          {targetable && (
            <button
              type="button"
              className="battle-card-target"
              aria-label={`Target ${character.name}`}
              onClick={() => onChooseTarget(character.id)}
            />
          )}
          {alive && (
            <button
              type="button"
              className={`battle-skill-orb${character.mana >= character.skillCost ? " is-charged" : ""}`}
              disabled={!canUseSkill}
              aria-label={`Use ${character.skillName}`}
              title={`${character.skillName} — tap to choose a target`}
              data-testid={`battle-skill-${character.id}`}
              onClick={(event) => {
                event.stopPropagation();
                onActivateSkill(character);
              }}
            />
          )}
        </div>
        <div className="battle-card-back">
          {defeatedIcon()}
          <strong>DEFEATED</strong>
          <span>{character.name}</span>
        </div>
      </div>
    </article>
  );
}

function manaColor(gem: string) {
  const colors: Record<string, string> = {
    red: "#ed4d50",
    blue: "#51a9ff",
    green: "#59d68d",
    yellow: "#ffd15b",
    silver: "#d3e3ee",
    brown: "#c79968",
    orange: "#ff9d4d",
  };
  return colors[gem] ?? "#d4b15f";
}

function TeamRow({
  side,
  characters,
  active,
  isHumanTurn,
  targetIds,
  onChooseTarget,
  onActivateSkill,
}: {
  side: BattleSide;
  characters: BattleCharacter[];
  active: BattleCharacter;
  isHumanTurn: boolean;
  targetIds: string[];
  onChooseTarget: (id: string) => void;
  onActivateSkill: (character: BattleCharacter) => void;
}) {
  const label = side === "humans" ? "YOUR TEAM · HUMANS" : "OPPONENT · BOTS";
  const living = characters.filter((character) => character.hp > 0).length;
  return (
    <section className={`battle-team battle-team-${side}`} aria-label={label}>
      <div className="battle-team-heading">
        <strong>{label}</strong>
        <span>{living}/4 standing</span>
      </div>
      <div className="battle-team-cards">
        {characters.map((character) => (
          <BattleCard
            key={character.id}
            character={character}
            active={active.id === character.id && character.hp > 0}
            isHumanTurn={isHumanTurn}
            targetable={targetIds.includes(character.id)}
            onChooseTarget={onChooseTarget}
            onActivateSkill={onActivateSkill}
          />
        ))}
      </div>
    </section>
  );
}

function battleBoardView(state: BattleState | null, selected: Cell | null, targetMode: TargetMode): BoardView | null {
  return state ? { board: state.board, selected, targetMode: targetMode === "board" ? "board" : null } : null;
}

export function BattlePrototype() {
  const search = useSearch();
  const city = cityBySlug(new URLSearchParams(search).get("city") ?? undefined);
  const cityBackdrop: CSSProperties | undefined = city ? {
    backgroundImage: `linear-gradient(rgba(0,0,0,.77),rgba(0,0,0,.84)),url("${import.meta.env.BASE_URL}${city.image}")`,
    backgroundPosition: "center",
    backgroundSize: "cover",
    backgroundRepeat: "no-repeat",
  } : undefined;
  const boardHost = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BattleBoardScene | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [battle, setBattle] = useState<BattleState | null>(() => createBattleState(Math.random, city?.slug));
  const battleRef = useRef<BattleState | null>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [targetMode, setTargetMode] = useState<TargetMode>(null);
  const [feedback, setFeedback] = useState("");
  const targetModeRef = useRef<TargetMode>(null);
  const selectedRef = useRef<Cell | null>(null);
  const latestView = useRef<BoardView | null>(null);

  battleRef.current = battle;
  targetModeRef.current = targetMode;
  selectedRef.current = selected;
  latestView.current = battleBoardView(battle, selected, targetMode);

  const cellTapRef = useRef<(cell: Cell) => void>(() => undefined);
  const chooseCell = useCallback((cell: Cell) => {
    const current = battleRef.current;
    if (!current || current.turnSide !== "humans" || current.outcome) return;
    if (targetModeRef.current === "board") {
      const result = applySkill(current, { kind: "cell", ...cell });
      if (result.accepted) {
        setBattle(result.state);
        setTargetMode(null);
        setSelected(null);
        setFeedback("");
      }
      return;
    }
    if (targetModeRef.current) return;
    const first = selectedRef.current;
    if (!first) {
      setSelected(cell);
      return;
    }
    if (first.row === cell.row && first.col === cell.col) {
      setSelected(null);
      return;
    }
    if (Math.abs(first.row - cell.row) + Math.abs(first.col - cell.col) !== 1) {
      setSelected(cell);
      return;
    }
    const result = applySwap(current, first, cell);
    setSelected(null);
    if (result.accepted) {
      setBattle(result.state);
      setFeedback("");
    } else {
      setFeedback("That swap does not make a match. Choose another adjacent gem pair.");
    }
  }, []);
  cellTapRef.current = chooseCell;

  useEffect(() => {
    if (!boardHost.current || gameRef.current) return;
    const scene = new BattleBoardScene((cell) => cellTapRef.current(cell));
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: boardHost.current,
      width: 400,
      height: 400,
      backgroundColor: "#0a0908",
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      render: { antialias: true, roundPixels: true, pixelArt: false },
      audio: { noAudio: true },
      scene: [scene],
    });
    gameRef.current = game;
    const canvas = game.canvas;
    if (canvas) {
      canvas.setAttribute("role", "grid");
      canvas.setAttribute("aria-label", "Eight by eight match-three board. Tap one gem, then an adjacent gem.");
      canvas.setAttribute("tabindex", "0");
      canvas.setAttribute("data-testid", "battle-board-canvas");
    }
    let frame = 0;
    const syncView = () => {
      if (scene.ready && latestView.current) scene.setView(latestView.current);
      else frame = requestAnimationFrame(syncView);
    };
    frame = requestAnimationFrame(syncView);
    return () => {
      cancelAnimationFrame(frame);
      game.destroy(true);
      sceneRef.current = null;
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (battle && targetMode && battle.turnSide !== "humans") setTargetMode(null);
  }, [battle?.turnNumber, battle?.turnSide, targetMode]);

  useEffect(() => {
    const view = battleBoardView(battle, selected, targetMode);
    if (view) sceneRef.current?.setView(view);
  }, [battle, selected, targetMode]);

  useEffect(() => {
    if (!battle || battle.turnSide !== "bots" || battle.outcome) return;
    const timer = window.setTimeout(() => {
      setBattle((current) => current ? botTurn(current) : current);
      setFeedback("");
    }, 720);
    return () => window.clearTimeout(timer);
  }, [battle?.turnNumber, battle?.turnSide, battle?.outcome]);

  useEffect(() => {
    if (!battle || battle.turnSide !== "humans" || battle.outcome) return;
    const activeHuman = activeCharacter(battle, "humans");
    if (activeHuman.effects.scaredTurns <= 0) return;
    const timer = window.setTimeout(() => {
      setBattle((current) => current ? skipScaredTurn(current) : current);
      setFeedback("");
    }, 650);
    return () => window.clearTimeout(timer);
  }, [battle?.turnNumber, battle?.turnSide, battle?.activeIndex.humans, battle?.outcome]);

  const chooseSkillTarget = useCallback((id: string) => {
    const current = battleRef.current;
    if (!current || !targetModeRef.current || !validSkillTarget(current, { kind: "character", id })) return;
    const result = applySkill(current, { kind: "character", id });
    if (result.accepted) {
      setBattle(result.state);
      setTargetMode(null);
      setSelected(null);
      setFeedback("");
    }
  }, []);

  const activateSkill = useCallback((character: BattleCharacter) => {
    if (character.hp <= 0 || character.mana < character.skillCost) return;
    setSelected(null);
    setTargetMode(skillMode(character));
    setFeedback(character.skill === "blast"
      ? "Tap any board gem to choose Blast’s center."
      : character.skill === "guard"
        ? "Tap your healer’s card. The Squire will intercept their next incoming hit."
        : `Tap an ${character.skill === "strike" ? "enemy" : "injured ally"} card to use ${character.skillName}.`);
  }, []);

  const restart = useCallback(() => {
    setBattle(createBattleState(Math.random, city?.slug));
    setSelected(null);
    setTargetMode(null);
    setFeedback("");
  }, [city?.slug]);

  if (!battle) {
    return <main className="battle-prototype"><div className="battle-loading" role="status">Preparing local battle…</div></main>;
  }

  const active = activeCharacter(battle);
  const targetIds = targetMode
    ? [...battle.teams.humans, ...battle.teams.bots]
      .filter((character) => validSkillTarget(battle, { kind: "character", id: character.id }))
      .map((character) => character.id)
    : [];
  const turnText = battle.outcome
    ? battle.outcome === "victory" ? "Victory" : "Defeat"
    : battle.turnSide === "humans" && active.effects.scaredTurns > 0
      ? `${active.name} is scared · turn lost`
    : battle.turnSide === "humans"
      ? `Your turn · ${active.name} · ${active.job}`
      : `Bots’ turn · ${active.name} · ${active.job}`;

  return (
    <main className="battle-prototype" style={cityBackdrop} data-city={city?.slug} data-testid="battle-prototype">
      <div className="battle-shell">
        <header className="battle-header">
          <Link href="/" className="battle-back">← Home</Link>
          <div className="battle-title"><strong>LOCAL BATTLE</strong><span>{city ? `${city.name} · ` : ''}4 vs 4 · Prototype</span></div>
          <button type="button" className="battle-reset" onClick={restart} data-testid="battle-restart-top">Restart</button>
        </header>

        <TeamRow
          side="bots"
          characters={battle.teams.bots}
          active={activeCharacter(battle, "bots")}
          isHumanTurn={false}
          targetIds={targetIds}
          onChooseTarget={chooseSkillTarget}
          onActivateSkill={activateSkill}
        />

        <div className={`battle-turn${battle.turnSide === "bots" ? " is-bot-turn" : ""}`} role="status" aria-live="polite" data-testid="battle-turn">
          <strong>{turnText}</strong>
          {targetMode && <button type="button" onClick={() => { setTargetMode(null); setFeedback(""); }}>Cancel target</button>}
        </div>

        <section className={`battle-board-wrap${targetMode === "board" ? " is-targeting" : ""}`} aria-label="Match-three game board">
          <div className="battle-board" ref={boardHost} />
          {battle.turnSide === "bots" && <div className="battle-bot-thinking" aria-hidden="true">BOT TURN</div>}
        </section>

        <TeamRow
          side="humans"
          characters={battle.teams.humans}
          active={activeCharacter(battle, "humans")}
          isHumanTurn={battle.turnSide === "humans" && !battle.outcome}
          targetIds={targetIds}
          onChooseTarget={chooseSkillTarget}
          onActivateSkill={activateSkill}
        />

        <div className="battle-footer">
          <p className="battle-instructions">
            {feedback || "Tap two adjacent gems to swap. Match 3 to charge a job; match 4 swords to strike the opposing leader."}
          </p>
          <p className="battle-log" aria-live="polite">{battle.log[0]}</p>
        </div>
      </div>

      {battle.outcome && (
        <div className="battle-result-backdrop">
          <section className="battle-result" role="dialog" aria-modal="true" aria-labelledby="battle-result-title">
            <span className="battle-result-kicker">LOCAL BATTLE COMPLETE</span>
            <h1 id="battle-result-title">{battle.outcome === "victory" ? "Victory" : "Defeat"}</h1>
            <p>{battle.outcome === "victory" ? "The opposing team has fallen." : "Your team has fallen."}</p>
            <button type="button" className="battle-result-restart" onClick={restart} data-testid="battle-restart-result">Play again</button>
            <Link href="/" className="battle-result-home">Return home</Link>
          </section>
        </div>
      )}
    </main>
  );
}
