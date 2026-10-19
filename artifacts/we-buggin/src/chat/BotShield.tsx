import './bot-moderation.css';
import { BRAND_LOGO_PATH } from '@/components/brand';

export function BotShield({ botId }: { botId?: string | null }) {
  if (!botId || !['ghost', 'vampire', 'wolf', 'zombie'].includes(botId)) return null;
  return <img className="bs-shield" src={BRAND_LOGO_PATH} alt="Official Deux Wild moderator bot" title="Official Deux Wild moderator bot" width={16} height={16} />;
}
