import { BOSS_MOVE_CONFIG, CITY_BOSSES, type BossId } from "./boss-config";

export const ROWS = 8;
export const COLS = 8;

export const GEM_TYPES = [
  "sword",
  "red",
  "blue",
  "green",
  "yellow",
  "silver",
  "brown",
  "orange",
] as const;
export type GemType = (typeof GEM_TYPES)[number];
export type ManaGem = Exclude<GemType, "sword">;
export type BattleSide = "humans" | "bots";
export type SkillKind = "blast" | "guard" | "strike" | "heal" | "boss";
export type SkillTarget = { kind: "cell"; row: number; col: number } | { kind: "character"; id: string };

export interface BattleEffects {
  immuneTurns: number;
  burnTurns: number;
  burnDamagePerTurn: number;
  burnDelayTurns: number;
  scaredTurns: number;
  armoredTurns: number;
}

export interface Cell {
  row: number;
  col: number;
}

export interface BattleCharacter {
  id: string;
  side: BattleSide;
  name: string;
  participantId?: string;
  photoUrl?: string | null;
  job: string;
  manaGem: ManaGem;
  skill: SkillKind;
  skillName: string;
  skillCost: number;
  level: number;
  hp: number;
  maxHp: number;
  mana: number;
  guardedBy: string | null;
  effects: BattleEffects;
  bossId?: BossId;
  portrait?: string;
  cityOfOrigin?: string;
}

export type Board = GemType[][];

export interface BattleState {
  board: Board;
  lockedGems: Cell[];
  vinesTurns: number;
  teams: Record<BattleSide, BattleCharacter[]>;
  activeIndex: Record<BattleSide, number>;
  turnSide: BattleSide;
  turnNumber: number;
  flashId: number;
  outcome: "victory" | "defeat" | null;
  log: string[];
}

export type RoomBattlePlayer = {
  participantId: string;
  name: string;
  photoUrl?: string | null;
  level?: number;
};

export const ROOM_BOSS_POOL: BossId[] = ["vampire", "wolf", "ghost", "zombie", "dragon"];

export interface MatchSummary {
  counts: Record<GemType, number>;
  cascades: number;
  swordStrikes: number;
}

export interface TurnResult {
  accepted: boolean;
  state: BattleState;
}

const MANA_GEMS = GEM_TYPES.filter((type): type is ManaGem => type !== "sword");
const DEFAULTS: Array<{
  job: string;
  manaGem: ManaGem;
  skill: SkillKind;
  skillName: string;
  skillCost: number;
}> = [
  { job: "Apprentice", manaGem: "red", skill: "blast", skillName: "Blast", skillCost: 16 },
  { job: "Squire", manaGem: "yellow", skill: "guard", skillName: "Vanguard’s Resolve", skillCost: 12 },
  { job: "Trapper", manaGem: "green", skill: "strike", skillName: "Strike", skillCost: 15 },
  { job: "Acolyte", manaGem: "blue", skill: "heal", skillName: "Healing Light", skillCost: 12 },
];

function emptyCounts(): Record<GemType, number> {
  return { sword: 0, red: 0, blue: 0, green: 0, yellow: 0, silver: 0, brown: 0, orange: 0 };
}

const otherSide = (side: BattleSide): BattleSide => side === "humans" ? "bots" : "humans";
const cloneBoard = (board: Board): Board => board.map((row) => [...row]);
const cellKey = (row: number, col: number) => `${row}:${col}`;
const isInside = (row: number, col: number) => row >= 0 && row < ROWS && col >= 0 && col < COLS;

function randomGem(random: () => number): GemType {
  return GEM_TYPES[Math.min(GEM_TYPES.length - 1, Math.floor(random() * GEM_TYPES.length))];
}

function emptyEffects(): BattleEffects {
  return { immuneTurns: 0, burnTurns: 0, burnDamagePerTurn: 0, burnDelayTurns: 0, scaredTurns: 0, armoredTurns: 0 };
}

function lockedCellKeys(cells: Cell[]): Set<string> {
  return new Set(cells.map((cell) => cellKey(cell.row, cell.col)));
}

