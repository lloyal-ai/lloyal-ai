/** Acknowledgement and runtime activity, never an inference from model output. */
export function PendingActivity({
  label,
  paused = false,
}: {
  label: string;
  paused?: boolean;
}) {
  return (
    <div
      className="gc-pending"
      role="status"
      aria-label={label}
      data-paused={paused}
    >
      <span className="gc-typing" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{label}</span>
    </div>
  );
}
