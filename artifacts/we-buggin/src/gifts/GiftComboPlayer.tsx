import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getGetActiveGiftStudioMediaQueryKey, useGetActiveGiftStudioMedia,
  type GiftStudioGiftId, type GiftStudioPlaybackMedia,
} from "@workspace/api-client-react";
import { ShinyName } from "@/components/ShinyName";
import { GiftAnimationPlayer } from "./GiftAnimationPlayer";
import { GiftMiniAnimationCanvas } from "./GiftMiniAnimationCanvas";
import { buildGiftComboPlan, giftCounterAfterLaunch, giftCounterAfterSkip, normalizeGiftQuantity } from "./gift-combo-policy";
import "./gift-combo.css";

export type GiftComboNotice = {
  id: string;
  giftId: string;
  giftName?: string;
  createdAt?: string;
  senderName: string;
  senderUsername?: string;
  senderNameColor?: string | null;
  senderNameTierIndex?: number | null;
  quantity?: number;
  cost?: number;
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export function GiftComboPlayer({ gift, waitingCount, onFinish }: {
  gift: GiftComboNotice;
  waitingCount: number;
  onFinish: (giftId: string) => void;
}) {
  const quantity = normalizeGiftQuantity(gift.quantity ?? 1);
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<"full" | "mini" | "skipped">("full");
  const [counter, setCounter] = useState(1);
  const [fullDurationMs, setFullDurationMs] = useState(6000);
  const [miniStarted, setMiniStarted] = useState(false);
  const fullStartedAt = useRef(typeof performance !== "undefined" ? performance.now() : Date.now());
  const completed = useRef(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const activeMediaQuery = useGetActiveGiftStudioMedia(gift.giftId as GiftStudioGiftId, {
    query: {
      queryKey: getGetActiveGiftStudioMediaQueryKey(gift.giftId as GiftStudioGiftId),
      staleTime: 0,
      refetchOnMount: "always",
      retry: false,
    },
  });
  const customMedia: GiftStudioPlaybackMedia | undefined = activeMediaQuery.data?.media ?? undefined;
  const plan = useMemo(
    () => buildGiftComboPlan(quantity, fullDurationMs, reducedMotion),
    [fullDurationMs, quantity, reducedMotion],
  );
  const giftName = gift.giftName || activeMediaQuery.data?.media?.name || gift.giftId;
  const fullAnimationFinished = useCallback(() => {
    if (completed.current) return;
    const elapsed = Math.max(500, performance.now() - fullStartedAt.current);
    setFullDurationMs(elapsed);
    if (quantity === 1) {
      completed.current = true;
      finishRef.current(gift.id);
      return;
    }
    setPhase("mini");
    setMiniStarted(true);
  }, [gift.id, quantity]);
  const launchUnits = useCallback((amount: number) => {
    setCounter(current => giftCounterAfterLaunch(current, amount, quantity));
  }, [quantity]);
  const skip = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    setCounter(giftCounterAfterSkip(quantity));
    setPhase("skipped");
    window.setTimeout(() => finishRef.current(gift.id), 90);
  }, [gift.id, quantity]);
  const completeMinis = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    finishRef.current(gift.id);
  }, [gift.id]);

  return (
    <>
      {phase === "full" && <GiftAnimationPlayer
        key={gift.id}
        giftId={gift.giftId as GiftStudioGiftId}
        senderName={gift.senderName}
        giftName={giftName}
        senderNameColor={gift.senderNameColor ?? undefined}
        senderNameTierIndex={gift.senderNameTierIndex ?? undefined}
        mediaOverride={customMedia}
        showSenderBanner={false}
        onFinish={fullAnimationFinished}
      />}
      {quantity > 1 && <GiftMiniAnimationCanvas
        key={`${gift.id}-mini`}
        giftId={gift.giftId}
        comboId={gift.id}
        giftName={giftName}
        quantity={quantity}
        plan={plan}
        started={phase === "mini" && miniStarted}
        customMedia={customMedia}
        onUnitsLaunched={launchUnits}
        onFinish={completeMinis}
      />}
      {phase !== "skipped" && createPortal(
        <div className="gift-combo-hud" role="status" aria-live="polite">
          <span className="gift-combo-counter">
            <ShinyName displayNameColor={gift.senderNameColor ?? undefined}
              displayNameTierIndex={gift.senderNameTierIndex ?? undefined}>
              {gift.senderName}
            </ShinyName>
            {" sent "}{giftName}{" "}{counter}/{quantity}
          </span>
          {waitingCount > 0 && <span className="gift-combo-next">Next up · {waitingCount}</span>}
          <button type="button" className="gift-combo-skip" onClick={skip}>Skip</button>
        </div>,
        document.body,
      )}
    </>
  );
}
