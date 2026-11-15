export const AETHELGARD_CITIES = [
  { slug: 'frosthold', name: 'Frosthold', image: 'battle-assets/cities/frosthold.webp', left: 29, top: 21, description: 'Description coming soon.' },
  { slug: 'drakenspire', name: 'Drakenspire', image: 'battle-assets/cities/drakenspire.webp', left: 58, top: 22, description: 'Description coming soon.' },
  { slug: 'cinderpeak', name: 'Cinderpeak', image: 'battle-assets/cities/cinderpeak.webp', left: 16, top: 44, description: 'Description coming soon.' },
  { slug: 'oakhaven', name: 'Oakhaven', image: 'battle-assets/cities/oakhaven.webp', left: 48, top: 51, description: 'Description coming soon.' },
  { slug: 'tidewatch', name: 'Tidewatch', image: 'battle-assets/cities/tidewatch.webp', left: 82, top: 42, description: 'Description coming soon.' },
  { slug: 'verdant-reach', name: 'Verdant Reach', image: 'battle-assets/cities/verdant-reach.webp', left: 25, top: 78, description: 'Description coming soon.' },
  { slug: 'gloomhollow', name: 'Gloomhollow', image: 'battle-assets/cities/gloomhollow.webp', left: 59, top: 77, description: 'Description coming soon.' },
  { slug: 'sunspire', name: 'Sunspire', image: 'battle-assets/cities/sunspire.webp', left: 82, top: 76, description: 'Description coming soon.' },
] as const;

export type AethelgardCity = (typeof AETHELGARD_CITIES)[number];

export function cityBySlug(slug: string | undefined): AethelgardCity | undefined {
  return AETHELGARD_CITIES.find((city) => city.slug === slug);
}

export function randomAethelgardCity(): AethelgardCity {
  return AETHELGARD_CITIES[Math.floor(Math.random() * AETHELGARD_CITIES.length)]!;
}

export function battleHrefForCity(city: AethelgardCity): string {
  return `/battle?city=${encodeURIComponent(city.slug)}`;
}
