import test from "node:test";
import assert from "node:assert/strict";
import {
  GEM_TYPES,
  ROWS,
  COLS,
  activeCharacter,
  applySkill,
  applySwap,
  botTurn,
  createBattleState,
  createRoomBattleState,
  createBoard,
  findLegalSwaps,
  findMatches,
  skipScaredTurn,
  validSkillTarget,
  type Board,
} from "../src/battle/battle-engine";
import { BOSS_MOVE_CONFIG, CITY_BOSSES } from "../src/battle/boss-config";
import { cardHomeCity, raceHomeCitySlug } from "../src/battle/race-home-cities";

test("room battle creates matching player and boss teams from one through four seats", () => {
  for (let count = 1; count <= 4; count += 1) {
    const players = Array.from({ length: count }, (_, index) => ({
      participantId: `seat-${index + 1}`,
      name: `Player ${index + 1}`,
      photoUrl: `/photo-${index + 1}`,
      race: "Human",
      homeCitySlug: "frosthold",
    }));
    const bosses = Array.from({ length: count }, (_, index) => (["vampire", "wolf", "ghost", "zombie"] as const)[index]);
    const state = createRoomBattleState(players, bosses, () => 0.51);
    assert.equal(state.teams.humans.length, count);
    assert.equal(state.teams.bots.length, count);
    assert.deepEqual(state.teams.humans.map(player => player.participantId), players.map(player => player.participantId));
    assert.deepEqual(state.teams.humans.map(player => player.photoUrl), players.map(player => player.photoUrl));
    assert.deepEqual(state.teams.humans.map(player => player.race), players.map(player => player.race));
    assert.ok(state.teams.humans.every(player => player.homeCitySlug === "oakhaven"));
    assert.deepEqual(state.teams.bots.map(boss => boss.bossId), bosses);
    assert.ok(state.teams.bots.every(boss => boss.maxHp === state.teams.humans[0]!.maxHp * BOSS_MOVE_CONFIG.bossHealthMultiplier));
    assert.equal(state.board.length, ROWS);
    assert.ok(state.board.every(row => row.length === COLS));
    assert.ok(findLegalSwaps(state.board).length > 0);
  }
});

test("race locks Humans to Oakhaven and every boss resolves its actual origin city", () => {
  assert.equal(raceHomeCitySlug("Human"), "oakhaven");
  assert.equal(raceHomeCitySlug("Humans"), "oakhaven");
  assert.equal(raceHomeCitySlug(undefined), "oakhaven");
  assert.equal(raceHomeCitySlug("unknown race"), undefined);
  assert.ok(createBattleState().teams.humans.every(player => cardHomeCity(player)?.slug === "oakhaven"));
  for (const [slug, boss] of Object.entries(CITY_BOSSES)) {
    assert.equal(cardHomeCity({ bossId: boss.id, cityOfOrigin: boss.cityOfOrigin })?.slug, slug);
  }
});

test("1v1 room battle resolves a gem match, charges the player, and hands the turn to the boss", () => {
  const state = createRoomBattleState(
    [{ participantId: "seat-1", name: "Player 1" }],
    ["dragon"],
    () => 0,
  );
  const result = applySwap(state, { row: 0, col: 2 }, { row: 1, col: 2 });
  assert.equal(result.accepted, true);
  assert.equal(result.state.turnSide, "bots");
  assert.ok(result.state.teams.humans[0]!.mana > 0);
  assert.notDeepEqual(result.state.board, state.board);
  assert.equal(botTurn(result.state).turnSide, "humans");
});

test("charged card targeting keeps enemy strikes and teammate skills on the correct side", () => {
  const state = createBattleState(() => 0.51);
  state.activeIndex.humans = 2;
  assert.equal(validSkillTarget(state, { kind: "character", id: state.teams.bots[0]!.id }), true);
  assert.equal(validSkillTarget(state, { kind: "character", id: state.teams.humans[0]!.id }), false);

  state.activeIndex.humans = 1;
  assert.equal(validSkillTarget(state, { kind: "character", id: state.teams.humans[3]!.id }), true);
  assert.equal(validSkillTarget(state, { kind: "character", id: state.teams.bots[0]!.id }), false);

  state.activeIndex.humans = 3;
  state.teams.humans[0]!.hp -= 1;
  assert.equal(validSkillTarget(state, { kind: "character", id: state.teams.humans[0]!.id }), true);
  assert.equal(validSkillTarget(state, { kind: "character", id: state.teams.bots[0]!.id }), false);
});

function freshPattern(): Board {
  return Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLS }, (_, col) => GEM_TYPES[(row * 3 + col * 2) % GEM_TYPES.length]));
}

