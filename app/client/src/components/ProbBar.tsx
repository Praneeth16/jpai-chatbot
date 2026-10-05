export function ProbBar({ label, value, threshold }: { label: string; value: number; threshold?: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="grid grid-cols-[minmax(7rem,38%)_1fr_3rem] items-center gap-2 text-xs">
      <span className="truncate text-muted-foreground" title={label}>
        {label}
      </span>
      <div
        className="relative h-2 rounded-full bg-secondary"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(3))}
      >
        <div className="h-full rounded-full bg-primary/80" style={{ width: `${pct}%` }} />
        {threshold !== undefined && (
          <span
            className="absolute -top-0.5 h-3 w-px bg-foreground/60"
            style={{ left: `${threshold * 100}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <span className="text-right tabular-nums">{value.toFixed(2)}</span>
    </div>
  );
}
