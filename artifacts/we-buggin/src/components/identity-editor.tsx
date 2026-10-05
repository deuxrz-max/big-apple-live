import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { getGetEmojiCatalogQueryKey, useGetEmojiCatalog, type EmojiOption } from '@workspace/api-client-react';
import { IdentityAvatar, emojiImageUrl, type Identity } from '@/lib/identity';
import { beamIdentity } from '@/beam/services/beamService';
import { getPortrait, selectAvatarType } from '@/beam/portraits';

const PAGE = 90;

export function EmojiPicker({ value, color, onSelect, facesOnly = false, disabled = false }: {
  value: string; color: string; onSelect: (id: string) => void; facesOnly?: boolean; disabled?: boolean;
}) {
  const { data, isLoading, isError, refetch } = useGetEmojiCatalog({ query: { staleTime: Infinity, queryKey: getGetEmojiCatalogQueryKey() } });
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const groups = useMemo(() => ['all', ...Array.from(new Set((data ?? []).map((e) => e.group)))], [data]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter(
       (e: EmojiOption) => (!facesOnly || (e.group === 'smileys-emotion' && /face|smiling|grinning|laugh|frowning|pouting|angry|crying|rolling on the floor|grimacing|wink|yawning/i.test(e.name)))
         && (facesOnly || group === 'all' || e.group === group)
         && (!s || e.name.toLowerCase().includes(s) || e.id.toLowerCase() === s),
    );
  }, [data, q, group, facesOnly]);
  useEffect(() => setShown(PAGE), [q, group]);
  const picked = data?.find((e) => e.id === value);

  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        <label htmlFor="emoji-search" className="label-mono">{facesOnly ? 'More facial expressions' : 'OpenMoji library'}</label>
        <span className="label-mono text-muted-foreground" data-testid="text-emoji-count">{data ? `${list.length} of ${data.length}` : ''}</span>
      </div>
      <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <input
            id="emoji-search"
            type="search"
            className="field pl-9"
            placeholder={facesOnly ? 'Search expressions, e.g. smiling or angry' : 'Search by name, e.g. grinning'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={disabled}
            onKeyDown={(e) => { if (!disabled && e.key === 'Enter' && list[0]) { e.preventDefault(); onSelect(list[0].id); } }}
            data-testid="input-emoji-search"
          />
        </div>
        {!facesOnly && <select aria-label="Emoji group" className="field sm:w-52" value={group} onChange={(e) => setGroup(e.target.value)} data-testid="select-emoji-group">
          {groups.map((g) => <option key={g} value={g}>{g === 'all' ? 'All groups' : g}</option>)}
        </select>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Enter in search picks the first match. Tab into the grid and press Space or Enter to choose.</p>
      <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border-2 border-foreground bg-card p-2" data-testid="grid-emoji">
        {isLoading && <div className="grid grid-cols-6 gap-2 sm:grid-cols-9">{Array.from({ length: 27 }).map((_, i) => <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />)}</div>}
        {isError && <div className="p-4 text-center text-sm">Could not load the emoji library. <button type="button" className="font-bold underline" onClick={() => refetch()}>Retry</button></div>}
        {data && list.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nothing matches "{q}". Try a shorter word.</p>}
        <div role="radiogroup" aria-label={facesOnly ? 'Facial expression' : 'Emoji body'} className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
          {list.slice(0, shown).map((e) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={e.id === value}
              aria-label={e.name}
              title={e.name}
              disabled={disabled}
              onClick={() => onSelect(e.id)}
              className={`aspect-square rounded-lg border-2 p-1 transition-transform hover:scale-110 ${e.id === value ? 'border-foreground bg-secondary' : 'border-transparent hover:border-foreground/40'}`}
              data-testid={`button-emoji-${e.id}`}
            >
              <img src={emojiImageUrl(e.id, color)} alt="" loading="lazy" className="size-full" />
            </button>
          ))}
        </div>
        {shown < list.length && (
          <button type="button" className="btn mt-3 w-full" onClick={() => setShown((n) => n + PAGE)} data-testid="button-emoji-more">
            Show more ({list.length - shown} left)
          </button>
        )}
      </div>
      {picked && <p className="mt-2 text-sm">Selected: <strong>{picked.name}</strong> <span className="label-mono text-muted-foreground">{picked.id}</span></p>}
    </div>
  );
}

export function IdentityEditor({ value, onChange }: { value: Identity; onChange: (v: Identity) => void }) {
  const avatarType = (gender: Identity['gender']): Identity => {
    if (value.gender === gender) return value;
    const selected = selectAvatarType(beamIdentity(value), gender === 'Male' ? 'spiked' : 'ponytails');
    const portrait = getPortrait(selected);
    return {
      ...value, gender, portraitId: portrait.id, currentMood: selected.currentMood,
      emojiId: [...portrait.emoji].map(c => c.codePointAt(0)!.toString(16).toUpperCase()).join('-'),
    };
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="sticker grid place-items-center bg-secondary/40 p-4">
          <IdentityAvatar identity={value} size={220} />
          <p className="label-mono mt-1">Static. It never reacts to your voice.</p>
        </div>
      </div>
      <div className="space-y-5">
        <fieldset>
          <legend className="label-mono">Choose your avatar type</legend>
          <div role="radiogroup" aria-label="Avatar type" className="mt-1 grid grid-cols-2 gap-2">
            {(['Male', 'Female'] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={value.gender === g}
                aria-label={g === 'Male' ? 'Male / Spiky hair' : 'Female / Ponytail'}
                onClick={() => onChange(avatarType(g))}
                className={`btn flex-col py-4 ${value.gender === g ? 'btn-pink' : ''}`}
                data-testid={`button-gender-${g.toLowerCase()}`}
              >
                <IdentityAvatar identity={avatarType(g)} size={80} />
                <span>{g === 'Male' ? 'Male / Spiky hair' : 'Female / Ponytail'}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