function chargedBoss(citySlug: string) {
  const state = createBattleState(() => 0.51, citySlug);
  state.turnSide = "bots";
  state.activeIndex.bots = 0;
  state.teams.bots[0].mana = state.teams.bots[0].skillCost;
  return state;
}

function oneMatchBoard(): Board {
  const board = freshPattern();
  board[0][0] = "red";
  board[0][1] = "red";
  board[0][2] = "blue";
  board[0][3] = "red";
  board[1][2] = "red";
  return board;
}

function fourSwordBoard(): Board {
  const board = freshPattern();
  board[0][0] = "sword";
  board[0][1] = "sword";
  board[0][2] = "red";
  board[0][3] = "sword";
  board[1][2] = "sword";
  return board;
}

test("the first board is an 8x8 playable grid with no free opening matches", () => {
  const board = createBoard();
  assert.equal(board.length, 8);
  assert.ok(board.every((row) => row.length === 8));
  assert.equal(findMatches(board).length, 0);
  assert.ok(findLegalSwaps(board).length > 0);
});

test("even a constant random source falls back to a playable board", () => {
  const board = createBoard(() => 0);
  assert.equal(findMatches(board).length, 0);
  assert.ok(findLegalSwaps(board).length > 0);
});

test("a valid adjacent swap resolves a match and charges the matching human job", () => {
  const state = createBattleState();
  const board = freshPattern();
  board[0][0] = "red";
  board[0][1] = "red";
  board[0][2] = "blue";
  board[0][3] = "red";
  board[1][2] = "red";
  assert.equal(findMatches(board).length, 0);
  const result = applySwap({ ...state, board }, { row: 0, col: 2 }, { row: 1, col: 2 });
  assert.equal(result.accepted, true);
  assert.ok(result.state.teams.humans[0].mana >= 4);
  assert.equal(result.state.turnSide, "bots");
});

test("a four-sword match damages the opposing leader", () => {
  const state = createBattleState();
  const board = freshPattern();
  board[0][0] = "sword";
  board[0][1] = "sword";
  board[0][2] = "red";
  board[0][3] = "sword";
  board[1][2] = "sword";
  assert.equal(findMatches(board).length, 0);
  const result = applySwap({ ...state, board }, { row: 0, col: 2 }, { row: 1, col: 2 }, () => 0.51);
  assert.equal(result.accepted, true);
  assert.equal(result.state.teams.bots[0].hp, 70);
});

test("a charged skill needs a target and then consumes the acting hero's turn", () => {
  const state = createBattleState();
  const humans = state.teams.humans.map((character) => ({ ...character }));
  humans[1].mana = humans[1].skillCost;
  const ready = {
    ...state,
    teams: { ...state.teams, humans },
    activeIndex: { ...state.activeIndex, humans: 1 },
  };
  assert.equal(activeCharacter(ready).job, "Squire");
  const result = applySkill(ready, { kind: "character", id: "humans-4" });
  assert.equal(result.accepted, true);
  assert.equal(result.state.teams.humans[3].guardedBy, "humans-2");
  assert.equal(result.state.teams.humans[1].mana, 0);
  assert.equal(result.state.turnSide, "bots");
});

test("a charged Trapper can defeat the final enemy and end the battle", () => {
  const state = createBattleState();
  const humans = state.teams.humans.map((character) => ({ ...character }));
  const bots = state.teams.bots.map((character) => ({ ...character, hp: 0 }));
  humans[2].mana = humans[2].skillCost;
  bots[0].hp = 20;
  const ready = {
    ...state,
    teams: { humans, bots },
    activeIndex: { ...state.activeIndex, humans: 2 },
  };
  const result = applySkill(ready, { kind: "character", id: "bots-1" });
  assert.equal(result.accepted, true);
  assert.equal(result.state.outcome, "victory");
});

test("three swords do not count as a four-sword strike", () => {
  const state = createBattleState();
  const board = freshPattern();
  board[0].splice(0, 4, "sword", "sword", "blue", "brown");
  board[1][2] = "sword";
  assert.equal(findMatches(board).length, 0);
  const result = applySwap({ ...state, board }, { row: 0, col: 2 }, { row: 1, col: 2 }, () => 0.51);
  assert.equal(result.accepted, true);
  assert.equal(result.state.teams.bots[0].hp, 75);
});