export function findMatches(board: Board, lockedGems: Cell[] = []): Array<{ type: GemType; cells: Cell[] }> {
  const locked = lockedCellKeys(lockedGems);
  const grouped = new Map<GemType, Map<string, Cell>>();
  const addRun = (type: GemType, cells: Cell[]) => {
    if (!grouped.has(type)) grouped.set(type, new Map());
    const byCell = grouped.get(type)!;
    for (const cell of cells) byCell.set(cellKey(cell.row, cell.col), cell);
  };

  for (let row = 0; row < ROWS; row += 1) {
    let start = 0;
    while (start < COLS) {
      const type = locked.has(cellKey(row, start)) ? null : board[row]?.[start];
      let end = start + 1;
      while (type && end < COLS && !locked.has(cellKey(row, end)) && board[row]?.[end] === type) end += 1;
      if (type && end - start >= 3) {
        addRun(type, Array.from({ length: end - start }, (_, offset) => ({ row, col: start + offset })));
      }
      start = end;
    }
  }

  for (let col = 0; col < COLS; col += 1) {
    let start = 0;
    while (start < ROWS) {
      const type = locked.has(cellKey(start, col)) ? null : board[start]?.[col];
      let end = start + 1;
      while (type && end < ROWS && !locked.has(cellKey(end, col)) && board[end]?.[col] === type) end += 1;
      if (type && end - start >= 3) {
        addRun(type, Array.from({ length: end - start }, (_, offset) => ({ row: start + offset, col })));
      }
      start = end;
    }
  }

  return [...grouped.entries()].map(([type, cells]) => ({ type, cells: [...cells.values()] }));
}

export function findLegalSwaps(board: Board, lockedGems: Cell[] = []): Array<{ from: Cell; to: Cell }> {
  const locked = lockedCellKeys(lockedGems);
  const swaps: Array<{ from: Cell; to: Cell }> = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (locked.has(cellKey(row, col))) continue;
      for (const [nextRow, nextCol] of [[row, col + 1], [row + 1, col]] as const) {
        if (!isInside(nextRow, nextCol) || locked.has(cellKey(nextRow, nextCol))) continue;
        const test = cloneBoard(board);
        [test[row][col], test[nextRow][nextCol]] = [test[nextRow][nextCol], test[row][col]];
        if (findMatches(test, lockedGems).length > 0) swaps.push({ from: { row, col }, to: { row: nextRow, col: nextCol } });
      }
    }
  }
  return swaps;
}

function fallbackBoard(): Board {
  const board = Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLS }, (_, col) => GEM_TYPES[(row * 3 + col * 2) % GEM_TYPES.length]));
  board[0].splice(0, 4, "red", "red", "blue", "red");
  board[1][2] = "red";
  return board;
}

function hasFourSwords(board: Board, lockedGems: Cell[] = []): boolean {
  const locked = lockedCellKeys(lockedGems);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (board[row][col] !== "sword") continue;
      if (locked.has(cellKey(row, col))) continue;
      if (col <= COLS - 4 && [1, 2, 3].every((offset) => !locked.has(cellKey(row, col + offset)) && board[row][col + offset] === "sword")) return true;
      if (row <= ROWS - 4 && [1, 2, 3].every((offset) => !locked.has(cellKey(row + offset, col)) && board[row + offset][col] === "sword")) return true;
    }
  }
  return false;
}

export function createBoard(random: () => number = Math.random): Board {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const board = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => randomGem(random)));
    if (findMatches(board).length === 0 && findLegalSwaps(board).length > 0) return board;
  }
  return fallbackBoard();
}

function createBoardKeepingVines(random: () => number, lockedGems: Cell[], original: Board): Board {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const board = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => randomGem(random)));
    for (const cell of lockedGems) board[cell.row][cell.col] = original[cell.row][cell.col];
    if (findMatches(board, lockedGems).length === 0 && findLegalSwaps(board, lockedGems).length > 0) return board;
  }
  const fallback = fallbackBoard();
  for (const cell of lockedGems) fallback[cell.row][cell.col] = original[cell.row][cell.col];
  return fallback;
}

