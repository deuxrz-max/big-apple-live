import { Link, Redirect, useParams } from 'wouter';
import { ArrowLeft, Swords } from 'lucide-react';
import { battleHrefForCity, cityBySlug } from './aethelgard-cities';
import './city-page.css';

export function CityPage() {
  const params = useParams<{ cityId: string }>();
  const city = cityBySlug(params?.cityId);

  if (!city) return <Redirect to="/home" />;

  return (
    <main className="aethelgard-city-page" data-testid={`city-page-${city.slug}`}>
      <img className="aethelgard-city-hero" src={`${import.meta.env.BASE_URL}${city.image}`}
        alt={`${city.name} in Aethelgard`} fetchPriority="high" />
      <section className="aethelgard-city-content">
        <h1>{city.name}</h1>
        <p>{city.description}</p>
        <div className="aethelgard-city-actions">
          <Link href={battleHrefForCity(city)} className="aethelgard-city-battle" data-testid="button-battle-here">
            <Swords size={18} aria-hidden="true" /> Battle here
          </Link>
          <Link href="/" className="aethelgard-city-back" data-testid="link-back-to-map">
            <ArrowLeft size={17} aria-hidden="true" /> Back to map
          </Link>
        </div>
      </section>
    </main>
  );
}