test("Squire redirects a hit on the protected healer rather than adding armor", () => {
  const state = createBattleState();
  state.teams.humans[3].guardedBy = "humans-2";
  state.teams.bots[2].mana = state.teams.bots[2].skillCost;
  state.turnSide = "bots";
  state.activeIndex.bots = 2;
  const result = applySkill(state, { kind: "character", id: "humans-4" });
  assert.equal(result.accepted, true);
  assert.equal(result.state.teams.humans[3].hp, 75);
  assert.equal(result.state.teams.humans[1].hp, 55);
  assert.equal(result.state.teams.humans[3].guardedBy, null);
});

test("the bot makes a legal turn and returns control to the human team", () => {
  const state = createBattleState();
  state.turnSide = "bots";
  const next = botTurn(state);
  assert.equal(next.turnSide, "humans");
  assert.equal(next.turnNumber, 2);
  assert.equal(findMatches(next.board).length, 0);
  assert.ok(findLegalSwaps(next.board).length > 0);
});

test("city battles select the matching boss, portrait, level, and double health", () => {
  for (const [citySlug, definition] of Object.entries(CITY_BOSSES)) {
    const state = createBattleState(() => 0.51, citySlug);
    const boss = state.teams.bots[0];
    const averageLevel = Math.round(state.teams.humans.reduce((sum, character) => sum + character.level, 0) / 4);
    assert.equal(boss.bossId, definition.id);
    assert.equal(boss.name, definition.name);
    assert.equal(boss.cityOfOrigin, definition.cityOfOrigin);
    assert.equal(boss.portrait, definition.portrait);
    assert.equal(boss.level, averageLevel);
    assert.equal(boss.maxHp, averageLevel * BOSS_MOVE_CONFIG.regularHealthPerLevel * BOSS_MOVE_CONFIG.bossHealthMultiplier);
    assert.equal(state.teams.bots[1].maxHp, averageLevel * BOSS_MOVE_CONFIG.regularHealthPerLevel);
  }
  assert.equal(Object.keys(CITY_BOSSES).length, 8);
  for (const citySlug of Object.keys(CITY_BOSSES)) {
    assert.ok(createBattleState(() => 0.51, citySlug).teams.bots[0].bossId, `${citySlug} should start with its own boss`);
  }
});

test("Vampire drains each living player and heals by the actual total drained", () => {
  const state = chargedBoss("gloomhollow");
  const boss = state.teams.bots[0];
  boss.hp = 100;
  state.teams.humans.map((character, index) => { character.hp = [5, 20, 30, 40][index]; });
  const next = botTurn(state, () => 0.5);
  assert.deepEqual(next.teams.humans.map((character) => character.hp), [0, 12, 22, 32]);
  assert.equal(next.teams.bots[0].hp, 129);
  assert.equal(next.teams.bots[0].mana, 0);
  assert.match(next.log[0], /drained 29 HP/);
});

test("Zombie strikes the lowest-health player for the Vampire's total drain and heals", () => {
  const state = chargedBoss("verdant-reach");
  const boss = state.teams.bots[0];
  boss.hp = 100;
  state.teams.humans.map((character, index) => { character.hp = [50, 40, 60, 70][index]; });
  const next = botTurn(state, () => 0.5);
  assert.deepEqual(next.teams.humans.map((character) => character.hp), [50, 8, 60, 70]);
  assert.equal(next.teams.bots[0].hp, 132);
  assert.equal(BOSS_MOVE_CONFIG.zombieDamage, BOSS_MOVE_CONFIG.vampireDamagePerPlayer * 4);
});

test("Ghost hits all players and blocks damage for two human turns", () => {
  const state = chargedBoss("tidewatch");
  const cast = botTurn(state, () => 0.5);
  assert.deepEqual(cast.teams.humans.map((character) => character.hp), [67, 67, 67, 67]);
  assert.equal(cast.teams.bots[0].effects.immuneTurns, 2);

  cast.teams.humans[2].mana = cast.teams.humans[2].skillCost;
  cast.activeIndex.humans = 2;
  const blocked = applySkill(cast, { kind: "character", id: "bots-1" });
  assert.equal(blocked.accepted, true);
  assert.equal(blocked.state.teams.bots[0].hp, cast.teams.bots[0].hp);
  assert.equal(blocked.state.teams.bots[0].effects.immuneTurns, 1);
  assert.match(blocked.state.log[0], /immune to damage/);

  const nextBotTurn = botTurn(blocked.state, () => 0.5);
  const secondBlocked = applySwap({ ...nextBotTurn, board: fourSwordBoard() }, { row: 0, col: 2 }, { row: 1, col: 2 });
  assert.equal(secondBlocked.state.teams.bots[0].hp, cast.teams.bots[0].hp);
  assert.equal(secondBlocked.state.teams.bots[0].effects.immuneTurns, 0);
  const lastBotTurn = botTurn(secondBlocked.state, () => 0.5);
  const vulnerable = applySwap({ ...lastBotTurn, board: fourSwordBoard() }, { row: 0, col: 2 }, { row: 1, col: 2 });
  assert.equal(vulnerable.state.teams.bots[0].hp, cast.teams.bots[0].hp - cast.teams.bots[0].level);
});

