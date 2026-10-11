import './bot-moderation.css';

export function BotShield({ botId }: { botId?: string | null }) {
  if (!botId || !['ghost', 'vampire', 'wolf', 'zombie'].includes(botId)) return null;
  return <img className="bs-shield" src={`${import.meta.env.BASE_URL}streamtalk-shield.svg`} alt="Official Streamtalk moderator bot" title="Official Streamtalk moderator bot" width={16} height={16} />;
}
