import { cityBySlug, type AethelgardCity } from "./aethelgard-cities";

// Home cities are locked to race, not a player-editable preference.
export const RACE_HOME_CITIES: Readonly<Record<string, AethelgardCity["slug"]>> = {
  human: "oakhaven",
  "high elf": "verdant-reach",
  aetherial: "sunspire",
  dwarf: "cinderpeak",
  gnome: "cinderpeak",
  krell: "tidewatch",
  "dark elf": "gloomhollow",
  barbarian: "frosthold",
  troll: "frosthold",
  ogre: "drakenspire",
};

export function raceHomeCitySlug(race?: string | null): AethelgardCity["slug"] | undefined {
  const key = race?.trim().toLowerCase() || "human";
  // Accept race labels in either singular or plural without changing saved races.
  const singular = key.replace(/elves$/, "elf").replace(/dwarves$/, "dwarf").replace(/s$/, "");
  return RACE_HOME_CITIES[singular];
}

export function cardHomeCity(person: {
  race?: string | null;
  bossId?: string;
  cityOfOrigin?: string;
}): AethelgardCity | undefined {
  return cityBySlug(person.bossId
    ? person.cityOfOrigin?.toLowerCase().replace(/\s+/g, "-")
    : raceHomeCitySlug(person.race));
}

// Reserved for future server-verified faction ownership. No controlled city is
// inferred from race or displayed until actual ownership data is implemented.
export type VerifiedFactionCity = { controlledCitySlug: AethelgardCity["slug"] };