test("Dragon splits damage and burns each player for two later turns", () => {
  const cast = botTurn(chargedBoss("drakenspire"), () => 0.5);
  assert.deepEqual(cast.teams.humans.map((character) => character.hp), [67, 67, 67, 67]);
  assert.ok(cast.teams.humans.every((character) => character.effects.burnTurns === 2));
  assert.ok(cast.teams.humans.every((character) => character.effects.burnDelayTurns === 0));

  const firstPlayerTurn = applySwap({ ...cast, board: oneMatchBoard() }, { row: 0, col: 2 }, { row: 1, col: 2 });
  const firstBurn = botTurn(firstPlayerTurn.state, () => 0.5);
  assert.deepEqual(firstBurn.teams.humans.map((character) => character.hp), [65, 65, 65, 65]);
  assert.ok(firstBurn.teams.humans.every((character) => character.effects.burnTurns === 1));

  const secondPlayerTurn = applySwap({ ...firstBurn, board: oneMatchBoard() }, { row: 0, col: 2 }, { row: 1, col: 2 });
  const secondBurn = botTurn(secondPlayerTurn.state, () => 0.5);
  assert.deepEqual(secondBurn.teams.humans.map((character) => character.hp), [63, 63, 63, 63]);
  assert.ok(secondBurn.teams.humans.every((character) => character.effects.burnTurns === 0));
});

test("Wolf hits the team, marks two distinct players scared, and skips the active one", () => {
  const cast = botTurn(chargedBoss("frosthold"), () => 0);
  assert.deepEqual(cast.teams.humans.map((character) => character.hp), [67, 67, 67, 67]);
  assert.deepEqual(cast.teams.humans.map((character) => character.effects.scaredTurns), [1, 1, 0, 0]);
  const skipped = skipScaredTurn(cast);
  assert.equal(skipped.turnSide, "bots");
  assert.equal(skipped.activeIndex.humans, 1);
  assert.equal(skipped.teams.humans[0].effects.scaredTurns, 0);
  assert.equal(skipped.teams.humans[1].effects.scaredTurns, 1);
  assert.match(skipped.log[0], /loses their turn/);
});

test("a city boss still deals the normal four-sword hit", () => {
  const state = createBattleState(() => 0.51, "frosthold");
  state.turnSide = "bots";
  state.activeIndex.bots = 0;
  state.board = fourSwordBoard();
  const result = applySwap(state, { row: 0, col: 2 }, { row: 1, col: 2 });
  assert.equal(result.accepted, true);
  assert.equal(result.state.teams.humans[0].hp, 70);
  assert.equal(result.state.teams.bots[0].hp, result.state.teams.bots[0].maxHp);
});

test("Magma Golem slams one player and halves incoming damage for two turns", () => {
  const state = chargedBoss("cinderpeak");
  const cast = botTurn(state, () => 0);
  assert.deepEqual(cast.teams.humans.map((character) => character.hp), [43, 75, 75, 75]);
  assert.equal(cast.teams.bots[0].effects.armoredTurns, BOSS_MOVE_CONFIG.magmaArmorTurns);
  assert.match(cast.log[0], /slammed Human 1 for 32 damage/);

  cast.teams.humans[2].mana = cast.teams.humans[2].skillCost;
  cast.activeIndex.humans = 2;
  const firstHit = applySkill(cast, { kind: "character", id: "bots-1" });
  assert.equal(firstHit.state.teams.bots[0].hp, 140);
  assert.equal(firstHit.state.teams.bots[0].effects.armoredTurns, 1);
  const betweenTurns = botTurn(firstHit.state, () => 0.5);
  betweenTurns.teams.humans[2].mana = betweenTurns.teams.humans[2].skillCost;
  betweenTurns.activeIndex.humans = 2;
  const secondHit = applySkill(betweenTurns, { kind: "character", id: "bots-1" });
  assert.equal(secondHit.state.teams.bots[0].hp, 130);
  assert.equal(secondHit.state.teams.bots[0].effects.armoredTurns, 0);
  const finalBotTurn = botTurn(secondHit.state, () => 0.5);
  finalBotTurn.teams.humans[2].mana = finalBotTurn.teams.humans[2].skillCost;
  finalBotTurn.activeIndex.humans = 2;
  const unarmoredHit = applySkill(finalBotTurn, { kind: "character", id: "bots-1" });
  assert.equal(unarmoredHit.state.teams.bots[0].hp, 110);
});

