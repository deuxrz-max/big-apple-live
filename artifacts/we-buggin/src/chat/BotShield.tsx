import './bot-moderation.css';
import { LogoImage } from '@/components/brand';

export function BotShield({ botId }: { botId?: string | null }) {
  if (!botId || !['ghost', 'vampire', 'wolf', 'zombie'].includes(botId)) return null;
  return <LogoImage size={16} className="bs-shield" alt="Official Deux Wild moderator bot" title="Official Deux Wild moderator bot" />;
}