function settleBoard(board: Board, random: () => number, lockedGems: Cell[] = []): { board: Board; summary: MatchSummary } {
  const next = cloneBoard(board);
  const locked = lockedCellKeys(lockedGems);
  const counts = emptyCounts();
  let cascades = 0;
  let swordStrikes = 0;
  while (cascades < 10) {
    const matches = findMatches(next, lockedGems);
    if (!matches.length) break;
    cascades += 1;
    if (hasFourSwords(next, lockedGems)) swordStrikes += 1;
    const removed = new Set<string>();
    for (const match of matches) {
      counts[match.type] += match.cells.length;
      for (const cell of match.cells) removed.add(cellKey(cell.row, cell.col));
    }

    for (let col = 0; col < COLS; col += 1) {
      const anchors = lockedGems
        .filter((cell) => cell.col === col)
        .map((cell) => cell.row)
        .sort((a, b) => a - b);
      let segmentStart = 0;
      for (const anchor of [...anchors, ROWS]) {
        const segmentEnd = anchor - 1;
        const segmentHeight = segmentEnd - segmentStart + 1;
        if (segmentHeight > 0) {
          const remaining: GemType[] = [];
          for (let row = segmentEnd; row >= segmentStart; row -= 1) {
            if (!removed.has(cellKey(row, col))) remaining.push(next[row][col]);
          }
          while (remaining.length < segmentHeight) remaining.push(randomGem(random));
          for (let row = segmentEnd; row >= segmentStart; row -= 1) {
            next[row][col] = remaining[segmentEnd - row];
          }
        }
        segmentStart = anchor + 1;
      }
    }
  }
  if (findMatches(next, lockedGems).length || !findLegalSwaps(next, lockedGems).length) {
    return { board: locked.size ? createBoardKeepingVines(random, lockedGems, next) : createBoard(random), summary: { counts, cascades, swordStrikes } };
  }
  return { board: next, summary: { counts, cascades, swordStrikes } };
}

export function createBattleState(random: () => number = Math.random, citySlug?: string): BattleState {
  const humans = DEFAULTS.map((job, index): BattleCharacter => ({
    id: `humans-${index + 1}`,
    side: "humans",
    name: `Human ${index + 1}`,
    job: job.job,
    manaGem: job.manaGem,
    skill: job.skill,
    skillName: job.skillName,
    skillCost: job.skillCost,
    level: 5,
    hp: 5 * BOSS_MOVE_CONFIG.regularHealthPerLevel,
    maxHp: 5 * BOSS_MOVE_CONFIG.regularHealthPerLevel,
    mana: 0,
    guardedBy: null,
    effects: emptyEffects(),
  }));
  const averageHumanLevel = Math.round(humans.reduce((total, character) => total + character.level, 0) / humans.length);
  const regularBotHp = averageHumanLevel * BOSS_MOVE_CONFIG.regularHealthPerLevel;
  const cityBoss = citySlug ? CITY_BOSSES[citySlug] : undefined;
  const bots = DEFAULTS.map((job, index): BattleCharacter => {
    const boss = index === 0 ? cityBoss : undefined;
    const maxHp = regularBotHp * (boss ? BOSS_MOVE_CONFIG.bossHealthMultiplier : 1);
    return {
      id: `bots-${index + 1}`,
      side: "bots",
      name: boss?.name ?? `Bot ${index + 1}`,
      job: boss ? "Boss" : job.job,
      manaGem: boss?.manaGem ?? job.manaGem,
      skill: boss ? "boss" : job.skill,
      skillName: boss?.skillName ?? job.skillName,
      skillCost: boss ? BOSS_MOVE_CONFIG.manaCost : job.skillCost,
      level: averageHumanLevel,
      hp: maxHp,
      maxHp,
      mana: 0,
      guardedBy: null,
      effects: emptyEffects(),
      ...(boss ? { bossId: boss.id, portrait: boss.portrait, cityOfOrigin: boss.cityOfOrigin } : {}),
    };
  });
  return {
    board: createBoard(random),
    lockedGems: [],
    vinesTurns: 0,
    teams: { humans, bots },
    activeIndex: { humans: 0, bots: 0 },
    turnSide: "humans",
    turnNumber: 1,
    flashId: 0,
    outcome: null,
    log: ["Match adjacent gems. Three charge a job; four swords strike the opposing leader."],
  };
}