test("Treant heals at turn start and locks six gems until two turns pass", () => {
  const state = chargedBoss("oakhaven");
  state.teams.bots[0].hp = 100;
  const originalBoard = state.board.map((row) => [...row]);
  const cast = botTurn(state, () => 0.37);
  assert.equal(cast.teams.bots[0].hp, 100 + BOSS_MOVE_CONFIG.treantTurnHeal);
  assert.equal(cast.vinesTurns, BOSS_MOVE_CONFIG.treantVineTurns);
  assert.equal(cast.lockedGems.length, BOSS_MOVE_CONFIG.treantVineCount);
  assert.equal(new Set(cast.lockedGems.map((cell) => `${cell.row}:${cell.col}`)).size, BOSS_MOVE_CONFIG.treantVineCount);
  assert.ok(cast.lockedGems.every((cell) => cast.board[cell.row][cell.col] === originalBoard[cell.row][cell.col]));
  assert.ok(findLegalSwaps(cast.board, cast.lockedGems).length > 0);
  assert.match(cast.log[0], /vine-locked 6 gems for 2 turns/);

  const locked = cast.lockedGems[0];
  const neighbor = locked.col < COLS - 1 ? { row: locked.row, col: locked.col + 1 } : { row: locked.row, col: locked.col - 1 };
  assert.equal(applySwap(cast, locked, neighbor).accepted, false);

  const firstMove = findLegalSwaps(cast.board, cast.lockedGems)[0];
  const firstHumanTurn = applySwap(cast, firstMove.from, firstMove.to);
  assert.ok(cast.lockedGems.every((cell) => firstHumanTurn.state.board[cell.row][cell.col] === cast.board[cell.row][cell.col]));
  assert.equal(firstHumanTurn.state.vinesTurns, 1);
  assert.equal(firstHumanTurn.state.lockedGems.length, BOSS_MOVE_CONFIG.treantVineCount);
  const firstBotTurn = botTurn(firstHumanTurn.state, () => 0.51);
  assert.equal(firstBotTurn.vinesTurns, 0);
  assert.deepEqual(firstBotTurn.lockedGems, []);
});

test("a vine-locked gem breaks a line and cannot be swapped", () => {
  const board = freshPattern();
  board[0][0] = "red";
  board[0][1] = "red";
  board[0][2] = "red";
  const locked = [{ row: 0, col: 1 }];
  assert.equal(findMatches(board, locked).length, 0);
  assert.ok(findLegalSwaps(board, locked).every((swap) =>
    !locked.some((cell) =>
      (cell.row === swap.from.row && cell.col === swap.from.col) ||
      (cell.row === swap.to.row && cell.col === swap.to.col))));
});

test("Treant heals at the start of every turn even before its mana is full", () => {
  const state = createBattleState(() => 0.51, "oakhaven");
  state.turnSide = "bots";
  state.activeIndex.bots = 0;
  state.teams.bots[0].hp = 100;
  state.teams.bots[0].mana = 0;
  const firstTurn = botTurn(state, () => 0.51);
  assert.equal(firstTurn.teams.bots[0].hp, 100 + BOSS_MOVE_CONFIG.treantTurnHeal);
  assert.ok(firstTurn.teams.bots[0].mana < firstTurn.teams.bots[0].skillCost);
  assert.ok(firstTurn.log.some((message) => /regrew 6 HP/.test(message)));
  const nextTreantTurn = botTurn({
    ...firstTurn,
    turnSide: "bots",
    activeIndex: { ...firstTurn.activeIndex, bots: 0 },
  }, () => 0.51);
  assert.equal(nextTreantTurn.teams.bots[0].hp, 100 + 2 * BOSS_MOVE_CONFIG.treantTurnHeal);
});

test("Fallen Seraph damages the team, drains half current mana, and requests a flash", () => {
  const state = chargedBoss("sunspire");
  state.teams.humans.forEach((character, index) => {
    character.mana = [1, 4, 9, 12][index];
  });
  const next = botTurn(state, () => 0.5);
  assert.deepEqual(next.teams.humans.map((character) => character.hp), [63, 63, 63, 63]);
  assert.deepEqual(next.teams.humans.map((character) => character.mana), [0, 2, 4, 6]);
  assert.equal(next.flashId, 1);
  assert.match(next.log[0], /blinding light hit the team and drained 14 mana/);
});
