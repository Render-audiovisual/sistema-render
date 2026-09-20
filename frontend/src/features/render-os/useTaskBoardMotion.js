import { useLayoutEffect, useRef } from "react";

// Presentation only: observe rendered positions, never update task data.
export function useTaskBoardMotion(boardRef, tasks, view, previewMotion = false) {
  const previous = useRef(new Map());
  useLayoutEffect(() => {
    const board = boardRef.current;
    const before = previous.current;
    const next = new Map();
    if (view !== "board" || !board) {
      previous.current = next;
      return undefined;
    }
    const states = new Map(tasks.map(task => [String(task.id), task.estado]));
    const cards = [...board.querySelectorAll(".ros-task-card[data-task-id]")];
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      next.set(card.dataset.taskId, {
        x: rect.left + window.scrollX, y: rect.top + window.scrollY,
        top: rect.top,
        bottom: rect.bottom,
        state: states.get(card.dataset.taskId),
      });
    }
    previous.current = next;
    const changed = [...next].some(([id, item]) => before.has(id) && before.get(id).state !== item.state);
    if (!changed || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const animations = [];
    for (const card of cards) {
      const from = before.get(card.dataset.taskId);
      const to = next.get(card.dataset.taskId);
      if (!from || typeof card.animate !== "function") continue;
      const x = from.x - to.x, y = from.y - to.y;
      if (Math.abs(x) + Math.abs(y) < 1) continue;
      if (to.bottom < 0 || to.top > window.innerHeight) continue;
      const moved = from.state !== to.state;
      // Avoid a long flight when the destination is far down a column.
      const nearby = Math.abs(y) < window.innerHeight && Math.abs(x) < window.innerWidth;
      const restingShadow = window.getComputedStyle(card).boxShadow;
      const basicFrames = [
        {
          transform: nearby ? `translate(${x}px, ${y}px) scale(${moved ? 1.025 : 1})` : "scale(.975)",
          opacity: nearby ? 1 : .65, zIndex: moved ? 2 : 1,
          boxShadow: moved ? "0 16px 36px rgba(32, 36, 24, .16)" : restingShadow,
        },
        { transform: "translate(0, 0) scale(1)", opacity: 1, zIndex: moved ? 2 : 1, boxShadow: restingShadow },
      ];
      // Narrow the leading edge toward the destination, then unfold on arrival.
      // Only the transferred card receives this effect; neighbours simply slide.
      const full = "polygon(0% 0%,25% 0%,50% 0%,75% 0%,100% 0%,100% 100%,75% 100%,50% 100%,25% 100%,0% 100%)";
      const funnel = x <= 0
        ? "polygon(0% 0%,25% 4%,50% 20%,75% 40%,100% 48%,100% 52%,75% 60%,50% 80%,25% 96%,0% 100%)"
        : "polygon(0% 48%,25% 40%,50% 20%,75% 4%,100% 0%,100% 100%,75% 96%,50% 80%,25% 60%,0% 52%)";
      const genieFrames = [
        { transform: `translate(${x}px, ${y}px) scale(1)`, clipPath: full, opacity: 1, offset: 0 },
        { transform: `translate(${x * .75}px, ${y * .75}px) scale(.9, .8)`, clipPath: funnel, opacity: 1, offset: .3 },
        { transform: `translate(${x * .22}px, ${y * .22}px) scale(.45, .22)`, clipPath: funnel, opacity: .9, offset: .58 },
        { transform: "translate(0, 0) scale(1)", clipPath: full, opacity: 1, offset: 1 },
      ].map(frame => ({...frame, zIndex: 3, transformOrigin: "50% 50%"}));
      const genie = moved && nearby;
      animations.push(card.animate(genie ? genieFrames : basicFrames, {
        duration: genie ? 640 : 360,
        easing: genie ? "cubic-bezier(.4, 0, .2, 1)" : "cubic-bezier(.22, .8, .25, 1)",
      }));
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => animations.forEach(animation => animation.cancel());
    media.addEventListener("change", stop);
    return () => { stop(); media.removeEventListener("change", stop); };
  }, [boardRef, tasks, view, previewMotion]);
}
