import type { CSSProperties } from "react";
import { inquiryLights } from "../field.js";
import type { AppState } from "../state.js";
/** State transitions animate once. Reading and paused surfaces have no ticking JS. */
export function LiveField({ state }: { state: AppState }) {
  const lights = inquiryLights(state);
  return (
    <div className="glass-live-field" aria-hidden="true">
      {lights.map((light, i) => (
        <div
          key={light.id}
          className="glass-inquiry-position"
          style={
            {
              left: `${18 + (i % 4) * 21}%`,
              top: `${48 + (Math.floor(i / 4) % 2) * 17}%`,
            } as CSSProperties
          }
        >
          <div
            key={light.state}
            className="glass-inquiry-light"
            data-state={light.state}
          />
        </div>
      ))}
    </div>
  );
}
