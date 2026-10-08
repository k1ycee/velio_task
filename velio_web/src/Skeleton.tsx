/**
 * Placeholder blocks shaped like the content that's loading. Invisible for the first 150ms
 * (CSS), so fast loads never flash; announced once to screen readers via role="status".
 */
export function Skeleton({ heights, label }: { heights: number[]; label: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {heights.map((h, i) => (
        <div key={i} className="skeleton-block" style={{ height: h }} />
      ))}
    </div>
  );
}
