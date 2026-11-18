import { Link, Redirect, useParams } from 'wouter';
import { ArrowLeft, Swords } from 'lucide-react';
import { battleHrefForCity, cityBySlug } from './aethelgard-cities';
import { CITY_BOSSES } from './boss-config';
import './city-page.css';

export function CityPage() {
  const params = useParams<{ cityId: string }>();
  const city = cityBySlug(params?.cityId);

  if (!city) return <Redirect to="/home" />;

  const boss = CITY_BOSSES[city.slug];

  return (
    <main className="aethelgard-city-page" data-testid={`city-page-${city.slug}`}>
      <img className="aethelgard-city-hero" src={`${import.meta.env.BASE_URL}${city.image}`}
        alt={`${city.name} in Aethelgard`} fetchPriority="high" />
      <section className="aethelgard-city-content">
        <h1>{city.name}</h1>
        <p>{city.description}</p>
        <div className="aethelgard-city-actions">
          <Link href={battleHrefForCity(city)} className="aethelgard-city-battle" data-testid="button-battle-here">
            <Swords size={18} aria-hidden="true" /> {boss ? `Battle the ${boss.name}` : 'Battle here'}
          </Link>
          <Link href="/" className="aethelgard-city-back" data-testid="link-back-to-map">
            <ArrowLeft size={17} aria-hidden="true" /> Back to map
          </Link>
        </div>
        {boss && (
          <div className="aethelgard-city-boss" data-testid="city-boss-card">
            <img className="aethelgard-city-boss-portrait" src={`${import.meta.env.BASE_URL}${boss.portrait}`}
              alt={`${boss.name} portrait`} loading="lazy" />
            <div className="aethelgard-city-boss-info">
              <strong>{boss.name}</strong>
              <span>Skill: {boss.skillName}</span>
            </div>
            <Link href={battleHrefForCity(city)} className="aethelgard-city-battle aethelgard-city-boss-battle" data-testid="button-boss-battle-here">
              <Swords size={18} aria-hidden="true" /> Battle here
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
