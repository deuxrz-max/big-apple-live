export const AETHELGARD_CITIES = [
  { slug: 'frosthold', name: 'Frosthold', image: 'battle-assets/cities/frosthold.webp', left: 19, top: 20, description: 'The Frozen North — home of the Wolf Bot.' },
  { slug: 'drakenspire', name: 'Drakenspire', image: 'battle-assets/cities/drakenspire.webp', left: 54, top: 22, description: 'The Dragon Perch — home of the Dragon Bot.' },
  { slug: 'cinderpeak', name: 'Cinderpeak', image: 'battle-assets/cities/cinderpeak.webp', left: 11, top: 44, description: 'The Burning Mountain — home of the Magma Golem Bot.' },
  { slug: 'oakhaven', name: 'Oakhaven', image: 'battle-assets/cities/oakhaven.webp', left: 48, top: 53, description: 'The Crossroads — home of the Treant Bot.' },
  { slug: 'tidewatch', name: 'Tidewatch', image: 'battle-assets/cities/tidewatch.webp', left: 83, top: 43, description: 'The Haunted Shore — home of the Ghost Bot.' },
  { slug: 'verdant-reach', name: 'Verdant Reach', image: 'battle-assets/cities/verdant-reach.webp', left: 18, top: 80, description: 'The Overgrown Wilds — home of the Zombie Bot.' },
  { slug: 'gloomhollow', name: 'Gloomhollow', image: 'battle-assets/cities/gloomhollow.webp', left: 59, top: 80, description: 'The Shadowed Hollow — home of the Vampire Bot.' },
  { slug: 'sunspire', name: 'Sunspire', image: 'battle-assets/cities/sunspire.webp', left: 84, top: 85, description: 'The Fallen Spire — home of the Fallen Seraph Bot.' },
] as const;

export type AethelgardCity = (typeof AETHELGARD_CITIES)[number];

export function cityBySlug(slug: string | undefined): AethelgardCity | undefined {
  return AETHELGARD_CITIES.find((city) => city.slug === slug);
}

export function randomAethelgardCity(): AethelgardCity {
  return AETHELGARD_CITIES[Math.floor(Math.random() * AETHELGARD_CITIES.length)]!;
}

/** City of the day: rotates through the eight cities by day-of-year. No backend needed. */
export function dailyAethelgardCity(date = new Date()): AethelgardCity {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  return AETHELGARD_CITIES[dayOfYear % AETHELGARD_CITIES.length]!;
}

export function battleHrefForCity(city: AethelgardCity): string {
  return `/battle?city=${encodeURIComponent(city.slug)}`;
}
