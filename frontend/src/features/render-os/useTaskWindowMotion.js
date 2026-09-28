import { useLayoutEffect, useRef, useState } from "react";

// A task behaves like a Notion page: short fade, tiny displacement, fast exit.
export function animateTaskWindow(panel, backdrop, closing = false) {
  if (!panel?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return [];
  const duration = closing ? 130 : 190;
  const easing = closing ? "cubic-bezier(.4, 0, 1, 1)" : "cubic-bezier(.2, .8, .2, 1)";
  const options = { duration, easing, fill: "both" };
  const resting = { transform: "translate3d(0, 0, 0)", opacity: 1 };
  const offset = { transform: "translate3d(0, 10px, 0)", opacity: 0 };
  const panelFrames = closing ? [resting, offset] : [offset, resting];
  const backdropColor = window.getComputedStyle(backdrop || panel).backgroundColor;
  const backdropFrames = closing
    ? [{ backgroundColor: backdropColor }, { backgroundColor: "transparent" }]
    : [{ backgroundColor: "transparent" }, { backgroundColor: backdropColor }];
  return [
    panel.animate(panelFrames, options),
    ...(backdrop?.animate ? [backdrop.animate(backdropFrames, options)] : []),
  ];
}

export function useTaskWindowMotion(taskId, onClose) {
  const panelRef = useRef(null);
  const backdropRef = useRef(null);
  const running = useRef([]);
  const generation = useRef(0);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  useLayoutEffect(() => {
    generation.current++;
    closingRef.current = false;
    setClosing(false);
    if (!taskId) return;
    const animations = animateTaskWindow(panelRef.current, backdropRef.current);
    running.current = animations;
    Promise.all(animations.map((animation) => animation.finished))
      .then(() => animations.forEach((animation) => animation.cancel()))
      .catch(() => {});
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => running.current.forEach((animation) => animation.cancel());
    media.addEventListener("change", stop);
    return () => { generation.current++; stop(); media.removeEventListener("change", stop); };
  }, [taskId]);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const ticket = generation.current;
    running.current.forEach((animation) => animation.cancel());
    const exit = animateTaskWindow(panelRef.current, backdropRef.current, true);
    running.current = exit;
    const finish = () => { if (ticket === generation.current) onClose(); };
    if (!exit.length) { finish(); return; }
    Promise.all(exit.map((animation) => animation.finished)).then(finish, finish);
  };
  return { panelRef, backdropRef, closing, close };
}
