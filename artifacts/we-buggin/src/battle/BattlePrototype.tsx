import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Phaser from "phaser";
import { Link, useLocation, useSearch } from "wouter";
import { useUser } from "@clerk/react";
import { AlertTriangle, Flame, Shield, ShieldCheck } from "lucide-react";
import { cityBySlug } from "./aethelgard-cities";
import { cardHomeCity } from "./race-home-cities";
import { BattleBoardScene, type BoardView } from "./BattleBoardScene";
import { BOSS_MOVE_CONFIG } from "./boss-config";
import { photoSrc } from "@/components/user-photo";
import { loadCreds } from "@/lib/room-creds";
import {
  activeCharacter,
  applySkill,
  applySwap,
  botTurn,
  createBattleState,
  createRoomBattleState,
  skipScaredTurn,
  validSkillTarget,
  type BattleCharacter,
  type BattleSide,
  type BattleState,
  type Cell,
  type RoomBattlePlayer,
  type SkillTarget,
  ROOM_BOSS_POOL,
} from "./battle-engine";
import "./battle.css";

type TargetMode = "board" | "ally" | "enemy" | null;

const skillMode = (character: BattleCharacter): TargetMode =>
  character.skill === "blast" ? "board" : character.skill === "strike" ? "enemy" : "ally";

function skillSummary(character: BattleCharacter): string {
  if (character.skill === "heal") return "Heals ally · max 20";
  if (character.skill === "guard") return "Shields healer";
  if (character.skill === "strike") return "Enemy hit · 20";
  if (character.skill === "blast") return "Blast all · 8 dmg";
  return character.skillName;
}

