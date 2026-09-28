import { useLayoutEffect, useRef } from "react";

// Notion-like FLIP motion: preserve spatial continuity without deforming cards.
export function useTaskBoardMotion(boardRef, tasks, view) {
  const previous = useRef(new Map());
  useLayoutEffect(() => {
    const board = boardRef.current;
    const before = previous.current;
    const next = new Map();
    if (view !== "board" || !board) {
      previous.current = next;
      return undefined;
    }
    const states = new Map(tasks.map((task) => [String(task.id), task.estado]));
    const cards = [...board.querySelectorAll(".ros-task-card[data-task-id]")];
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      next.set(card.dataset.taskId, {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        top: rect.top,
        bottom: rect.bottom,
        state: states.get(card.dataset.taskId),
      });
    }
    previous.current = next;
    const changed = [...next].some(([id, item]) => before.has(id) && before.get(id).state !== item.state);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compactBoard = window.matchMedia("(max-width: 600px)");
    if (!changed || reducedMotion.matches || compactBoard.matches) return undefined;

    const animations = [];
    for (const card of cards) {
      const from = before.get(card.dataset.taskId);
      const to = next.get(card.dataset.taskId);
      if (!from || !to || typeof card.animate !== "function") continue;
      const x = from.x - to.x;
      const y = from.y - to.y;
      if (Math.abs(x) + Math.abs(y) < 1) continue;
      if (to.bottom < 0 || to.top > window.innerHeight) continue;
      const restingShadow = window.getComputedStyle(card).boxShadow;
      animations.push(card.animate([
        { transform: `translate3d(${x}px, ${y}px, 0)`, opacity: .88, boxShadow: restingShadow },
        { transform: "translate3d(0, 0, 0)", opacity: 1, boxShadow: restingShadow },
      ], {
        duration: 220,
        easing: "cubic-bezier(.2, .8, .2, 1)",
      }));
    }
    const stop = () => animations.forEach((animation) => animation.cancel());
    reducedMotion.addEventListener("change", stop);
    return () => { stop(); reducedMotion.removeEventListener("change", stop); };
  }, [boardRef, tasks, view]);
}
