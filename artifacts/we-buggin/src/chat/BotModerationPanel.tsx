import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetModeratorBotFlagsQueryKey, getGetModeratorBotSettingsQueryKey, useAcknowledgeModeratorBotFlag,
  useGetModeratorBotFlags, useGetModeratorBotSettings, useSaveModeratorBotSettings,
} from '@workspace/api-client-react';
import { errMessage } from '@/lib/errors';
import './bot-moderation.css';

export function BotModerationPanel() {
  const qc = useQueryClient();
  const settings = useGetModeratorBotSettings({ query: { queryKey: getGetModeratorBotSettingsQueryKey(), refetchOnWindowFocus: false } });
  const flags = useGetModeratorBotFlags({ query: { queryKey: getGetModeratorBotFlagsQueryKey(), refetchInterval: 15_000 } });
  const save = useSaveModeratorBotSettings();
  const ack = useAcknowledgeModeratorBotFlag();
  const [words, setWords] = useState<string | null>(null);
  const [secs, setSecs] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tried, setTried] = useState(false);
  const s = settings.data;
  const wordsVal = words ?? (s ? s.bannedWords.join('\n') : '');
  const secsVal = secs ?? (s ? String(s.breakSeconds) : '45');
  const list = wordsVal.split('\n').map((x) => x.trim()).filter(Boolean);
  const n = Number(secsVal);
  const wordsErr = list.length > 200 ? 'Use at most 200 entries.' : list.some((x) => x.length < 2 || x.length > 80) ? 'Each entry must be 2-80 characters.' : null;
  const secsErr = !Number.isInteger(n) || n < 15 || n > 600 ? 'Enter a whole number from 15 to 600.' : null;
  const submit = () => {
    setTried(true); setSaved(false);
    if (wordsErr || secsErr || save.isPending) return;
    save.mutate({ data: { bannedWords: list, breakSeconds: n } }, {
      onSuccess: (r) => { qc.setQueryData(getGetModeratorBotSettingsQueryKey(), r); setWords(null); setSecs(null); setTried(false); setSaved(true); },
    });
  };
  const open = (flags.data ?? []).filter((f) => !f.reviewedAt);
  return (
    <section className="bm-bots" aria-labelledby="bm-bots-title" data-testid="panel-bot-moderation">
      <h2 id="bm-bots-title">Moderator bots</h2>
      <p>Bots check public university chat for your banned words and phrases, repeated links and flooding. Violations are hidden and a bot posts a warning; bots never mute or ban anyone. Visits last 60 seconds. Whispers and direct messages are not scanned. Word-list checks can flag quotations and can miss disguised abuse.</p>
      {settings.isLoading && <p role="status">Loading bot settings...</p>}
      {settings.isError && <div className="ch-err" role="alert">Could not load bot settings. <button type="button" className="bm-btn bm-btn-sm" onClick={() => settings.refetch()}>Retry</button></div>}
      {s && (
        <form noValidate className="ch-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label>Banned words and phrases (one per line, up to 200)
            <textarea value={wordsVal} onChange={(e) => { setWords(e.target.value); setSaved(false); }} aria-invalid={tried && !!wordsErr} data-testid="input-bot-words" />
            {tried && wordsErr && <span className="ch-fe" role="alert">{wordsErr}</span>}
          </label>
          <label>Bot break between visits, in seconds (15-600)
            <input type="number" min={15} max={600} step={1} value={secsVal} onChange={(e) => { setSecs(e.target.value); setSaved(false); }} aria-invalid={tried && !!secsErr} data-testid="input-bot-break" />
            {tried && secsErr && <span className="ch-fe" role="alert">{secsErr}</span>}
          </label>
          {save.isError && <div className="ch-err" role="alert">{errMessage(save.error)}</div>}
          {saved && <p role="status">Bot settings saved.</p>}
          <p><button type="submit" className="bm-btn bm-btn-primary" disabled={save.isPending} data-testid="button-save-bot-settings">{save.isPending ? 'Saving...' : 'Save bot settings'}</button></p>
        </form>
      )}
      <h2>Hidden messages to review</h2>
      {flags.isLoading && <p role="status">Loading flagged messages...</p>}
      {flags.isError && <div className="ch-err" role="alert">Could not load flagged messages. <button type="button" className="bm-btn bm-btn-sm" onClick={() => flags.refetch()}>Retry</button></div>}
      {ack.isError && <div className="ch-err" role="alert">{errMessage(ack.error)}</div>}
      {flags.data && open.length === 0 && <p className="ch-note">No flagged messages waiting for review.</p>}
      <ul>
        {open.map((f) => (
          <li key={f.id} className="bm-flag" data-testid={`row-bot-flag-${f.id}`}>
            <span><b style={{ color: f.displayNameColor ?? '#FFFFFF' }}>{f.displayName}</b> (@{f.username}) in {f.roomLabel} · {new Date(f.createdAt).toLocaleString()}</span>
            <span className="ch-note">Reason: {f.reason}</span>
            <q>{f.text}</q>
            <div><button type="button" className="bm-btn bm-btn-sm" disabled={ack.isPending}
              onClick={() => ack.mutate({ flagId: f.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetModeratorBotFlagsQueryKey() }) })}
              data-testid={`button-bot-reviewed-${f.id}`}>Mark reviewed</button></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
