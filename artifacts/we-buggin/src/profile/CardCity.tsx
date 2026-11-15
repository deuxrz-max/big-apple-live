import { cityBySlug } from "@/battle/aethelgard-cities";
import { raceHomeCitySlug } from "@/battle/race-home-cities";
import "./card-city.css";

export function CardCity({ race }: { race?: string | null }) {
  const city = cityBySlug(raceHomeCitySlug(race));
  if (!city) return null;
  return (
    <span className="card-home-city" role="img" aria-label={`Home city: ${city.name}`} title={city.name}>
      <img src={`${import.meta.env.BASE_URL}${city.image}`} alt="" />
    </span>
  );
}
