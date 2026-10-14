import type { ReactNode } from "react";

export function ActivityLabel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <span className="gc-activity-label">
      {active && <span className="gc-status-spinner" aria-hidden="true" />}
      {children}
    </span>
  );
}
