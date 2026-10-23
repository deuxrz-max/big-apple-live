import { BotShield } from './BotShield';

/** Inline content lets a bot's name and action wrap as one ordinary sentence. */
export function BotActivityLine({ botId, name, body, chatter = false, arrived = false }: {
  botId: string; name: string; body: string; chatter?: boolean; arrived?: boolean;
}) {
  return <span className="ur-bot-activity">
    <BotShield botId={botId} />{' '}
    <span className="ch-sender">{name}</span>{' '}
    {chatter && <><span className="ur-bot-tag" aria-label="Bot account">BOT</span>{' '}</>}
    {arrived ? <>has <strong className="ur-arrived-word">arrived</strong></> : <span>{body}</span>}
  </span>;
}