export function createRoomBattleState(
  players: RoomBattlePlayer[],
  bossIds: BossId[],
  random: () => number = Math.random,
): BattleState {
  if (players.length < 1 || players.length > 4 || bossIds.length !== players.length
    || bossIds.some(id => !ROOM_BOSS_POOL.includes(id))) {
    throw new Error("Room battles require one to four players and the same number of available bosses.");
  }
  const state = createBattleState(random);
  const humans = state.teams.humans.slice(0, players.length).map((character, index) => {
    const player = players[index]!;
    const level = Math.max(1, Math.round(player.level ?? 5));
    const maxHp = level * BOSS_MOVE_CONFIG.regularHealthPerLevel;
    return {
      ...character,
      id: `human-${player.participantId}`,
      participantId: player.participantId,
      name: player.name,
      photoUrl: player.photoUrl ?? null,
      level,
      hp: maxHp,
      maxHp,
    };
  });
  const averageLevel = Math.round(humans.reduce((total, character) => total + character.level, 0) / humans.length);
  const maxBossHp = averageLevel * BOSS_MOVE_CONFIG.regularHealthPerLevel * BOSS_MOVE_CONFIG.bossHealthMultiplier;
  const bossById = new Map(Object.values(CITY_BOSSES).map(boss => [boss.id, boss]));
  const bots = bossIds.map((bossId, index): BattleCharacter => {
    const boss = bossById.get(bossId);
    if (!boss) throw new Error("Unknown room battle boss.");
    return {
      id: `boss-${index + 1}`,
      side: "bots",
      name: boss.name,
      job: "Boss",
      manaGem: boss.manaGem,
      skill: "boss",
      skillName: boss.skillName,
      skillCost: BOSS_MOVE_CONFIG.manaCost,
      level: averageLevel,
      hp: maxBossHp,
      maxHp: maxBossHp,
      mana: 0,
      guardedBy: null,
      effects: emptyEffects(),
      bossId: boss.id,
      portrait: boss.portrait,
      cityOfOrigin: boss.cityOfOrigin,
    };
  });
  return {
    ...state,
    teams: { humans, bots },
    activeIndex: { humans: 0, bots: 0 },
  };
}

export function activeCharacter(state: BattleState, side = state.turnSide): BattleCharacter {
  const team = state.teams[side];
  const alive = team.find((character) => character.hp > 0 && character.id === team[state.activeIndex[side]]?.id);
  return alive ?? team.find((character) => character.hp > 0) ?? team[0];
}

function applyMana(team: BattleCharacter[], counts: Record<GemType, number>): void {
  for (const character of team) {
    if (character.hp > 0) character.mana = Math.min(character.skillCost, character.mana + counts[character.manaGem]);
  }
}

function damageCharacter(team: BattleCharacter[], target: BattleCharacter, damage: number): { message: string; dealt: number } {
  if (target.effects.immuneTurns > 0) {
    return { message: `${target.name} is immune to damage.`, dealt: 0 };
  }
  const guard = team.find((character) => character.id === target.guardedBy && character.hp > 0);
  target.guardedBy = null;
  const recipient = guard ?? target;
  const adjustedDamage = recipient.effects.armoredTurns > 0
    ? Math.max(1, Math.ceil(damage * BOSS_MOVE_CONFIG.magmaArmorDamageMultiplier))
    : damage;
  const dealt = Math.min(recipient.hp, adjustedDamage);
  recipient.hp = Math.max(0, recipient.hp - adjustedDamage);
  return {
    message: guard
      ? `${guard.name} intercepted ${dealt} damage for ${target.name}.`
      : `${target.name} took ${dealt} damage.`,
    dealt,
  };
}

function damageLeader(team: BattleCharacter[], damage: number): string {
  const leader = team.find((character) => character.hp > 0);
  if (!leader) return "No enemy remains.";
  return damageCharacter(team, leader, damage).message;
}

function nextLivingIndex(team: BattleCharacter[], currentIndex: number): number {
  for (let step = 1; step <= team.length; step += 1) {
    const candidate = (currentIndex + step) % team.length;
    if (team[candidate].hp > 0) return candidate;
  }
  return currentIndex;
}

function battleOutcome(state: BattleState, actingSide: BattleSide): BattleState["outcome"] {
  const humansDefeated = state.teams.humans.every((character) => character.hp <= 0);
  const botsDefeated = state.teams.bots.every((character) => character.hp <= 0);
  if (humansDefeated && botsDefeated) return actingSide === "humans" ? "victory" : "defeat";
  if (botsDefeated) return "victory";
  if (humansDefeated) return "defeat";
  return null;
}

