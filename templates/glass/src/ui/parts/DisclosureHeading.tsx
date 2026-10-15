import type { ReactNode } from "react";
import { Chevron } from "./Chevron.js";

/** Shared title/metadata hierarchy inside a native, keyboard-operable summary. */
export function DisclosureHeading({
  children,
  meta,
}: {
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <>
      <span className="gc-disclosure-heading">
        <span className="gc-disclosure-title">{children}</span>
        {meta != null && <small className="gc-disclosure-meta">{meta}</small>}
      </span>
      <Chevron />
    </>
  );
}
