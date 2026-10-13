import { useState } from "react";
import { Popover } from "@lloyal-labs/ui";
import { Mode } from "../../domain/work.js";
import { popStyle } from "./Abilities.js";
const descriptions = {
  Auto: "Let the request take shape",
  Direct: "One agent, available abilities",
  Plan: "Review the approach before starting",
  Parallel: "Independent work, brought together",
  Chain: "Each step builds on the last",
  Graph: "Work organised by dependencies",
};
export function Modes({
  value,
  onChange,
}: {
  value: Mode;
  onChange(value: Mode): void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null),
    [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className="gc-picker"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {value} <span aria-hidden="true">⌄</span>
      </button>
      <Popover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        label="Mode"
        style={popStyle}
      >
        <div className="glass-pop" role="radiogroup" aria-label="Mode">
          {Mode.options.map((mode) => (
            <button
              className="glass-mode"
              key={mode}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => {
                onChange(mode);
                setOpen(false);
              }}
            >
              <span>{mode}</span>
              <small>{descriptions[mode]}</small>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
