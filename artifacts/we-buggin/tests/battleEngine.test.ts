import test from "node:test";
import assert from "node:assert/strict";
import {
  GEM_TYPES,
  ROWS,
  COLS,
  activeCharacter,
  applySkill,
  applySwap,
  createBattleState,
  createBoard,
  findLegalSwaps,
  findMatches,
  type Board,
} from "../src/battle/battle-engine";

function freshPattern(): Board {
  return Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLS }, (_, col) => GEM_TYPES[(row * 3 + col * 2) % GEM_TYPES.length]));
}

test("the first board is an 8x8 playable grid with no free opening matches", () => {
  const board = createBoard();
  assert.equal(board.length, 8);
  assert.ok(board.every((row) => row.length === 8));
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
  const result = applySkill(ready, { kind: "character", id: "humans-3" });
  assert.equal(result.accepted, true);
  assert.equal(result.state.teams.humans[2].shield, 1);
  assert.equal(result.state.teams.humans[1].mana, 0);
  assert.equal(result.state.turnSide, "bots");
});

test("a charged Ranger can defeat the final enemy and end the battle", () => {
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
