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
export type SkillKind = "blast" | "guard" | "strike" | "heal";
export type SkillTarget = { kind: "cell"; row: number; col: number } | { kind: "character"; id: string };

export interface Cell {
  row: number;
  col: number;
}

export interface BattleCharacter {
  id: string;
  side: BattleSide;
  name: string;
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
}

export type Board = GemType[][];

export interface BattleState {
  board: Board;
  teams: Record<BattleSide, BattleCharacter[]>;
  activeIndex: Record<BattleSide, number>;
  turnSide: BattleSide;
  turnNumber: number;
  outcome: "victory" | "defeat" | null;
  log: string[];
}

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

export function findMatches(board: Board): Array<{ type: GemType; cells: Cell[] }> {
  const grouped = new Map<GemType, Map<string, Cell>>();
  const addRun = (type: GemType, cells: Cell[]) => {
    if (!grouped.has(type)) grouped.set(type, new Map());
    const byCell = grouped.get(type)!;
    for (const cell of cells) byCell.set(cellKey(cell.row, cell.col), cell);
  };

  for (let row = 0; row < ROWS; row += 1) {
    let start = 0;
    while (start < COLS) {
      const type = board[row]?.[start];
      let end = start + 1;
      while (type && end < COLS && board[row]?.[end] === type) end += 1;
      if (type && end - start >= 3) {
        addRun(type, Array.from({ length: end - start }, (_, offset) => ({ row, col: start + offset })));
      }
      start = end;
    }
  }

  for (let col = 0; col < COLS; col += 1) {
    let start = 0;
    while (start < ROWS) {
      const type = board[start]?.[col];
      let end = start + 1;
      while (type && end < ROWS && board[end]?.[col] === type) end += 1;
      if (type && end - start >= 3) {
        addRun(type, Array.from({ length: end - start }, (_, offset) => ({ row: start + offset, col })));
      }
      start = end;
    }
  }

  return [...grouped.entries()].map(([type, cells]) => ({ type, cells: [...cells.values()] }));
}

