type AtlasiumMarkSize = "sm" | "md" | "lg";

export function AtlasiumMark({
  size = "md",
  className = ""
}: {
  size?: AtlasiumMarkSize;
  className?: string;
}): JSX.Element {
  const classes = ["atlasium-mark", `atlasium-mark-${size}`, className].filter(Boolean).join(" ");

  return (
    <span className={classes} aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        <path className="atlasium-mark-page" d="M11 7.5h21.5L39 14v26.5H11z" />
        <path className="atlasium-mark-tab" d="M32.5 7.5V14H39" />
        <path className="atlasium-mark-a" d="M17 34 24 15l7 19M20.2 27.2h7.6" />
        <path className="atlasium-mark-index" d="M14.5 12.5h5.2M14.5 37.5h19" />
      </svg>
    </span>
  );
}
