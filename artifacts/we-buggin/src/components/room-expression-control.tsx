import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Smile } from 'lucide-react';
import {
  getMyProfile, getGetMyProfileQueryKey, getGetRoomQueryKey,
  useSaveMyProfile, type RoomState,
} from '@workspace/api-client-react';
import { EmojiPicker } from '@/components/identity-editor';
import { ExpressionChoices } from '@/components/expression-choices';
import { errMessage, type Identity } from '@/lib/identity';

export function RoomExpressionControl({ roomId, participantId, identity, disabled }: {
  roomId: string; participantId: string; identity: Identity; disabled: boolean;
}) {
  const qc = useQueryClient();
  const save = useSaveMyProfile();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const choose = async (emojiId: string) => {
    if (changing || disabled || emojiId === identity.emojiId) return;
    setChanging(true);
    setSaved(false);
    setError(null);
    try {
      // Read the current profile rather than overwrite hair/colors edited in
      // another tab with an old copy. Account ownership stays server-derived.
      const { profile } = await getMyProfile();
      if (!mounted.current) return;
      if (!profile) throw new Error('Save your identity in the portal before choosing an expression.');
      const updated = await save.mutateAsync({
        data: { username: profile.username, identity: { ...profile.identity, emojiId } },
      });
      if (!mounted.current) return;
      qc.setQueryData(getGetMyProfileQueryKey(), { profile: updated });
      // Show the writer's confirmed result even if its presence feed is
      // reconnecting. Other participants/rooms receive the server broadcast.
      qc.setQueryData<RoomState>(getGetRoomQueryKey(roomId), (room) => room && ({
        ...room,
        participants: room.participants.map((p) =>
          p.participantId === participantId ? { ...p, identity: updated.identity } : p),
      }));
      setSaved(true);
    } catch (e) {
      if (mounted.current) setError(errMessage(e, 'Could not save your expression. Please try again.'));
    } finally {
      if (mounted.current) setChanging(false);
    }
  };

  return (
    <section className="sticker mt-4 p-4" aria-label="Your facial expression">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">Your face, your choice. Change it without leaving the room.</p>
        <button
          type="button"
          className="btn btn-yellow"
          disabled={disabled || changing}
          aria-expanded={open}
          aria-controls="room-expression-picker"
          onClick={() => { setOpen((value) => !value); setError(null); setSaved(false); }}
          data-testid="button-change-expression"
        >
          <Smile className="size-4" />{open ? 'Close expressions' : 'Change expression'}
        </button>
      </div>
      {open && (
        <div id="room-expression-picker" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick a face to save it instantly. Your {identity.gender === 'Male' ? 'spiked hair' : 'ponytails'},
            colors, name, and microphone stay unchanged. Everyone in your active rooms sees the new expression.
          </p>
          <ExpressionChoices identity={identity} onSelect={choose} disabled={changing || disabled} />
          <EmojiPicker value={identity.emojiId} color={identity.color} onSelect={choose} facesOnly disabled={changing || disabled} />
          {changing && <p role="status" className="text-sm font-bold">Saving expression...</p>}
          {saved && <p role="status" className="text-sm font-bold" data-testid="text-expression-saved">Expression saved. It stays until you choose another.</p>}
          {error && <p role="alert" className="text-sm font-bold text-destructive" data-testid="text-expression-error">{error}</p>}
          <p className="label-mono text-muted-foreground">Manual changes only. No lip-sync or voice-triggered animation.</p>
        </div>
      )}
    </section>
  );
}