function cloneBattleState(state: BattleState): BattleState {
  return {
    ...state,
    board: cloneBoard(state.board),
    lockedGems: state.lockedGems.map((cell) => ({ ...cell })),
    teams: {
      humans: state.teams.humans.map((character) => ({ ...character, effects: { ...character.effects } })),
      bots: state.teams.bots.map((character) => ({ ...character, effects: { ...character.effects } })),
    },
    activeIndex: { ...state.activeIndex },
    log: [...state.log],
  };
}

function startSideEffects(state: BattleState, side: BattleSide): string[] {
  const messages: string[] = [];
  const team = state.teams[side];
  for (const character of team) {
    if (character.hp <= 0) continue;
    if (character.effects.immuneTurns > 0) character.effects.immuneTurns -= 1;
    if (character.effects.armoredTurns > 0) character.effects.armoredTurns -= 1;
    if (character.effects.burnTurns <= 0) continue;
    if (character.effects.burnDelayTurns > 0) {
      character.effects.burnDelayTurns -= 1;
      continue;
    }
    const tick = damageCharacter(team, character, character.effects.burnDamagePerTurn);
    messages.push(`${character.name} burned for ${tick.dealt} damage.`);
    character.effects.burnTurns -= 1;
    if (character.effects.burnTurns <= 0) character.effects.burnDamagePerTurn = 0;
  }
  return messages;
}

function finishTurn(state: BattleState, side: BattleSide, message: string, preserveNewVines = false): BattleState {
  const teams = state.teams;
  const enemy = otherSide(side);
  const current = activeCharacter(state, side);
  const currentPosition = teams[side].findIndex((character) => character.id === current.id);
  const nextIndex = nextLivingIndex(teams[side], currentPosition);
  const vinesTurns = preserveNewVines ? state.vinesTurns : Math.max(0, state.vinesTurns - 1);
  const next: BattleState = {
    ...state,
    lockedGems: vinesTurns > 0 ? state.lockedGems : [],
    vinesTurns,
    turnSide: enemy,
    turnNumber: state.turnNumber + 1,
    activeIndex: { ...state.activeIndex, [side]: nextIndex },
    outcome: null,
    log: [message, ...state.log].slice(0, 5),
  };
  const effectMessages = startSideEffects(next, enemy);
  next.outcome = battleOutcome(next, side);
  if (effectMessages.length) next.log = [...effectMessages, ...next.log].slice(0, 5);
  return next;
}

export function skipScaredTurn(state: BattleState): BattleState {
  if (state.turnSide !== "humans" || state.outcome) return state;
  const active = activeCharacter(state, "humans");
  if (active.hp <= 0 || active.effects.scaredTurns <= 0) return state;
  const next = cloneBattleState(state);
  const target = next.teams.humans.find((character) => character.id === active.id)!;
  target.effects.scaredTurns = Math.max(0, target.effects.scaredTurns - 1);
  const currentPosition = next.teams.humans.findIndex((character) => character.id === active.id);
  next.activeIndex.humans = nextLivingIndex(next.teams.humans, currentPosition);
  next.vinesTurns = Math.max(0, next.vinesTurns - 1);
  if (next.vinesTurns === 0) next.lockedGems = [];
  next.turnSide = "bots";
  next.turnNumber += 1;
  const effectMessages = startSideEffects(next, "bots");
  next.outcome = battleOutcome(next, "bots");
  next.log = [...effectMessages, `${active.name} is scared and loses their turn.`, ...next.log].slice(0, 5);
  return next;
}

function appendMatchEffects(state: BattleState, side: BattleSide, settled: { board: Board; summary: MatchSummary }, actor: BattleCharacter): string[] {
  state.board = settled.board;
  applyMana(state.teams[side], settled.summary.counts);
  const messages: string[] = [];
  const manaMatches = MANA_GEMS.filter((type) => settled.summary.counts[type] > 0)
    .map((type) => `${type} gems charged ${state.teams[side].find((character) => character.manaGem === type)?.name ?? "a teammate"}`);
  if (manaMatches.length) messages.push(manaMatches.join(" · "));
  for (let strike = 0; strike < settled.summary.swordStrikes; strike += 1) {
    messages.push(`${actor.name} matched four swords. ${damageLeader(state.teams[otherSide(side)], actor.level)}`);
  }
  if (!messages.length) messages.push(`${actor.name} made a match.`);
  return messages;
}