function readableBattleName(name: string): string {
  return name.normalize("NFC").replace(/[\u0000-\u001f\u007f\ufffd]/g, "").trim() || "Player";
}

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
  const displayName = readableBattleName(character.name);
  const alive = character.hp > 0;
  const skillReady = isHumanTurn && active && alive && character.effects.scaredTurns <= 0 && character.mana >= character.skillCost;
  const canActivateSkill = skillReady && character.skill !== "strike";
  const hpRatio = Math.max(0, character.hp / character.maxHp);
  const manaRatio = Math.min(1, character.mana / character.skillCost);
  const homeCity = cardHomeCity(character);
  const cardClass = [
    "battle-card",
    active ? "is-active" : "",
    targetable ? "is-targetable" : "",
    !alive ? "is-dead" : "",
    character.bossId ? "is-boss" : "",
    character.bossId && character.name.length > 12 ? "has-long-boss-name" : "",
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
          <span className={`battle-home-city${homeCity ? " has-city" : ""}`}
            aria-label={homeCity ? `Home city: ${homeCity.name}` : "Home city not set"}
            title={homeCity?.name ?? "Home city not set"}>
            {homeCity && <img src={`${import.meta.env.BASE_URL}${homeCity.image}`} alt="" />}
          </span>
          <span className="battle-portrait" aria-hidden="true">
            {character.photoUrl
              ? <img src={photoSrc(character.photoUrl)} alt="" />
              : character.portrait
                ? <img src={`${import.meta.env.BASE_URL}${character.portrait}`} alt="" />
                : displayName.slice(0, 1)}
          </span>
          {character.bossId && <>
            <span className="battle-job-mark" aria-hidden="true">B</span>
            <span className="battle-side-mark" aria-hidden="true">B</span>
          </>}
          {character.bossId ? (
            <>
              <span className="battle-card-name">{character.name}</span>
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
            </>
          ) : (
            <>
              <span className="battle-current-mana" style={{ "--mana-fill": `${manaRatio * 100}%` } as CSSProperties}
                aria-label={`${character.mana} mana; matching ${character.manaGem} gems charge ${displayName}`}>
                {character.mana}
              </span>
              <span className="battle-skill-cost" aria-label={`${character.skillCost} mana skill cost`}>{character.skillCost}</span>
              <div className="battle-health-box" aria-label={`${character.hp} of ${character.maxHp} health`}>
                <i style={{ width: `${hpRatio * 100}%` }} />
                <b>{character.hp}</b>
              </div>
              <button type="button" className={`battle-info-slot battle-info-slot-top${canActivateSkill ? " is-actionable" : ""}`}
                style={{ "--name-font-size": `${Math.max(4.5, Math.min(7, 96 / Math.max(1, displayName.length)))}px` } as CSSProperties}
                disabled={!canActivateSkill}
                aria-label={canActivateSkill ? `Choose a target for ${character.skillName}` : `${displayName}. ${skillSummary(character)}`}
                onClick={() => onActivateSkill(character)}>
                <strong>{displayName}</strong>
                <span>{skillSummary(character)}</span>
              </button>
              <div className="battle-info-slot battle-info-slot-bottom">
                <strong>{character.race ?? "Human"}</strong>
                <span>{character.job}</span>
              </div>
            </>
          )}
          {(character.effects.immuneTurns > 0 || character.effects.burnTurns > 0 || character.effects.scaredTurns > 0 || character.effects.armoredTurns > 0) && (
            <div className="battle-card-effects" aria-label="Active effects">
              {character.effects.immuneTurns > 0 && (
                <span className="battle-effect is-immune" data-testid={`effect-immune-${character.id}`}>
                  <ShieldCheck size={8} aria-hidden="true" /> IMMUNE {character.effects.immuneTurns}
                </span>
              )}
              {character.effects.armoredTurns > 0 && (
                <span className="battle-effect is-armored" data-testid={`effect-armor-${character.id}`}>
                  <Shield size={8} aria-hidden="true" /> SHELL {character.effects.armoredTurns}
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
          {alive && <span
            className={`battle-skill-orb${character.mana >= character.skillCost ? " is-charged" : ""}`}
            role="img"
          aria-label={character.mana >= character.skillCost ? `${character.skillName} ready` : `${character.mana} of ${character.skillCost} mana`}
            title={character.mana >= character.skillCost ? `${character.skillName} ready` : `${character.mana}/${character.skillCost} mana`}
            data-testid={`battle-skill-${character.id}`}
          />}
        </div>
        <div className="battle-card-back">
          {defeatedIcon()}
          <strong>DEFEATED</strong>
          <span>{displayName}</span>
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
        <span>{living}/{characters.length} standing</span>
      </div>
      <div className="battle-team-cards" style={{ "--team-size": characters.length } as CSSProperties}>
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
  return state ? {
    board: state.board,
    selected,
    targetMode: targetMode === "board" ? "board" : null,
    lockedGems: state.lockedGems,
  } : null;
}

export function BattlePrototype({ roomIdOverride, onExit }: { roomIdOverride?: string; onExit?: () => void } = {}) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const roomId = roomIdOverride ?? params.get("room");
  const { user, isLoaded } = useUser();
  const [, navigate] = useLocation();
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
  const [battle, setBattle] = useState<BattleState | null>(() => roomId ? null : createBattleState(Math.random, city?.slug));
  const battleRef = useRef<BattleState | null>(null);
  const versionRef = useRef(0);
  const credsRef = useRef<ReturnType<typeof loadCreds>>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const canActRef = useRef(true);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [targetMode, setTargetMode] = useState<TargetMode>(null);
  const [pendingEnemySkill, setPendingEnemySkill] = useState<{ actorId: string; targetId: string; turnNumber: number } | null>(null);
  const [feedback, setFeedback] = useState("");
  const targetModeRef = useRef<TargetMode>(null);
  const selectedRef = useRef<Cell | null>(null);
  const pendingEnemySkillRef = useRef(pendingEnemySkill);
  const latestView = useRef<BoardView | null>(null);

  const applyRoomSnapshot = useCallback((snapshot: { version: number; state: unknown }) => {
    const nextVersion = Number(snapshot.version);
    if (!Number.isInteger(nextVersion) || nextVersion <= versionRef.current) return;
    versionRef.current = nextVersion;
    setBattle(snapshot.state as BattleState);
    setRoomError(null);
    setFeedback("");
    setSelected(null);
    setTargetMode(null);
  }, []);

  const fetchRoomBattle = useCallback(async () => {
    if (!roomId || !credsRef.current) return;
    const response = await fetch(`/api/account/rooms/${encodeURIComponent(roomId)}/battle`, {
      credentials: "same-origin",
      headers: { "X-Room-Session": credsRef.current.participantSessionId },
    });
    const result = await response.json() as { battle?: { version: number; state: unknown } | null; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Could not sync the room game.");
    if (result.battle) applyRoomSnapshot(result.battle);
    else if (!battleRef.current) setRoomError("The room game has not started yet.");
  }, [roomId, applyRoomSnapshot]);

  const commitRoomBattle = useCallback(async (next: BattleState) => {
    if (!roomId || !credsRef.current) return;
    const response = await fetch(`/api/account/rooms/${encodeURIComponent(roomId)}/battle/action`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Room-Session": credsRef.current.participantSessionId,
      },
      body: JSON.stringify({ version: versionRef.current, state: next }),
    });
    const result = await response.json() as { battle?: { version: number; state: unknown }; error?: string };
    if (response.status === 409) {
      await fetchRoomBattle();
      return;
    }
    if (!response.ok || !result.battle) throw new Error(result.error ?? "Could not sync that turn.");
    applyRoomSnapshot(result.battle);
    setRoomError(null);
  }, [roomId, fetchRoomBattle, applyRoomSnapshot]);

  useEffect(() => {
    if (!roomId || !isLoaded) return;
    if (!user?.id) {
      setRoomError("Sign in to join this room game.");
      return;
    }
    const creds = loadCreds(user.id, roomId);
    credsRef.current = creds;
    if (!creds) {
      setRoomError("Return to the room and take a seat before opening its game.");
      return;
    }
    let active = true;
    const sync = () => {
      if (active) void fetchRoomBattle().catch(error => {
        if (active) setRoomError(error instanceof Error ? error.message : "Could not sync the room game.");
      });
    };
    sync();
    const poll = window.setInterval(sync, 1000);
    const heartbeat = window.setInterval(() => {
      void fetch(`/api/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(creds.participantSessionId)}/heartbeat`, {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => undefined);
    }, 25_000);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(heartbeat);
      credsRef.current = null;
    };
  }, [roomId, isLoaded, user?.id, fetchRoomBattle]);

  battleRef.current = battle;
  targetModeRef.current = targetMode;
  selectedRef.current = selected;
  pendingEnemySkillRef.current = pendingEnemySkill;
  latestView.current = battleBoardView(battle, selected, targetMode);
  const activeHuman = battle ? battle.teams.humans[battle.activeIndex.humans] : undefined;
  const canHumanAct = !roomId || (!!user?.id && !!credsRef.current?.participantId
    && activeHuman?.participantId === credsRef.current.participantId);
  canActRef.current = canHumanAct;

  const acceptNextState = useCallback((next: BattleState) => {
    if (roomId) void commitRoomBattle(next).catch(error => {
      setRoomError(error instanceof Error ? error.message : "Could not sync that turn.");
    });
    else setBattle(next);
  }, [roomId, commitRoomBattle]);

  const cellTapRef = useRef<(cell: Cell) => void>(() => undefined);
  const chooseCell = useCallback((cell: Cell) => {
    const current = battleRef.current;
    if (!current || pendingEnemySkillRef.current || !canActRef.current || current.turnSide !== "humans" || current.outcome) return;
    if (targetModeRef.current === "board") {
      const result = applySkill(current, { kind: "cell", ...cell });
      if (result.accepted) {
        acceptNextState(result.state);
        setTargetMode(null);
        setSelected(null);
        setFeedback("");
      }
      return;
    }
    if (targetModeRef.current) return;
    if (current.lockedGems.some((locked) => locked.row === cell.row && locked.col === cell.col)) {
      setSelected(null);
      setFeedback(`Vines hold that gem for ${current.vinesTurns} more turns.`);
      return;
    }
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
      acceptNextState(result.state);
      setFeedback("");
    } else {
      setFeedback("That swap does not make a match. Choose another adjacent gem pair.");
    }
  }, [acceptNextState]);
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
    const resizeBoard = () => {
      const host = boardHost.current;
      if (!host || host.clientWidth <= 0 || host.clientHeight <= 0) return;
      game.scale.refresh();
      if (scene.ready && latestView.current) scene.setView(latestView.current);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resizeBoard);
    resizeObserver?.observe(boardHost.current);
    window.addEventListener("resize", resizeBoard);
    let frame = 0;
    const syncView = () => {
      const host = boardHost.current;
      if (scene.ready && latestView.current && host && host.clientWidth > 0 && host.clientHeight > 0) {
        game.scale.refresh();
        scene.setView(latestView.current);
      }
      else frame = requestAnimationFrame(syncView);
    };
    frame = requestAnimationFrame(syncView);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resizeBoard);
      game.destroy(true);
      sceneRef.current = null;
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (battle && battle.turnSide !== "humans") {
      setTargetMode(null);
      setPendingEnemySkill(null);
    }
    if (pendingEnemySkill && pendingEnemySkill.turnNumber !== battle?.turnNumber) setPendingEnemySkill(null);
  }, [battle?.turnNumber, battle?.turnSide, targetMode, pendingEnemySkill]);

  useEffect(() => {
    const view = battleBoardView(battle, selected, targetMode);
    if (view) sceneRef.current?.setView(view);
  }, [battle, selected, targetMode]);

  useEffect(() => {
    if (!battle || battle.turnSide !== "bots" || battle.outcome) return;
    const timer = window.setTimeout(() => {
      const current = battleRef.current;
      if (!current) return;
      acceptNextState(botTurn(current));
      setFeedback("");
    }, 720);
    return () => window.clearTimeout(timer);
  }, [battle?.turnNumber, battle?.turnSide, battle?.outcome, acceptNextState]);

  useEffect(() => {
    if (!battle || battle.turnSide !== "humans" || battle.outcome || !canHumanAct) return;
    const activeHuman = activeCharacter(battle, "humans");
    if (activeHuman.effects.scaredTurns <= 0) return;
    const timer = window.setTimeout(() => {
      const current = battleRef.current;
      if (current) acceptNextState(skipScaredTurn(current));
      setFeedback("");
    }, 650);
    return () => window.clearTimeout(timer);
  }, [battle?.turnNumber, battle?.turnSide, battle?.activeIndex.humans, battle?.outcome, canHumanAct, acceptNextState]);

  const chooseSkillTarget = useCallback((id: string) => {
    const current = battleRef.current;
    if (!current || !canActRef.current || current.turnSide !== "humans" || !validSkillTarget(current, { kind: "character", id })) return;
    const actor = activeCharacter(current, "humans");
    if (actor.skill === "strike" && actor.mana >= actor.skillCost) {
      setPendingEnemySkill({ actorId: actor.id, targetId: id, turnNumber: current.turnNumber });
      setTargetMode(null);
      setFeedback("");
      return;
    }
    if (!targetModeRef.current) return;
    const result = applySkill(current, { kind: "character", id });
    if (result.accepted) {
      acceptNextState(result.state);
      setTargetMode(null);
      setSelected(null);
      setFeedback("");
    }
  }, [acceptNextState]);

  const confirmEnemySkill = useCallback(() => {
    const current = battleRef.current;
    const pending = pendingEnemySkillRef.current;
    if (!current || !pending || !canActRef.current || current.turnSide !== "humans"
      || current.turnNumber !== pending.turnNumber
      || activeCharacter(current, "humans").id !== pending.actorId
      || !validSkillTarget(current, { kind: "character", id: pending.targetId })) {
      setPendingEnemySkill(null);
      return;
    }
    const result = applySkill(current, { kind: "character", id: pending.targetId });
    if (result.accepted) {
      acceptNextState(result.state);
      setPendingEnemySkill(null);
      setSelected(null);
      setFeedback("");
    }
  }, [acceptNextState]);

  const activateSkill = useCallback((character: BattleCharacter) => {
    if (!canActRef.current || character.hp <= 0 || character.mana < character.skillCost) return;
    if (character.skill === "strike") return;
    setSelected(null);
    setTargetMode(skillMode(character));
    setFeedback(character.skill === "blast"
      ? "Tap any board gem to choose Blast’s center."
      : character.skill === "guard"
        ? "Tap your healer’s card. The Squire will intercept their next incoming hit."
        : `Tap an injured ally card to use ${character.skillName}.`);
  }, []);

  const restart = useCallback(() => {
    if (roomId) {
      if (onExit) onExit();
      else navigate(`/rooms/${encodeURIComponent(roomId)}`);
      return;
    }
    setBattle(createBattleState(Math.random, city?.slug));
    setSelected(null);
    setTargetMode(null);
    setFeedback("");
  }, [roomId, navigate, onExit, city?.slug]);

  if (!battle) {
    return <main className="battle-prototype">
      <div className="battle-loading" role="status">
        {roomError ?? "Syncing room game…"}
        {roomError && roomId && <Link className="battle-result-home" href={`/rooms/${encodeURIComponent(roomId)}`}>Return to room</Link>}
      </div>
    </main>;
  }

  const active = activeCharacter(battle);
  const activeSkillReady = battle.turnSide === "humans" && canHumanAct && !battle.outcome
    && active.hp > 0 && active.effects.scaredTurns <= 0 && active.mana >= active.skillCost;
  const automaticTargetMode = activeSkillReady && active.skill === "strike" ? "enemy" : null;
  const currentTargetMode = targetMode ?? automaticTargetMode;
  const targetIds = currentTargetMode === "enemy" || currentTargetMode === "ally"
    ? [...battle.teams.humans, ...battle.teams.bots]
      .filter((character) => validSkillTarget(battle, { kind: "character", id: character.id }))
      .map((character) => character.id)
    : [];
  const turnText = battle.outcome
    ? battle.outcome === "victory" ? "Victory" : "Defeat"
    : battle.turnSide === "humans" && active.effects.scaredTurns > 0
    ? `${readableBattleName(active.name)} is scared · turn lost`
    : battle.turnSide === "humans" && roomId && activeHuman?.participantId !== credsRef.current?.participantId
      ? `${readableBattleName(active.name)}'s turn`
    : battle.turnSide === "humans"
      ? `Your turn · ${readableBattleName(active.name)} · ${active.job}`
      : `Bots’ turn · ${readableBattleName(active.name)} · ${active.job}`;

  return (
    <main className="battle-prototype" style={cityBackdrop} data-city={city?.slug} data-testid="battle-prototype">
      <div className="battle-shell">
        <header className="battle-header">
          {roomId && onExit
            ? <button type="button" className="battle-back" onClick={onExit}>← Room</button>
            : <Link href={roomId ? `/rooms/${encodeURIComponent(roomId)}` : "/"} className="battle-back">{roomId ? "← Room" : "← Home"}</Link>}
          <div className="battle-title"><strong>{roomId ? "ROOM BATTLE" : "LOCAL BATTLE"}</strong><span>{roomId ? `${battle.teams.humans.length} vs ${battle.teams.bots.length} · Co-op` : `${city ? `${city.name} · ` : ''}4 vs 4 · Prototype`}</span></div>
          <button type="button" className="battle-reset" onClick={restart} data-testid="battle-restart-top">{roomId ? "Room" : "Restart"}</button>
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

        <section className={`battle-board-wrap${targetMode === "board" ? " is-targeting" : ""}`} aria-label={`Match-three game board${battle.lockedGems.length ? `, ${battle.lockedGems.length} gems held by vines for ${battle.vinesTurns} more turns` : ""}`}>
          <div className="battle-board" ref={boardHost} />
          {battle.turnSide === "bots" && <div className="battle-bot-thinking" aria-hidden="true">BOT TURN</div>}
        </section>

        <TeamRow
          side="humans"
          characters={battle.teams.humans}
          active={activeCharacter(battle, "humans")}
          isHumanTurn={battle.turnSide === "humans" && !battle.outcome && canHumanAct && !targetMode}
          targetIds={targetIds}
          onChooseTarget={chooseSkillTarget}
          onActivateSkill={activateSkill}
        />

        <div className="battle-footer">
          <p className="battle-instructions">
            {roomError || feedback || (activeSkillReady && active.skill === "strike"
              ? `Skill ready: tap an opponent card to use ${active.skillName}.`
              : roomId && !canHumanAct && battle.turnSide === "humans"
                ? "Waiting for the seated player to make their move."
                : "Tap two adjacent gems to swap. Match 3 to charge a job; match 4 swords to strike the opposing leader.")}
          </p>
          <p className="battle-log" aria-live="polite">{battle.log[0]}</p>
        </div>

        {pendingEnemySkill && (() => {
          const target = [...battle.teams.humans, ...battle.teams.bots].find(character => character.id === pendingEnemySkill.targetId);
          const actor = battle.teams.humans.find(character => character.id === pendingEnemySkill.actorId);
          return target && actor ? (
            <section className="battle-skill-confirm" role="dialog" aria-modal="true" aria-label="Confirm skill target">
              <strong>{actor.skillName}</strong>
              <span>Use this skill on {readableBattleName(target.name)}?</span>
              <div>
                <button type="button" className="battle-result-restart" onClick={confirmEnemySkill}>Use Skill</button>
                <button type="button" className="battle-result-home" onClick={() => setPendingEnemySkill(null)}>Cancel</button>
              </div>
            </section>
          ) : null;
        })()}
      </div>

      {battle.flashId > 0 && (
        <div
          key={battle.flashId}
          className="battle-flash"
          style={{ "--flash-duration": `${BOSS_MOVE_CONFIG.fallenSeraphFlashDurationMs}ms` } as CSSProperties}
          aria-hidden="true"
        />
      )}

      {battle.outcome && (
        <div className="battle-result-backdrop">
          <section className="battle-result" role="dialog" aria-modal="true" aria-labelledby="battle-result-title">
            <span className="battle-result-kicker">LOCAL BATTLE COMPLETE</span>
            <h1 id="battle-result-title">{battle.outcome === "victory" ? "Victory" : "Defeat"}</h1>
            <p>{battle.outcome === "victory" ? "The opposing team has fallen." : "Your team has fallen."}</p>
            <button type="button" className="battle-result-restart" onClick={restart} data-testid="battle-restart-result">{roomId ? "Return to room" : "Play again"}</button>
            {!roomId && <Link href="/" className="battle-result-home">Return home</Link>}
          </section>
        </div>
      )}
    </main>
  );
}