export function findLegalSwaps(board: Board): Array<{ from: Cell; to: Cell }> {
  const swaps: Array<{ from: Cell; to: Cell }> = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      for (const [nextRow, nextCol] of [[row, col + 1], [row + 1, col]] as const) {
        if (!isInside(nextRow, nextCol)) continue;
        const test = cloneBoard(board);
        [test[row][col], test[nextRow][nextCol]] = [test[nextRow][nextCol], test[row][col]];
        if (findMatches(test).length > 0) swaps.push({ from: { row, col }, to: { row: nextRow, col: nextCol } });
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

function hasFourSwords(board: Board): boolean {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (board[row][col] !== "sword") continue;
      if (col <= COLS - 4 && [1, 2, 3].every((offset) => board[row][col + offset] === "sword")) return true;
      if (row <= ROWS - 4 && [1, 2, 3].every((offset) => board[row + offset][col] === "sword")) return true;
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

function settleBoard(board: Board, random: () => number): { board: Board; summary: MatchSummary } {
  const next = cloneBoard(board);
  const counts = emptyCounts();
  let cascades = 0;
  let swordStrikes = 0;
  while (cascades < 10) {
    const matches = findMatches(next);
    if (!matches.length) break;
    cascades += 1;
    if (hasFourSwords(next)) swordStrikes += 1;
    const removed = new Set<string>();
    for (const match of matches) {
      counts[match.type] += match.cells.length;
      for (const cell of match.cells) removed.add(cellKey(cell.row, cell.col));
    }

    for (let col = 0; col < COLS; col += 1) {
      const remaining: GemType[] = [];
      for (let row = ROWS - 1; row >= 0; row -= 1) {
        if (!removed.has(cellKey(row, col))) remaining.push(next[row][col]);
      }
      while (remaining.length < ROWS) remaining.push(randomGem(random));
      for (let row = ROWS - 1; row >= 0; row -= 1) next[row][col] = remaining[ROWS - 1 - row];
    }
  }
  if (findMatches(next).length || !findLegalSwaps(next).length) {
    return { board: createBoard(random), summary: { counts, cascades, swordStrikes } };
  }
  return { board: next, summary: { counts, cascades, swordStrikes } };
}

export function createBattleState(random: () => number = Math.random): BattleState {
  const makeTeam = (side: BattleSide) => DEFAULTS.map((job, index): BattleCharacter => ({
    id: `${side}-${index + 1}`,
    side,
    name: side === "humans" ? `Human ${index + 1}` : `Bot ${index + 1}`,
    job: job.job,
    manaGem: job.manaGem,
    skill: job.skill,
    skillName: job.skillName,
    skillCost: job.skillCost,
    level: 5,
    hp: 75,
    maxHp: 75,
    mana: 0,
    guardedBy: null,
  }));
  return {
    board: createBoard(random),
    teams: { humans: makeTeam("humans"), bots: makeTeam("bots") },
    activeIndex: { humans: 0, bots: 0 },
    turnSide: "humans",
    turnNumber: 1,
    outcome: null,
    log: ["Match adjacent gems. Three charge a job; four swords strike the opposing leader."],
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

function damageCharacter(team: BattleCharacter[], target: BattleCharacter, damage: number): string {
  const guard = team.find((character) => character.id === target.guardedBy && character.hp > 0);
  target.guardedBy = null;
  const recipient = guard ?? target;
  recipient.hp = Math.max(0, recipient.hp - damage);
  return guard
    ? `${guard.name} intercepted ${damage} damage for ${target.name}.`
    : `${target.name} took ${damage} damage.`;
}

function damageLeader(team: BattleCharacter[], damage: number): string {
  const leader = team.find((character) => character.hp > 0);
  if (!leader) return "No enemy remains.";
  return damageCharacter(team, leader, damage);
}

function finishTurn(state: BattleState, side: BattleSide, message: string): BattleState {
  const teams = state.teams;
  const enemy = otherSide(side);
  const outcome = teams[enemy].every((character) => character.hp <= 0)
    ? side === "humans" ? "victory" : "defeat"
    : teams[side].every((character) => character.hp <= 0)
      ? side === "humans" ? "defeat" : "victory"
      : null;
  const alive = teams[side].filter((character) => character.hp > 0);
  const current = activeCharacter(state, side);
  const currentPosition = teams[side].findIndex((character) => character.id === current.id);
  let nextIndex = currentPosition;
  if (alive.length > 0) {
    for (let step = 1; step <= teams[side].length; step += 1) {
      const candidate = (currentPosition + step) % teams[side].length;
      if (teams[side][candidate].hp > 0) {
        nextIndex = candidate;
        break;
      }
    }
  }
  return {
    ...state,
    turnSide: enemy,
    turnNumber: state.turnNumber + 1,
    activeIndex: { ...state.activeIndex, [side]: nextIndex },
    outcome,
    log: [message, ...state.log].slice(0, 5),
  };
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
  const swapped = cloneBoard(state.board);
  [swapped[from.row][from.col], swapped[to.row][to.col]] = [swapped[to.row][to.col], swapped[from.row][from.col]];
  if (!findMatches(swapped).length) return { accepted: false, state };

  const next = { ...state, teams: { humans: state.teams.humans.map((c) => ({ ...c })), bots: state.teams.bots.map((c) => ({ ...c })) } };
  const actor = activeCharacter(next);
  const settled = settleBoard(swapped, random);
  const messages = appendMatchEffects(next, next.turnSide, settled, actor);
  return { accepted: true, state: finishTurn(next, next.turnSide, messages.join(" ")) };
}

function blastBoard(board: Board, target: Cell, random: () => number): { board: Board; summary: MatchSummary } {
  const next = cloneBoard(board);
  const counts = emptyCounts();
  for (let row = target.row - 1; row <= target.row + 1; row += 1) {
    for (let col = target.col - 1; col <= target.col + 1; col += 1) {
      if (isInside(row, col) && (row !== target.row || col !== target.col)) {
        counts[next[row][col]] += 1;
        next[row][col] = randomGem(random);
      }
    }
  }
  const cascaded = settleBoard(next, random);
  for (const type of GEM_TYPES) counts[type] += cascaded.summary.counts[type];
  return { board: cascaded.board, summary: { ...cascaded.summary, counts, cascades: cascaded.summary.cascades + 1 } };
}

export function applySkill(state: BattleState, target: SkillTarget, random: () => number = Math.random): TurnResult {
  if (state.outcome) return { accepted: false, state };
  const next: BattleState = {
    ...state,
    teams: { humans: state.teams.humans.map((c) => ({ ...c })), bots: state.teams.bots.map((c) => ({ ...c })) },
    board: cloneBoard(state.board),
  };
  const side = next.turnSide;
  const actor = activeCharacter(next);
  if (actor.mana < actor.skillCost) return { accepted: false, state };
  const allies = next.teams[side];
  const enemies = next.teams[otherSide(side)];
  let message = "";

  if (actor.skill === "blast" && target.kind === "cell" && isInside(target.row, target.col)) {
    const result = blastBoard(next.board, target, random);
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
    message = `${actor.name} used Strike. ${damageCharacter(enemies, enemy, 20)}`;
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

export function botTurn(state: BattleState, random: () => number = Math.random): BattleState {
  if (state.turnSide !== "bots" || state.outcome) return state;
  const actor = activeCharacter(state);
  if (actor.mana >= actor.skillCost) {
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
      const result = applySkill(state, target, random);
      if (result.accepted) return result.state;
    }
  }
  const swaps = findLegalSwaps(state.board);
  const swap = swaps[Math.floor(random() * swaps.length)];
  if (!swap) {
    const next = { ...state, board: createBoard(random), log: ["The board refreshed.", ...state.log].slice(0, 5) };
    return next;
  }
  return applySwap(state, swap.from, swap.to, random).state;
}
