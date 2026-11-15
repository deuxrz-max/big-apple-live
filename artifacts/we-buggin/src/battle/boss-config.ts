import type { ManaGem } from "./battle-engine";

export type BossId =
  | "vampire"
  | "wolf"
  | "ghost"
  | "zombie"
  | "dragon"
  | "magma-golem"
  | "treant"
  | "fallen-seraph";

export const CITY_BOSSES: Record<string, {
  id: BossId;
  name: string;
  cityOfOrigin: string;
  portrait: string;
  manaGem: ManaGem;
  skillName: string;
}> = {
  gloomhollow: {
    id: "vampire",
    name: "Vampire Bot",
    cityOfOrigin: "Gloomhollow",
    portrait: "battle-assets/bosses/vampire_bot.webp",
    manaGem: "red",
    skillName: "Blood Drain",
  },
  frosthold: {
    id: "wolf",
    name: "Wolf Bot",
    cityOfOrigin: "Frosthold",
    portrait: "battle-assets/bosses/wolf_bot.webp",
    manaGem: "green",
    skillName: "Howl",
  },
  tidewatch: {
    id: "ghost",
    name: "Ghost Bot",
    cityOfOrigin: "Tidewatch",
    portrait: "battle-assets/bosses/ghost_bot.webp",
    manaGem: "blue",
    skillName: "Veil",
  },
  "verdant-reach": {
    id: "zombie",
    name: "Zombie Bot",
    cityOfOrigin: "Verdant Reach",
    portrait: "battle-assets/bosses/zombie_bot.webp",
    manaGem: "brown",
    skillName: "Grave Strike",
  },
  drakenspire: {
    id: "dragon",
    name: "Dragon Bot",
    cityOfOrigin: "Drakenspire",
    portrait: "battle-assets/bosses/dragon_bot.webp",
    manaGem: "orange",
    skillName: "Firestorm",
  },
  cinderpeak: {
    id: "magma-golem",
    name: "Magma Golem Bot",
    cityOfOrigin: "Cinderpeak",
    portrait: "battle-assets/bosses/magma_golem_bot.webp",
    manaGem: "orange",
    skillName: "Molten Slam",
  },
  oakhaven: {
    id: "treant",
    name: "Treant Bot",
    cityOfOrigin: "Oakhaven",
    portrait: "battle-assets/bosses/treant_bot.webp",
    manaGem: "green",
    skillName: "Vine Lock",
  },
  sunspire: {
    id: "fallen-seraph",
    name: "Fallen Seraph Bot",
    cityOfOrigin: "Sunspire",
    portrait: "battle-assets/bosses/fallen_seraph_bot.webp",
    manaGem: "yellow",
    skillName: "Blinding Light",
  },
};

/** All boss tuning values live here. Vampire drain and Zombie damage stay matched. */
const VAMPIRE_DAMAGE_PER_PLAYER = 8;
const HUMAN_TEAM_SIZE = 4;

export const BOSS_MOVE_CONFIG = {
  regularHealthPerLevel: 15,
  bossHealthMultiplier: 2,
  manaCost: 12,
  vampireDamagePerPlayer: VAMPIRE_DAMAGE_PER_PLAYER,
  vampireHealPerDamage: 1,
  zombieDamage: VAMPIRE_DAMAGE_PER_PLAYER * HUMAN_TEAM_SIZE,
  zombieHealPerDamage: 1,
  ghostDamagePerPlayer: 8,
  ghostImmunityTurns: 2,
  dragonTotalDamage: 32,
  dragonBurnDamagePerTurn: 2,
  dragonBurnTurns: 2,
  dragonBurnDelayTurns: 1,
  wolfDamagePerPlayer: 8,
  wolfScaredPlayers: 2,
  wolfScaredTurns: 1,
  magmaDamage: 32,
  magmaArmorTurns: 2,
  magmaArmorDamageMultiplier: 0.5,
  treantTurnHeal: 6,
  treantVineCount: 6,
  treantVineTurns: 2,
  fallenSeraphDamagePerPlayer: 12,
  fallenSeraphManaDrainRatio: 0.5,
  fallenSeraphFlashDurationMs: 480,
} as const;