export function applySwap(state: BattleState, from: Cell, to: Cell, random: () => number = Math.random): TurnResult {
  if (state.outcome || Math.abs(from.row - to.row) + Math.abs(from.col - to.col) !== 1 || !isInside(from.row, from.col) || !isInside(to.row, to.col)) {
    return { accepted: false, state };
  }
  if (activeCharacter(state).effects.scaredTurns > 0) return { accepted: false, state };
  const locked = lockedCellKeys(state.lockedGems);
  if (locked.has(cellKey(from.row, from.col)) || locked.has(cellKey(to.row, to.col))) return { accepted: false, state };
  const swapped = cloneBoard(state.board);
  [swapped[from.row][from.col], swapped[to.row][to.col]] = [swapped[to.row][to.col], swapped[from.row][from.col]];
  if (!findMatches(swapped, state.lockedGems).length) return { accepted: false, state };

  const next = cloneBattleState(state);
  const actor = activeCharacter(next);
  const settled = settleBoard(swapped, random, next.lockedGems);
  const messages = appendMatchEffects(next, next.turnSide, settled, actor);
  return { accepted: true, state: finishTurn(next, next.turnSide, messages.join(" ")) };
}

function blastBoard(board: Board, target: Cell, random: () => number, lockedGems: Cell[] = []): { board: Board; summary: MatchSummary } {
  const next = cloneBoard(board);
  const locked = lockedCellKeys(lockedGems);
  const counts = emptyCounts();
  for (let row = target.row - 1; row <= target.row + 1; row += 1) {
    for (let col = target.col - 1; col <= target.col + 1; col += 1) {
      if (isInside(row, col) && (row !== target.row || col !== target.col) && !locked.has(cellKey(row, col))) {
        counts[next[row][col]] += 1;
        next[row][col] = randomGem(random);
      }
    }
  }
  const cascaded = settleBoard(next, random, lockedGems);
  for (const type of GEM_TYPES) counts[type] += cascaded.summary.counts[type];
  return { board: cascaded.board, summary: { ...cascaded.summary, counts, cascades: cascaded.summary.cascades + 1 } };
}

export function applySkill(state: BattleState, target: SkillTarget, random: () => number = Math.random): TurnResult {
  if (state.outcome) return { accepted: false, state };
  const next = cloneBattleState(state);
  const side = next.turnSide;
  const actor = activeCharacter(next);
  if (actor.mana < actor.skillCost || actor.effects.scaredTurns > 0) return { accepted: false, state };
  const allies = next.teams[side];
  const enemies = next.teams[otherSide(side)];
  let message = "";

  if (actor.skill === "blast" && target.kind === "cell" && isInside(target.row, target.col)) {
    const result = blastBoard(next.board, target, random, next.lockedGems);
    next.board = result.board;
    applyMana(allies, result.summary.counts);
    for (const enemy of [...enemies].filter((character) => character.hp > 0)) damageCharacter(enemies, enemy, 8);
    message = `${actor.name} used Blast. All enemies took 8 damage.`;
  } else if (actor.skill === "guard" && target.kind === "character") {
    const ally = allies.find((character) => character.id === target.id && character.hp > 0 && character.skill === "heal");
    if (!ally) return { accepted: false, state };
    ally.guardedBy = actor.id;
    message = `${actor.name} will intercept the next hit aimed at ${ally.name}.`;
  } else if (actor.skill === "strike" && target.kind === "character") {
    const enemy = enemies.find((character) => character.id === target.id && character.hp > 0);
    if (!enemy) return { accepted: false, state };
    message = `${actor.name} used Strike. ${damageCharacter(enemies, enemy, 20).message}`;
  } else if (actor.skill === "heal" && target.kind === "character") {
    const ally = allies.find((character) => character.id === target.id && character.hp > 0);
    if (!ally) return { accepted: false, state };
    const healed = Math.min(20, ally.maxHp - ally.hp);
    if (!healed) return { accepted: false, state };
    ally.hp += healed;
    message = `${actor.name} healed ${ally.name} for ${healed} HP.`;
  } else {
    return { accepted: false, state };
  }

  actor.mana = 0;
  return { accepted: true, state: finishTurn(next, side, message) };
}

