import { useState } from "react";
import { Popover } from "@lloyal-labs/ui";

/** Scope-specific actions share one predictable trigger and public popover mechanics. */
export function ActionMenu({
  label,
  action,
  onAction,
}: {
  label: string;
  action: string;
  onAction(): void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={setAnchor}
        className="gc-icon gc-more"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      <Popover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        style={{
          width: 220,
          minWidth: 0,
          padding: 8,
          borderRadius: 12,
          background: "#191e2c",
          color: "#f2f5ff",
          border: "1px solid #a3baff25",
          boxShadow: "0 16px 60px #0008",
          font: "400 13px Inter, sans-serif",
        }}
      >
        <div className="glass-action-menu" role="menu" aria-label={label}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAction();
            }}
          >
            {action}
          </button>
        </div>
      </Popover>
    </>
  );
}
