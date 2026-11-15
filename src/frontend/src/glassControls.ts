import type { PointerEvent } from "react";

export function moveGlassHighlight(event: PointerEvent<HTMLElement>) {
  if (event.pointerType === "touch") return;
  const control = event.currentTarget;
  const rect = control.getBoundingClientRect();
  control.style.setProperty("--light-x", `${event.clientX - rect.left}px`);
  control.style.setProperty("--light-y", `${event.clientY - rect.top}px`);
}
