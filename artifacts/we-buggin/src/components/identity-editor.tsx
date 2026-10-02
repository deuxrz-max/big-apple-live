import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { getGetEmojiCatalogQueryKey, useGetEmojiCatalog, type EmojiOption } from '@workspace/api-client-react';
import { HEX_RE, IdentityAvatar, emojiImageUrl, type Identity } from '@/lib/identity';

function ColorField({ label, value, onChange, id }: { label: string; value: string; onChange: (v: string) => void; id: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = HEX_RE.test(text);
  return (
    <div>
      <label htmlFor={`${id}-hex`} className="label-mono">{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={value.toLowerCase()}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border-2 border-foreground bg-card p-0.5"
          data-testid={`input-${id}-picker`}
        />
        <input
          id={`${id}-hex`}
          className="field font-mono uppercase"
          value={text}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid}
          onChange={(e) => {
            let v = e.target.value.trim();
            if (v && !v.startsWith('#')) v = `#${v}`;
            setText(v);
            if (HEX_RE.test(v)) onChange(v.toUpperCase());
          }}
          onBlur={() => setText(value)}
          data-testid={`input-${id}-hex`}
        />
      </div>
      {!valid && <p className="mt-1 text-xs text-destructive">Use six hex digits, like #E8187F.</p>}
    </div>
  );
}

const PAGE = 90;

function EmojiPicker({ value, color, onSelect }: { value: string; color: string; onSelect: (id: string) => void }) {
  const { data, isLoading, isError, refetch } = useGetEmojiCatalog({ query: { staleTime: Infinity, queryKey: getGetEmojiCatalogQueryKey() } });
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const groups = useMemo(() => ['all', ...Array.from(new Set((data ?? []).map((e) => e.group)))], [data]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter(
      (e: EmojiOption) => (group === 'all' || e.group === group) && (!s || e.name.toLowerCase().includes(s) || e.id.toLowerCase() === s),
    );
  }, [data, q, group]);
  useEffect(() => setShown(PAGE), [q, group]);
  const picked = data?.find((e) => e.id === value);

  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        <label htmlFor="emoji-search" className="label-mono">OpenMoji library</label>
        <span className="label-mono text-muted-foreground" data-testid="text-emoji-count">{data ? `${list.length} of ${data.length}` : ''}</span>
      </div>
      <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <input
            id="emoji-search"
            type="search"
            className="field pl-9"
            placeholder="Search by name, e.g. grinning"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); onSelect(list[0].id); } }}
            data-testid="input-emoji-search"
          />
        </div>
        <select aria-label="Emoji group" className="field sm:w-52" value={group} onChange={(e) => setGroup(e.target.value)} data-testid="select-emoji-group">
          {groups.map((g) => <option key={g} value={g}>{g === 'all' ? 'All groups' : g}</option>)}
        </select>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Enter in search picks the first match. Tab into the grid and press Space or Enter to choose.</p>
      <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border-2 border-foreground bg-card p-2" data-testid="grid-emoji">
        {isLoading && <div className="grid grid-cols-6 gap-2 sm:grid-cols-9">{Array.from({ length: 27 }).map((_, i) => <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />)}</div>}
        {isError && <div className="p-4 text-center text-sm">Could not load the emoji library. <button type="button" className="font-bold underline" onClick={() => refetch()}>Retry</button></div>}
        {data && list.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nothing matches "{q}". Try a shorter word.</p>}
        <div role="radiogroup" aria-label="Emoji body" className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
          {list.slice(0, shown).map((e) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={e.id === value}
              aria-label={e.name}
              title={e.name}
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
  const set = (p: Partial<Identity>) => onChange({ ...value, ...p });
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
          <legend className="label-mono">Hair</legend>
          <div role="radiogroup" aria-label="Hair style" className="mt-1 grid grid-cols-2 gap-2">
            {(['Male', 'Female'] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={value.gender === g}
                onClick={() => set({ gender: g })}
                className={`btn ${value.gender === g ? 'btn-pink' : ''}`}
                data-testid={`button-gender-${g.toLowerCase()}`}
              >
                <span>{g}</span>
                <span className="text-xs font-normal opacity-80">{g === 'Male' ? 'spiky hair' : 'ponytails'}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField id="body" label="Emoji body color" value={value.color} onChange={(color) => set({ color })} />
          <ColorField id="hair" label="Hair color" value={value.hairColor} onChange={(hairColor) => set({ hairColor })} />
        </div>
        <EmojiPicker value={value.emojiId} color={value.color} onSelect={(emojiId) => set({ emojiId })} />
      </div>
    </div>
  );
}
