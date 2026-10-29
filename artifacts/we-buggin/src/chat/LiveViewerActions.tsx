import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Forward, Gift, Heart, MessageCircleMore, Share2, X } from "lucide-react";
import { useLocation } from "wouter";
import {
  addLiveStreamHeart,
  addLiveStreamShare,
  getGetFavoritesGalleryQueryKey,
  useGetFavoritesGallery,
  useSendSocialMessage,
  type FavoriteGalleryEntry,
  type LiveStreamEngagement,
} from "@workspace/api-client-react";

const appBase = import.meta.env.BASE_URL;

function compactCount(count: number) {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count);
}

export function LiveViewerActions({
  streamId,
  hostUsername,
  hostDisplayName,
  isPk,
  engagement,
  onEngagement,
  onOpenGifts,
}: {
  streamId: string;
  hostUsername: string;
  hostDisplayName: string;
  isPk: boolean;
  engagement: LiveStreamEngagement;
  onEngagement: (engagement: LiveStreamEngagement) => void;
  onOpenGifts: () => void;
}) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [heartStatus, setHeartStatus] = useState("");
  const [pulseId, setPulseId] = useState(0);
  const [sendingTo, setSendingTo] = useState("");
  const gallery = useGetFavoritesGallery({
    query: {
      queryKey: getGetFavoritesGalleryQueryKey(),
      enabled: shareOpen,
    },
  });
  const sendMessage = useSendSocialMessage();

  const streamUrl = () => {
    const path = appBase.endsWith("/") ? appBase : `${appBase}/`;
    return new URL(`${path}live/${encodeURIComponent(streamId)}`, window.location.origin).toString();
  };

  const recordShare = async () => {
    try {
      const updated = await addLiveStreamShare(streamId, { credentials: "include" });
      onEngagement(updated);
      return true;
    } catch {
      setShareStatus("Shared, but the count could not be updated.");
      return false;
    }
  };

  const heart = async () => {
    setHeartStatus("");
    setPulseId(value => value + 1);
    try {
      onEngagement(await addLiveStreamHeart(streamId, { credentials: "include" }));
    } catch {
      setHeartStatus("Could not record your heart. Try again.");
    }
  };

  const shareOutsideApp = async () => {
    setShareStatus("");
    const url = streamUrl();
    try {
      let successMessage: string;
      if (navigator.share) {
        await navigator.share({
          title: `${hostDisplayName} is live on Big Apple Live`,
          text: `Watch ${hostDisplayName} live`,
          url,
        });
        successMessage = "Shared using your phone’s share menu.";
      } else {
        await navigator.clipboard.writeText(url);
        successMessage = "Stream link copied.";
      }
      const counted = await recordShare();
      if (counted) setShareStatus(successMessage);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareStatus("Could not share this live. Try again.");
    }
  };

  const shareWithPerson = async (person: FavoriteGalleryEntry["person"]) => {
    setSendingTo(person.username);
    setShareStatus("");
    try {
      const url = streamUrl();
      await sendMessage.mutateAsync({
        username: person.username,
        data: {
          body: `${hostDisplayName} is live on Big Apple Live: ${url}`,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      await queryClient.invalidateQueries({
        predicate: query => String(query.queryKey[0]).startsWith("/api/social"),
      });
      const counted = await recordShare();
      if (counted) setShareStatus(`Shared with ${person.displayName || person.username}.`);
    } catch {
      setShareStatus("Couldn't send this live. Their privacy settings may limit new messages.");
    } finally {
      setSendingTo("");
    }
  };

  const people = (gallery.data ?? []).filter(entry =>
    entry.person.username.toLowerCase() !== hostUsername.toLowerCase() && !entry.person.blocked,
  );

  return <>
    <aside
      className={`st-live-action-rail${isPk ? " is-pk" : ""}`}
      aria-label="Live broadcast actions"
      data-testid={isPk ? "pk-live-action-rail" : "live-action-rail"}
    >
      <button type="button" className="st-live-action-button st-live-heart-button"
        aria-label={`Heart this broadcast, ${engagement.hearts} hearts`} onClick={() => void heart()}>
        <span className="st-live-action-icon-wrap">
          <Heart key={pulseId} size={27} strokeWidth={2.3} fill="#ff3857" aria-hidden="true" />
          {pulseId > 0 && <span key={pulseId} className="st-live-heart-float" aria-hidden="true"><Heart size={17} fill="#ff3857" /></span>}
        </span>
        <small>{compactCount(engagement.hearts)}</small>
      </button>
      <button type="button" className="st-live-action-button"
        aria-label={`Message ${hostDisplayName} privately`} onClick={() => navigate(`/community/messages/${encodeURIComponent(hostUsername)}`)}>
        <MessageCircleMore size={25} strokeWidth={2.2} aria-hidden="true" />
        <small>DM</small>
      </button>
      <button type="button" className="st-live-action-button"
        aria-label="Share this live broadcast" onClick={() => { setShareStatus(""); setShareOpen(true); }}>
        <Forward size={27} strokeWidth={2.2} aria-hidden="true" />
        <small>{compactCount(engagement.shares)}</small>
      </button>
      <button type="button" className="st-live-action-button"
        aria-label="Open gifts" data-testid="button-live-action-gift" onClick={onOpenGifts}>
        <Gift size={25} strokeWidth={2.2} aria-hidden="true" />
        <small>Gift</small>
      </button>
      {heartStatus && <span className="st-live-action-status" role="status">{heartStatus}</span>}
    </aside>

    {shareOpen && <div className="st-live-share-scrim" onClick={() => setShareOpen(false)}>
      <section className="st-live-share-sheet" role="dialog" aria-modal="true" aria-label={`Share ${hostDisplayName}'s live`}
        onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <h2>Share this live</h2>
            <p>{hostDisplayName}</p>
          </div>
          <button type="button" className="st-live-share-close" aria-label="Close sharing" onClick={() => setShareOpen(false)}>
            <X size={20} />
          </button>
        </header>
        <button type="button" className="st-live-share-external" onClick={() => void shareOutsideApp()}>
          <Share2 size={18} aria-hidden="true" /> Share with phone apps
        </button>
        <h3>People you follow</h3>
        {gallery.isLoading ? <p className="st-live-share-empty" role="status">Loading people…</p>
          : gallery.isError ? <p className="st-live-share-empty" role="alert">Could not load people to share with.</p>
          : people.length === 0 ? <p className="st-live-share-empty">No available people to share with yet.</p>
          : <div className="st-live-share-people">
            {people.map(({ person }) => <button key={person.username} type="button"
              onClick={() => void shareWithPerson(person)} disabled={Boolean(sendingTo)}
              data-testid={`live-share-person-${person.username}`}>
              <span className="st-live-share-photo">
                {person.photoUrl ? <img src={person.photoUrl} alt="" /> : <b>{person.displayName?.[0] || person.username[0]?.toUpperCase()}</b>}
              </span>
              <span className="st-live-share-person-name">{person.displayName || person.username}</span>
              <span className="st-live-share-send">{sendingTo === person.username ? "Sending…" : "Send"}</span>
            </button>)}
          </div>}
        {shareStatus && <p className="st-live-share-status" role="status">{shareStatus}</p>}
      </section>
    </div>}
  </>;
}
