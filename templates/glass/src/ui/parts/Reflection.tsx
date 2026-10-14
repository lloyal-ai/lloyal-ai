import { usePreferences } from "../preferences.js";
import { useEffect, useRef, type RefObject } from "react";

/** A finite travelling reflection along the corner nearest the interaction. */
export function Reflection({
  surface,
  flash,
}: {
  surface: RefObject<HTMLElement | null>;
  flash: { key: number; right: boolean; bottom: boolean };
}) {
  const { value: preferences } = usePreferences();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current,
      box = surface.current?.getBoundingClientRect();
    if (
      !node ||
      !box ||
      !flash.key ||
      preferences.motion === "reduced" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const context = node.getContext("2d");
    if (!context) return;
    const pad = 24,
      radius = 23,
      ratio = Math.min(devicePixelRatio || 1, 2);
    const width = box.width,
      height = box.height;
    node.width = (width + pad * 2) * ratio;
    node.height = (height + pad * 2) * ratio;
    context.scale(ratio, ratio);
    const corner = (radius * Math.PI) / 2,
      travel = 82 + corner + Math.min(55, height - 2 * radius);
    const point = (distance: number) => {
      let x: number, y: number;
      if (distance < 82) {
        x = radius + 82 - distance;
        y = 0;
      } else if (distance < 82 + corner) {
        const angle = -Math.PI / 2 - (distance - 82) / radius;
        x = radius + radius * Math.cos(angle);
        y = radius + radius * Math.sin(angle);
      } else {
        x = 0;
        y = radius + distance - 82 - corner;
      }
      return {
        x: pad + (flash.right ? width - x : x),
        y: pad + (flash.bottom ? height - y : y),
      };
    };
    let frame = 0;
    const start = performance.now();
    node.style.opacity = "1";
    const draw = (now: number) => {
      const progress = Math.min(1, (now - start) / 800);
      context.clearRect(0, 0, width + pad * 2, height + pad * 2);
      const head = progress * (travel + 75),
        fade = Math.sin(progress * Math.PI);
      for (let i = 58; i >= 0; i--) {
        const distance = head - i * 1.8;
        if (distance < 0 || distance > travel) continue;
        const p = point(distance),
          strength = (1 - i / 59) * fade;
        context.beginPath();
        context.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        context.shadowBlur = 15;
        context.shadowColor = "#286aff";
        context.fillStyle = `rgba(112,169,255,${strength})`;
        context.fill();
        if (i < 3) {
          context.shadowBlur = 7;
          context.fillStyle = `rgba(238,247,255,${strength})`;
          context.fill();
        }
      }
      if (progress < 1) frame = requestAnimationFrame(draw);
      else node.style.opacity = "0";
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      node.style.opacity = "0";
    };
  }, [flash, surface, preferences.motion]);
  return <canvas ref={canvas} className="gc-reflection" aria-hidden="true" />;
}
