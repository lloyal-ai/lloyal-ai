import { useEffect, useState } from "react";
import { inquiryLights } from "../field.js";
import type { AppState } from "../state.js";
/** One continuous atmosphere. No per-agent shapes or per-token animation restarts. */
export function LiveField({ state }: { state: AppState }) {
  const active = inquiryLights(state).some(
    (light) => light.state === "reading" || light.state === "writing",
  );
  const [scrolling, setScrolling] = useState(false);
  const [selecting, setSelecting] = useState(false);
  useEffect(() => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const scroll = () => {
      setScrolling(true);
      clearTimeout(quiet);
      quiet = setTimeout(() => setScrolling(false), 800);
    };
    const selection = () => {
      const selected = window.getSelection();
      setSelecting(Boolean(selected && !selected.isCollapsed));
    };
    window.addEventListener("scroll", scroll, { capture: true, passive: true });
    document.addEventListener("selectionchange", selection);
    return () => {
      clearTimeout(quiet);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener("selectionchange", selection);
    };
  }, []);
  return (
    <div
      className="gc-haze"
      data-active={active}
      data-reading={scrolling || selecting}
      aria-hidden="true"
    >
      <div className="gc-ambient-flow" />
    </div>
  );
}
