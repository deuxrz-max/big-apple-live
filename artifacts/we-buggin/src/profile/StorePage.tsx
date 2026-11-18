import { useEffect, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { ErrorBox, Loading } from '@/social/common';
import { ProfileCard } from './ProfileCard';
import { ShinyName } from '@/components/ShinyName';
import './store.css';

type StoreItem = {
  id: string; name: string; priceCents: number; available: boolean; owned: boolean; equipped: boolean;
  image?: string; tint?: string; color?: string;
};
type StoreSection = { kind: 'frame' | 'nameColor' | 'specialName'; title: string; items: StoreItem[] };
type StoreData = { sections: StoreSection[]; equipped: { frame: string; nameColor: string; specialName: string | null } };

const endpoint = `${import.meta.env.BASE_URL}api/social/cosmetics/store`;
const previewPrice = (cents: number) => `Preview price: $${(cents / 100).toFixed(2)}`;

export function StorePage() {
  const [data, setData] = useState<StoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not load the Store.');
      setData(body as StoreData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the Store.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const equip = async (kind: StoreSection['kind'], item: StoreItem) => {
    if (!item.owned || item.equipped || pending) return;
    setPending(`${kind}:${item.id}`);
    setError('');
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/social/cosmetics/equip`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, itemId: item.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not equip this item.');
      setData(body as StoreData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not equip this item.');
    } finally { setPending(null); }
  };
  return (
    <main className="store-page">
      <header className="store-header">
        <Link href="/user-portal" className="store-back">Back to Me</Link>
        <h1>Store</h1>
        <p>Profile cosmetics. Payments are not available yet.</p>
      </header>
      {loading && <Loading />}
      {error && !data && <ErrorBox error={error} retry={() => void load()} />}
      {error && data && <p className="store-error" role="alert">{error}</p>}
      {data?.sections.map(section => (
        <section key={section.kind} className="store-section" aria-labelledby={`store-${section.kind}`}>
          <h2 id={`store-${section.kind}`}>{section.title}</h2>
          <div className={`store-grid store-grid-${section.kind}`}>
            {section.items.map(item => (
              <article className={`store-item${item.equipped ? ' is-equipped' : ''}`} key={item.id}>
                {section.kind === 'frame' ? (
                  <div className="store-frame-preview">
                    <ProfileCard person={{ username: 'preview', displayName: 'Your Name', race: 'Human', job: 'Your Job', frameId: item.id }} />
                  </div>
                ) : section.kind === 'nameColor' ? (
                  <div className="store-name-preview" style={{ color: item.color ?? '#fff' }}>Your Name</div>
                ) : (
                  <div className="store-name-preview store-name-shimmer"><ShinyName displayNameColor="#f5f4ef" displayNameTierIndex={1}>Your Name</ShinyName><Sparkles size={16} aria-hidden /></div>
                )}
                <strong>{item.name}</strong>
                <span className="store-price">{item.priceCents === 0 ? 'Included' : previewPrice(item.priceCents)}</span>
                {item.equipped ? <span className="store-state"><Check size={15} /> Equipped</span>
                  : item.owned ? <button type="button" className="store-equip" onClick={() => void equip(section.kind, item)} disabled={pending !== null}>{pending === `${section.kind}:${item.id}` ? 'Equipping…' : 'Equip'}</button>
                  : <button type="button" className="store-coming" disabled>Coming soon</button>}
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
