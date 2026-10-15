import { ComposerPopover } from "./ComposerPopover.js";
import { Chevron } from "./Chevron.js";
import { useState, useEffect, useRef } from "react";
import { Mode } from "../../domain/work.js";

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
  disabled = false,
}: {
  value: Mode;
  disabled?: boolean;
  onChange(value: Mode): void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className="gc-picker"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {value} <Chevron />
      </button>
      <ComposerPopover
        anchor={anchor}
        open={open && !disabled}
        onClose={() => setOpen(false)}
        label="Mode"
      >
        <ModeGroup>
          {Mode.options.map((mode) => (
            <button
              className="glass-mode"
              key={mode}
              type="button"
              role="radio"
              aria-checked={mode === value}
              tabIndex={mode === value ? 0 : -1}
              onKeyDown={(event) => {
                const offset = ["ArrowDown", "ArrowRight"].includes(event.key)
                  ? 1
                  : ["ArrowUp", "ArrowLeft"].includes(event.key)
                    ? -1
                    : 0;
                if (!offset && !["Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const choices = Array.from(
                  event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                    "[role=radio]",
                  ),
                );
                const index =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? choices.length - 1
                      : (choices.indexOf(event.currentTarget) +
                          offset +
                          choices.length) %
                        choices.length;
                choices[index].focus();
                onChange(Mode.options[index]);
              }}
              onClick={() => {
                onChange(mode);
                setOpen(false);
              }}
            >
              <span>{mode}</span>
              <small>{descriptions[mode]}</small>
            </button>
          ))}
        </ModeGroup>
      </ComposerPopover>
    </>
  );
}

function ModeGroup({ children }: { children: React.ReactNode }) {
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    group.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, []);
  return (
    <div ref={group} className="glass-pop" role="radiogroup" aria-label="Mode">
      {children}
    </div>
  );
}