export function validSkillTarget(state: BattleState, target: SkillTarget): boolean {
  const actor = activeCharacter(state);
  const team = target.kind === "cell" ? null : state.teams[target.id.startsWith(`${state.turnSide}-`) ? state.turnSide : otherSide(state.turnSide)];
  if (target.kind === "cell") return actor.skill === "blast" && isInside(target.row, target.col);
  const character = team?.find((candidate) => candidate.id === target.id && candidate.hp > 0);
  if (!character) return false;
  if (actor.skill === "strike") return character.side !== actor.side;
  if (actor.skill === "guard") return character.side === actor.side && character.skill === "heal";
  if (actor.skill === "heal") return character.side === actor.side && character.hp < character.maxHp;
  return false;
}

function healCharacter(character: BattleCharacter, amount: number): number {
  const healed = Math.min(Math.max(0, amount), character.maxHp - character.hp);
  character.hp += healed;
  return healed;
}

function randomVineCells(state: BattleState, count: number, random: () => number): Cell[] {
  const cells = Array.from({ length: ROWS * COLS }, (_, index) => ({
    row: Math.floor(index / COLS),
    col: index % COLS,
  }));
  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [cells[index], cells[swapIndex]] = [cells[swapIndex], cells[index]];
  }
  const selected: Cell[] = [];
  for (const cell of cells) {
    const candidate = [...selected, cell];
    if (findLegalSwaps(state.board, candidate).length > 0) selected.push(cell);
    if (selected.length === count) return selected;
  }
  return selected;
}

function resolveBossMove(state: BattleState, actor: BattleCharacter, random: () => number): string {
  const bossId = actor.bossId;
  const humans = state.teams.humans;
  const aliveHumans = humans.filter((character) => character.hp > 0);
  if (!bossId) return `${actor.name} could not use a boss move.`;

  if (bossId === "vampire") {
    let drained = 0;
    for (const human of aliveHumans) {
      drained += damageCharacter(humans, human, BOSS_MOVE_CONFIG.vampireDamagePerPlayer).dealt;
    }
    const healed = healCharacter(actor, drained * BOSS_MOVE_CONFIG.vampireHealPerDamage);
    return `${actor.name} drained ${drained} HP from the team and healed ${healed} HP.`;
  }

  if (bossId === "zombie") {
    const target = [...aliveHumans].sort((a, b) => a.hp - b.hp)[0];
    if (!target) return `${actor.name} found no target.`;
    const dealt = damageCharacter(humans, target, BOSS_MOVE_CONFIG.zombieDamage).dealt;
    const healed = healCharacter(actor, dealt * BOSS_MOVE_CONFIG.zombieHealPerDamage);
    return `${actor.name} struck ${target.name} for ${dealt} damage and healed ${healed} HP.`;
  }

  if (bossId === "magma-golem") {
    const target = aliveHumans[Math.floor(random() * aliveHumans.length)];
    if (!target) return `${actor.name} found no target.`;
    const impact = damageCharacter(humans, target, BOSS_MOVE_CONFIG.magmaDamage);
    actor.effects.armoredTurns = BOSS_MOVE_CONFIG.magmaArmorTurns;
    return `${actor.name} slammed ${target.name} for ${impact.dealt} damage and hardened its shell for ${actor.effects.armoredTurns} turns.`;
  }

  if (bossId === "treant") {
    state.lockedGems = randomVineCells(state, BOSS_MOVE_CONFIG.treantVineCount, random);
    state.vinesTurns = BOSS_MOVE_CONFIG.treantVineTurns;
    return `${actor.name} vine-locked ${state.lockedGems.length} gems for ${state.vinesTurns} turns.`;
  }

  if (bossId === "fallen-seraph") {
    let drainedMana = 0;
    for (const human of aliveHumans) {
      damageCharacter(humans, human, BOSS_MOVE_CONFIG.fallenSeraphDamagePerPlayer);
      const drained = Math.ceil(human.mana * BOSS_MOVE_CONFIG.fallenSeraphManaDrainRatio);
      human.mana = Math.max(0, human.mana - drained);
      drainedMana += drained;
    }
    state.flashId += 1;
    return `${actor.name}'s blinding light hit the team and drained ${drainedMana} mana.`;
  }

  if (bossId === "ghost") {
    for (const human of aliveHumans) damageCharacter(humans, human, BOSS_MOVE_CONFIG.ghostDamagePerPlayer);
    actor.effects.immuneTurns = BOSS_MOVE_CONFIG.ghostImmunityTurns;
    return `${actor.name} hit the team and became immune for ${actor.effects.immuneTurns} turns.`;
  }

  if (bossId === "dragon") {
    const baseDamage = aliveHumans.length
      ? Math.floor(BOSS_MOVE_CONFIG.dragonTotalDamage / aliveHumans.length)
      : 0;
    let remainder = aliveHumans.length
      ? BOSS_MOVE_CONFIG.dragonTotalDamage % aliveHumans.length
      : 0;
    for (const human of aliveHumans) {
      const damage = baseDamage + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      damageCharacter(humans, human, damage);
      human.effects.burnTurns = BOSS_MOVE_CONFIG.dragonBurnTurns;
      human.effects.burnDamagePerTurn = BOSS_MOVE_CONFIG.dragonBurnDamagePerTurn;
      human.effects.burnDelayTurns = BOSS_MOVE_CONFIG.dragonBurnDelayTurns;
    }
    return `${actor.name} dealt ${BOSS_MOVE_CONFIG.dragonTotalDamage} team damage and burned each survivor.`;
  }

  for (const human of aliveHumans) damageCharacter(humans, human, BOSS_MOVE_CONFIG.wolfDamagePerPlayer);
  const frightened = [...aliveHumans];
  const scaredNames: string[] = [];
  const scaredCount = Math.min(BOSS_MOVE_CONFIG.wolfScaredPlayers, frightened.length);
  for (let index = 0; index < scaredCount; index += 1) {
    const selectedIndex = Math.min(frightened.length - 1, Math.floor(random() * frightened.length));
    const [target] = frightened.splice(selectedIndex, 1);
    if (!target) continue;
    target.effects.scaredTurns = Math.max(target.effects.scaredTurns, BOSS_MOVE_CONFIG.wolfScaredTurns);
    scaredNames.push(target.name);
  }
  return `${actor.name} hit the team and howled. ${scaredNames.join(" and ")} lost their next turn.`;
}

