import { useState } from 'react';
import { photoSrc } from '@/components/user-photo';
import { ShinyName } from '@/components/ShinyName';
import { CardCity } from './CardCity';
import './profile-card.css';

const frameFilters: Record<string, string> = {
  bronze: 'sepia(.8) saturate(1.55) hue-rotate(337deg)',
  red: 'sepia(.9) saturate(2.1) hue-rotate(300deg)',
  blue: 'sepia(.9) saturate(2.1) hue-rotate(170deg)',
  green: 'sepia(.9) saturate(1.8) hue-rotate(65deg)',
  gold: 'sepia(1) saturate(2) hue-rotate(350deg)',
};

export function ProfileCard({ person, editable = false }: {
  person: {
    username: string;
    displayName?: string | null;
    photoUrl?: string | null;
    race?: string | null;
    job?: string | null;
    frameId?: string | null;
    displayNameColor?: string | null;
    displayNameTierIndex?: number | null;
  };
  editable?: boolean;
}) {
  const [frameMissing, setFrameMissing] = useState(false);
  const name = person.displayName?.trim() || person.username;
  const frameId = person.frameId || 'grey-starter';
  const preferredFrame = `${import.meta.env.BASE_URL}battle-assets/cards/card_frame_${frameId.replace(/[^a-z-]/g, '')}.png`;
  const starterFrame = `${import.meta.env.BASE_URL}battle-assets/cards/card_frame_grey_starter.png`;
  return (
    <div className="profile-card" data-testid="profile-card">
      {person.photoUrl
        ? <img className="profile-card-photo" src={photoSrc(person.photoUrl)} alt={`${name} profile photo`} />
        : <div className="profile-card-photo profile-card-photo-empty" aria-label={`${name} has no profile photo`}>
            {(name[0] ?? '?').toUpperCase()}
          </div>}
      <div className="profile-card-copy">
        <ShinyName className="profile-card-name" fitOneLine displayNameColor={person.displayNameColor ?? '#f5f4ef'}
          displayNameTierIndex={person.displayNameTierIndex ?? 0}>{name}</ShinyName>
        <span>{person.race || 'Human'}</span>
        <span>{person.job || 'No job yet'}</span>
      </div>
      <img
        className="profile-card-frame"
        src={frameMissing ? starterFrame : preferredFrame}
        alt=""
        aria-hidden="true"
        onError={() => setFrameMissing(true)}
        style={{ filter: frameMissing ? (frameFilters[frameId] ?? 'none') : 'none' }}
      />
      <CardCity race={person.race} />
      {editable && <span className="profile-card-edit-label">Edit profile</span>}
    </div>
  );
}
