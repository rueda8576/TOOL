export function StatusCard({
  title,
  value,
  helper
}: {
  title: string;
  value: string;
  helper: string;
}): JSX.Element {
  return (
    <article className="status-card">
      <p className="status-title">{title}</p>
      <p className="status-value">{value}</p>
      <p className="status-helper">{helper}</p>
    </article>
  );
}
