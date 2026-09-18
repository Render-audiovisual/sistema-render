import { useLayoutEffect, useRef, useState } from "react";

export function animateTaskWindow(panel, backdrop, closing = false, sourceRect = null, previewMotion = false) {
  if (!panel?.animate || (!previewMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return [];
  const options = { duration: closing ? 460 : 580, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "both" };
  // Snapshot computed values so a close during entrance starts where the panel is.
  const style = window.getComputedStyle(panel);
  const rect = panel.getBoundingClientRect();
  const originX = sourceRect ? sourceRect.left + sourceRect.width / 2 : rect.left + rect.width / 2;
  const originY = sourceRect ? sourceRect.top + sourceRect.height / 2 : Math.min(window.innerHeight - 24, rect.bottom);
  const dx = originX - (rect.left + rect.width / 2);
  const dy = originY - rect.bottom;
  const full = "polygon(0% 0%,100% 0%,100% 25%,100% 50%,100% 75%,100% 100%,0% 100%,0% 75%,0% 50%,0% 25%)";
  const funnel = "polygon(0% 0%,100% 0%,97% 25%,84% 50%,65% 75%,54% 100%,46% 100%,35% 75%,16% 50%,3% 25%)";
  const neck = "polygon(22% 0%,78% 0%,75% 25%,64% 50%,54% 75%,51% 100%,49% 100%,46% 75%,36% 50%,25% 25%)";
  // The lower edge narrows first; then the body follows it into the source card.
  const collapse = [
    { transform: "translate(0, 0) scale(1)", clipPath: full, opacity: 1 },
    { transform: `translate(${dx * .16}px, ${dy * .12}px) scale(1, .94)`, clipPath: funnel, opacity: 1 },
    { transform: `translate(${dx * .65}px, ${dy * .65}px) scale(.65, .42)`, clipPath: neck, opacity: .95 },
    { transform: `translate(${dx}px, ${dy}px) scale(.12, .025)`, clipPath: neck, opacity: 0 },
  ];
  const frames = (closing ? collapse : [...collapse].reverse()).map(frame => ({...frame, transformOrigin: "50% 100%"}));
  if (closing && style.transform !== "none") {
    frames[0] = {...frames[0], transform: style.transform, opacity: style.opacity, clipPath: style.clipPath === "none" ? full : style.clipPath};
  }
  return [
    panel.animate(frames, options),
    ...(backdrop?.animate ? [backdrop.animate([
      { backgroundColor: closing ? window.getComputedStyle(backdrop).backgroundColor : "transparent" },
      { backgroundColor: closing ? "transparent" : window.getComputedStyle(backdrop).backgroundColor },
    ], options)] : []),
  ];
}

export function useTaskWindowMotion(taskId, onClose, previewMotion = false) {
  const panelRef = useRef(null);
  const backdropRef = useRef(null);
  const running = useRef([]);
  const generation = useRef(0);
  const closingRef = useRef(false);
  const source = useRef(null);
  const [closing, setClosing] = useState(false);
  useLayoutEffect(() => {
    generation.current++;
    closingRef.current = false;
    setClosing(false);
    if (!taskId) return;
    const card = [...document.querySelectorAll('.ros-task-card[data-task-id]')].find(node => node.dataset.taskId === String(taskId));
    const cardRect = card?.getBoundingClientRect();
    source.current = cardRect && cardRect.bottom > 0 && cardRect.top < window.innerHeight && cardRect.right > 0 && cardRect.left < window.innerWidth ? cardRect : null;
    const animations = animateTaskWindow(panelRef.current, backdropRef.current, false, source.current, previewMotion);
    running.current = animations;
    // Remove fill after entrance: avoid leaving a transformed containing block.
    Promise.all(animations.map(a => a.finished)).then(() => animations.forEach(a => a.cancel())).catch(() => {});
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => running.current.forEach(a => a.cancel());
    media.addEventListener("change", stop);
    return () => { generation.current++; stop(); media.removeEventListener("change", stop); };
  }, [taskId, previewMotion]);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const ticket = generation.current;
    const entrance = running.current;
    const exit = animateTaskWindow(panelRef.current, backdropRef.current, true, source.current, previewMotion);
    entrance.forEach(a => a.cancel());
    running.current = exit;
    const finish = () => { if (ticket === generation.current) onClose(); };
    if (!exit.length) { finish(); return; }
    Promise.all(exit.map(a => a.finished)).then(finish, finish);
  };
  return { panelRef, backdropRef, closing, close };
}
