import './bot-moderation.css';
import { LogoImage } from '@/components/brand';

export function BotShield({ botId }: { botId?: string | null }) {
  if (!botId || !['ghost', 'vampire', 'wolf', 'zombie'].includes(botId)) return null;
  return <LogoImage size={16} className="bs-shield" alt="Official Big Apple Live moderator bot" title="Official Big Apple Live moderator bot" />;
}
