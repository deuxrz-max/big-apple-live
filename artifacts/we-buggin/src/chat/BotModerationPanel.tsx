import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetModeratorBotFlagsQueryKey, getGetModeratorBotSettingsQueryKey, useAcknowledgeModeratorBotFlag,
  getGetModeratorBotChatterSettingsQueryKey, useGetModeratorBotChatterSettings, useGetModeratorBotFlags,
  useGetModeratorBotSettings, useSaveModeratorBotChatterSettings, useSaveModeratorBotSettings,
  type ModeratorBotChatterSettings,
} from '@workspace/api-client-react';
import { errMessage } from '@/lib/errors';
import './bot-moderation.css';
import { ShinyName } from '@/components/ShinyName';

export function BotModerationPanel() {
  const qc = useQueryClient();
  const settings = useGetModeratorBotSettings({ query: { queryKey: getGetModeratorBotSettingsQueryKey(), refetchOnWindowFocus: false } });
  const chatter = useGetModeratorBotChatterSettings({ query: { queryKey: getGetModeratorBotChatterSettingsQueryKey(), refetchOnWindowFocus: false } });
  const flags = useGetModeratorBotFlags({ query: { queryKey: getGetModeratorBotFlagsQueryKey(), refetchInterval: 15_000 } });
  const save = useSaveModeratorBotSettings();
  const saveChatter = useSaveModeratorBotChatterSettings();
  const ack = useAcknowledgeModeratorBotFlag();
  const [words, setWords] = useState<string | null>(null);
  const [secs, setSecs] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tried, setTried] = useState(false);
  const [chatterDraft, setChatterDraft] = useState<ModeratorBotChatterSettings | null>(null);
  const [chatterTried, setChatterTried] = useState(false);
  const [chatterSaved, setChatterSaved] = useState(false);
  const s = settings.data;
  const chatterValue = chatterDraft ?? chatter.data;
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
  const updateChatter = (update: (current: ModeratorBotChatterSettings) => ModeratorBotChatterSettings) => {
    if (!chatterValue) return;
    setChatterDraft(update(chatterValue));
    setChatterSaved(false);
  };
  const chatterErrors = (chatterValue?.bots ?? []).flatMap((bot) => {
    const count = bot.lines.map(line => line.trim()).filter(Boolean).length;
    const errors: string[] = [];
    if (!bot.name.trim() || bot.name.trim().length > 40 || !bot.personality.trim() || bot.personality.trim().length > 140)
      errors.push(`${bot.name || bot.id}: enter a name (40 characters max) and personality (140 max).`);
    if (count < 20 || count > 30) errors.push(`${bot.name || bot.id}: use 20–30 lines.`);
    if (bot.lines.some(line => line.trim().split(/\s+/u).filter(Boolean).length > 14))
      errors.push(`${bot.name || bot.id}: keep each line to 14 words or fewer.`);
    if (bot.lines.some(line => line.length > 160)) errors.push(`${bot.name || bot.id}: keep each line to 160 characters or fewer.`);
    return errors;
  });
  const saveChatterConfig = () => {
    setChatterTried(true);
    setChatterSaved(false);
    if (!chatterValue || chatterErrors.length || saveChatter.isPending) return;
    const payload: ModeratorBotChatterSettings = {
      ...chatterValue,
      bots: chatterValue.bots.map(bot => ({
        ...bot,
        name: bot.name.trim(),
        personality: bot.personality.trim(),
        lines: bot.lines.map(line => line.trim()).filter(Boolean),
      })),
    };
    saveChatter.mutate({ data: payload }, {
      onSuccess: (result) => {
        qc.setQueryData(getGetModeratorBotChatterSettingsQueryKey(), result);
        setChatterDraft(result);
        setChatterTried(false);
        setChatterSaved(true);
      },
    });
  };
  const open = (flags.data ?? []).filter((f) => !f.reviewedAt);
  return (
    <section className="bm-bots" aria-labelledby="bm-bots-title" data-testid="panel-bot-moderation">
      <h2 id="bm-bots-title">Moderator bots</h2>
      <p>Bots hide messages with these words and post a warning.</p>
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
      <section className="bm-chatter" aria-labelledby="bm-chatter-title" data-testid="panel-bot-chatter">
        <div className="bm-chatter-heading">
          <div>
            <h3 id="bm-chatter-title">Bot chatter</h3>
            <p>Friendly one-liners only in active rooms; moderation warnings are separate.</p>
          </div>
          {chatterValue && (
            <label className="bm-chatter-toggle">
              <input
                type="checkbox"
                checked={chatterValue.enabled}
                onChange={(event) => updateChatter(current => ({ ...current, enabled: event.target.checked }))}
                data-testid="toggle-bot-chatter"
              />
              <span>{chatterValue.enabled ? 'On' : 'Off'}</span>
            </label>
          )}
        </div>
        {chatter.isLoading && <p role="status">Loading chatter settings...</p>}
        {chatter.isError && <div className="ch-err" role="alert">Could not load chatter settings. <button type="button" className="bm-btn bm-btn-sm" onClick={() => chatter.refetch()}>Retry</button></div>}
        {chatterValue && (
          <>
            <label className="bm-chatter-frequency">Frequency
              <select
                value={chatterValue.frequency}
                onChange={(event) => updateChatter(current => ({ ...current, frequency: event.target.value as ModeratorBotChatterSettings['frequency'] }))}
                data-testid="select-bot-chatter-frequency"
              >
                <option value="rare">Rare · 8–10 minutes</option>
                <option value="normal">Normal · 6–9 minutes</option>
                <option value="often">Often · 5–7 minutes</option>
              </select>
            </label>
            <div className="bm-chatter-profiles">
              {chatterValue.bots.map((bot, index) => (
                <details className="bm-chatter-profile" key={bot.id} open={index === 0}>
                  <summary>
                    <strong>{bot.name}</strong>
                    <span>{bot.personality}</span>
                  </summary>
                  <div className="bm-chatter-fields">
                    <label>Bot name
                      <input
                        maxLength={40}
                        value={bot.name}
                        onChange={(event) => updateChatter(current => ({
                          ...current,
                          bots: current.bots.map(item => item.id === bot.id ? { ...item, name: event.target.value } : item),
                        }))}
                        data-testid={`input-bot-chatter-name-${bot.id}`}
                      />
                    </label>
                    <label>Personality
                      <input
                        maxLength={140}
                        value={bot.personality}
                        onChange={(event) => updateChatter(current => ({
                          ...current,
                          bots: current.bots.map(item => item.id === bot.id ? { ...item, personality: event.target.value } : item),
                        }))}
                        data-testid={`input-bot-chatter-personality-${bot.id}`}
                      />
                    </label>
                    <label>One line per comment · 20–30 lines · 14 words max each
                      <textarea
                        className="bm-chatter-lines"
                        value={bot.lines.join('\n')}
                        onChange={(event) => updateChatter(current => ({
                          ...current,
                          bots: current.bots.map(item => item.id === bot.id ? {
                            ...item,
                            lines: event.target.value.split('\n'),
                          } : item),
                        }))}
                        data-testid={`textarea-bot-chatter-lines-${bot.id}`}
                      />
                    </label>
                    <p className="bm-chatter-count">{bot.lines.filter(line => line.trim()).length} lines · under 15 words each</p>
                  </div>
                </details>
              ))}
            </div>
            {chatterTried && chatterErrors.length > 0 && <p className="bm-chatter-error" role="alert">{chatterErrors.join(' ')}</p>}
            {saveChatter.isError && <div className="ch-err" role="alert">{errMessage(saveChatter.error)}</div>}
            {chatterSaved && <p className="bm-chatter-saved" role="status">Chatter settings saved.</p>}
            <button
              type="button"
              className="bm-btn bm-btn-primary"
              disabled={saveChatter.isPending || !chatterValue}
              onClick={saveChatterConfig}
              data-testid="button-save-bot-chatter"
            >{saveChatter.isPending ? 'Saving...' : 'Save chatter settings'}</button>
          </>
        )}
      </section>
      <h2>Hidden messages to review</h2>
      {flags.isLoading && <p role="status">Loading flagged messages...</p>}
      {flags.isError && <div className="ch-err" role="alert">Could not load flagged messages. <button type="button" className="bm-btn bm-btn-sm" onClick={() => flags.refetch()}>Retry</button></div>}
      {ack.isError && <div className="ch-err" role="alert">{errMessage(ack.error)}</div>}
      {flags.data && open.length === 0 && <p className="ch-note">No flagged messages waiting for review.</p>}
      <ul>
        {open.map((f) => (
          <li key={f.id} className="bm-flag" data-testid={`row-bot-flag-${f.id}`}>
            <span><b><ShinyName displayNameColor={f.displayNameColor} displayNameTierIndex={f.displayNameTierIndex}>{f.displayName}</ShinyName></b> (@{f.username}) in {f.roomLabel} · {new Date(f.createdAt).toLocaleString()}</span>
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
