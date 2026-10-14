import { useLayoutEffect, useState, type ReactNode } from "react";
import { Popover } from "@lloyal-labs/ui";

/** Size the public popover to the space beside the composer, including short screens. */
export function ComposerPopover({
  anchor,
  open,
  onClose,
  label,
  children,
  width = 300,
}: {
  anchor: HTMLButtonElement | null;
  open: boolean;
  onClose(): void;
  label: string;
  children: ReactNode;
  width?: number;
}) {
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) {
      setRoom(null);
      return;
    }
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      setRoom(
        Math.min(
          540,
          Math.max(rect.top - 16, window.innerHeight - rect.bottom - 16),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor.closest(".gc-dock") ?? anchor);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchor]);
  if (room === null) return null;
  return (
    <Popover
      key={room}
      anchor={anchor}
      open={open}
      onClose={onClose}
      label={label}
      style={{
        width,
        minWidth: 0,
        maxHeight: room,
        overflow: "auto",
        overscrollBehavior: "contain",
        background: "#191e2c",
        color: "#f2f5ff",
        border: "1px solid #a3baff25",
        borderRadius: 16,
        padding: 12,
        font: "400 13px Inter, sans-serif",
        boxShadow: "0 16px 60px #0008",
      }}
    >
      {children}
    </Popover>
  );
}
