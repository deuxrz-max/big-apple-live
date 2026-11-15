import { cityBySlug, type AethelgardCity } from "./aethelgard-cities";

// Home cities are locked to race, not a player-editable preference.
export const RACE_HOME_CITIES: Readonly<Record<string, AethelgardCity["slug"]>> = {
  human: "oakhaven",
};

export function raceHomeCitySlug(race?: string | null): AethelgardCity["slug"] | undefined {
  const key = race?.trim().toLowerCase() || "human";
  return RACE_HOME_CITIES[key === "humans" ? "human" : key];
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