export function botTurn(state: BattleState, random: () => number = Math.random): BattleState {
  if (state.turnSide !== "bots" || state.outcome) return state;
  let turnState = state;
  const startingActor = activeCharacter(state, "bots");
  if (startingActor.bossId === "treant") {
    turnState = cloneBattleState(state);
    const treant = activeCharacter(turnState, "bots");
    const healed = healCharacter(treant, BOSS_MOVE_CONFIG.treantTurnHeal);
    if (healed > 0) turnState.log = [`${treant.name} regrew ${healed} HP at the start of its turn.`, ...turnState.log].slice(0, 5);
  }
  const actor = activeCharacter(turnState);
  if (actor.mana >= actor.skillCost) {
    if (actor.bossId) {
      const next = cloneBattleState(turnState);
      const boss = activeCharacter(next, "bots");
      boss.mana = 0;
      return finishTurn(next, "bots", resolveBossMove(next, boss, random), boss.bossId === "treant");
    }
    let target: SkillTarget | null = null;
    if (actor.skill === "blast") target = { kind: "cell", row: Math.floor(random() * ROWS), col: Math.floor(random() * COLS) };
    if (actor.skill === "strike") {
      const enemy = state.teams.humans.find((character) => character.hp > 0);
      if (enemy) target = { kind: "character", id: enemy.id };
    }
    if (actor.skill === "guard") {
      const ally = state.teams.bots.find((character) => character.hp > 0 && character.skill === "heal" && !character.guardedBy);
      if (ally) target = { kind: "character", id: ally.id };
    }
    if (actor.skill === "heal") {
      const ally = [...state.teams.bots].filter((character) => character.hp > 0)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
      if (ally && ally.hp < ally.maxHp) target = { kind: "character", id: ally.id };
    }
    if (target) {
      const result = applySkill(turnState, target, random);
      if (result.accepted) return result.state;
    }
  }
  const swaps = findLegalSwaps(turnState.board, turnState.lockedGems);
  const swap = swaps[Math.floor(random() * swaps.length)];
  if (!swap) {
    const next = cloneBattleState(turnState);
    next.board = next.lockedGems.length
      ? createBoardKeepingVines(random, next.lockedGems, next.board)
      : createBoard(random);
    return finishTurn(next, "bots", "The board refreshed.");
  }
  return applySwap(turnState, swap.from, swap.to, random).state;
}
