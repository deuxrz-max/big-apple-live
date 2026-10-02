import { IdentityAvatar, type Identity } from '@/lib/identity';

const EXPRESSIONS = [
  { id: '1F642', label: 'Smile' },
  { id: '1F606', label: 'Laugh' },
  { id: '1F610', label: 'Neutral' },
  { id: '1F622', label: 'Sad' },
  { id: '1F620', label: 'Angry' },
  { id: '1F62E', label: 'Surprised' },
] as const;

/** These are manually selected static faces, never microphone-driven poses. */
export function ExpressionChoices({ identity, onSelect, disabled = false }: {
  identity: Identity; onSelect: (emojiId: string) => void; disabled?: boolean;
}) {
  return (
    <fieldset>
      <legend className="label-mono">Quick expressions</legend>
      <div role="radiogroup" aria-label="Quick facial expressions" className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {EXPRESSIONS.map((expression) => (
          <button
            key={expression.id}
            type="button"
            role="radio"
            aria-label={expression.label}
            aria-checked={identity.emojiId === expression.id}
            disabled={disabled}
            onClick={() => onSelect(expression.id)}
            className={`flex min-w-0 flex-col items-center rounded-xl border-2 p-2 ${identity.emojiId === expression.id ? 'border-foreground bg-secondary' : 'border-foreground/20 bg-card'}`}
            data-testid={`button-expression-${expression.label.toLowerCase()}`}
          >
            <IdentityAvatar identity={{ ...identity, emojiId: expression.id }} size={70} />
            <span className="text-xs font-bold">{expression.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}