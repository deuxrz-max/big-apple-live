import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Users, X } from "lucide-react";
import { getGetRoomQueryKey, useCreateAccountRoom, useGetSocialMe } from "@workspace/api-client-react";
import type { RoomSession } from "@workspace/api-client-react";
import { saveCreds } from "@/lib/room-creds";

/** Creates an audio-only social room. */
export function CreateRoomButton({ className, children }: { className: string; children: ReactNode }) {
  const [, navigate] = useLocation();
  const { user } = useUser();
  const qc = useQueryClient();
  const me = useGetSocialMe();
  const createRoom = useCreateAccountRoom();
  const [open, setOpen] = useState(false);
  const [roomTitle, setRoomTitle] = useState("");
  const [attempted, setAttempted] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const username = me.data?.profile?.username ?? "";
  const trimmedTitle = roomTitle.trim();
  const hasWhitespace = /\s/u.test(trimmedTitle);
  const tooLong = trimmedTitle.length > 32;
  const valid = trimmedTitle.length > 0 && !hasWhitespace && !tooLong;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createRoom.isPending) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    dialog.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open, createRoom.isPending]);

  const submit = () => {
    if (!username || !user?.id || createRoom.isPending) return;
    if (!valid) {
      setAttempted(true);
      return;
    }
    createRoom.mutate({ data: { name: trimmedTitle, capacity: 9 } }, {
      onSuccess: (session: RoomSession) => {
        saveCreds(user.id, session.room.roomId, {
          participantSessionId: session.participantSessionId,
          participantId: session.participantId,
        });
        qc.setQueryData(getGetRoomQueryKey(session.room.roomId), session.room);
        setOpen(false);
        navigate(`/rooms/${encodeURIComponent(session.room.roomId)}`);
      },
    });
  };

  return <>
    <button type="button" className={className} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => {
        createRoom.reset();
        setRoomTitle("");
        setAttempted(false);
        setOpen(true);
      }}>
      {children}
    </button>
    {open && <div className="st-room-choice-scrim" onMouseDown={event => {
      if (event.target === event.currentTarget && !createRoom.isPending) setOpen(false);
    }}>
      <section ref={dialog} className="st-room-choice-card" role="dialog" aria-modal="true"
        aria-labelledby="st-room-choice-title" data-testid="dialog-create-room">
        <button type="button" className="st-room-choice-close" aria-label="Close room creation"
          onClick={() => setOpen(false)} disabled={createRoom.isPending}><X size={18} /></button>
        <h2 id="st-room-choice-title">Create a room</h2>
        <form className="st-room-choice-room-form" onSubmit={event => {
          event.preventDefault();
          submit();
        }}>
          <label htmlFor="st-created-room-title">One-word room name</label>
          <input id="st-created-room-title" type="text" value={roomTitle}
            onChange={event => setRoomTitle(event.target.value)} maxLength={64}
            autoComplete="off" spellCheck={false} aria-invalid={hasWhitespace || tooLong || (attempted && !trimmedTitle)}
            data-testid="input-created-room-title" placeholder="For example, Gold" />
          <small className="st-room-title-hint">The sign will add “Ave” automatically.</small>
          {(hasWhitespace || tooLong || (attempted && !trimmedTitle)) && <p className="st-room-choice-error" role="alert">
            {hasWhitespace ? "Use one word only. Ave is added automatically."
              : tooLong ? "Room names must be 32 characters or fewer."
                : "Enter a room name. Ave is added automatically."}
          </p>}
          <button type="submit" className="st-room-choice-option"
            disabled={!username || !user?.id || createRoom.isPending} data-testid="button-create-social-room">
            <span className="st-room-choice-icon"><Users size={22} /></span>
            <span><strong>{createRoom.isPending ? "Creating room…" : "Create Room"}</strong>
              <small>Open a nine-seat social room with chat, gifts, and live audio.</small></span>
          </button>
        </form>
        {!username && (me.isLoading
          ? <p className="st-room-choice-error" role="status">Loading your account…</p>
          : <p className="st-room-choice-error" role="status">Set up your profile to continue. <Link href="/user-portal">Open profile</Link></p>)}
        {createRoom.isError && <p className="st-room-choice-error" role="alert">
          {createRoom.error instanceof Error ? createRoom.error.message : "Could not create your room. Try again."}
        </p>}
      </section>
    </div>}
  </>;
}
