import { useEffect, useRef, type ReactNode } from "react";
import { CARD_FINISH_REST, computeCardFinishPose, stepCardFinishPose, type CardFinishPose } from "./card-surface-finish";
import "./card-surface-finish.css";

/**
 * Reusable finish wrapper. premium=false renders children untouched (plain span pass-through).
 * premium=true adds satin/cardstock layers and a restrained tilt driven by RAF style writes
 * (no React state per pointer event).
 */
export function CardSurfaceFinish({ premium = false, children }: { premium?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!premium || !el) return;
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let cur: CardFinishPose = CARD_FINISH_REST, target: CardFinishPose = CARD_FINISH_REST, raf = 0;
    const write = (p: CardFinishPose) => {
      const s = el.style;
      s.setProperty("--cf-rx", `${p.rx.toFixed(2)}deg`); s.setProperty("--cf-ry", `${p.ry.toFixed(2)}deg`);
      s.setProperty("--cf-lx", `${p.lx.toFixed(1)}%`); s.setProperty("--cf-ly", `${p.ly.toFixed(1)}%`);
      s.setProperty("--cf-light-x", `${((p.lx - 50) * .22).toFixed(2)}%`);
      s.setProperty("--cf-light-y", `${((p.ly - 50) * .18).toFixed(2)}%`);
      s.setProperty("--cf-scale", p.scale.toFixed(4));
    };
    const tick = () => {
      const r = stepCardFinishPose(cur, target, mq?.matches ? 1 : 0.22);
      cur = r.pose; write(cur);
      raf = r.settled ? 0 : requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const move = (e: PointerEvent) => { target = computeCardFinishPose(e.clientX, e.clientY, el.getBoundingClientRect(), !!mq?.matches); kick(); };
    const leave = () => { target = CARD_FINISH_REST; kick(); };
    write(cur);
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerdown", move, { passive: true });
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointercancel", leave);
    el.addEventListener("pointerup", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerdown", move);
      el.removeEventListener("pointerleave", leave); el.removeEventListener("pointercancel", leave); el.removeEventListener("pointerup", leave);
    };
  }, [premium]);
  if (!premium) return <>{children}</>;
  return (
    <span ref={ref} className="dw-cf is-premium" data-testid="card-finish-premium">
      <span className="dw-cf-body">
        {children}
        <span className="dw-cf-satin" aria-hidden="true" />
        <span className="dw-cf-light" aria-hidden="true" />
        <span className="dw-cf-edge" aria-hidden="true" />
      </span>
    </span>
  );
}
