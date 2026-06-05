import { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

function buttonClassName(variant: ButtonVariant, className?: string): string {
  const variantClass =
    variant === "primary"
      ? "button"
      : variant === "secondary"
        ? "button button-secondary"
        : variant === "ghost"
          ? "button button-ghost"
          : "button button-danger";
  return className ? `${variantClass} ${className}` : variantClass;
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }): JSX.Element {
  return <button className={buttonClassName(variant, className)} {...props} />;
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }): JSX.Element {
  return (
    <button className={buttonClassName("secondary", className ? `icon-button ${className}` : "icon-button")} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>): JSX.Element {
  return <section className={className ? `panel ${className}` : "panel"} {...props} />;
}

export function Alert({
  tone = "info",
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { tone?: "info" | "success" | "warning" | "error" }): JSX.Element {
  return <p className={className ? `alert alert-${tone} ${className}` : `alert alert-${tone}`} {...props} />;
}

export function LoadingState({
  title,
  detail,
  className
}: {
  title: string;
  detail?: string;
  className?: string;
}): JSX.Element {
  return (
    <div className={className ? `loading-state ${className}` : "loading-state"} role="status" aria-live="polite">
      <span className="loading-state-spinner" aria-hidden="true" />
      <div className="stack-xxs">
        <p className="loading-state-title">{title}</p>
        {detail ? <p className="loading-state-detail">{detail}</p> : null}
      </div>
    </div>
  );
}

export function SkeletonBlock({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={className ? `skeleton-block ${className}` : "skeleton-block"} aria-hidden="true" {...props} />;
}

export function EmptyState({
  title,
  detail,
  action,
  className
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={className ? `empty-state ${className}` : "empty-state"}>
      <div className="stack-xxs">
        <p className="empty-state-title">{title}</p>
        {detail ? <p className="empty-state-detail">{detail}</p> : null}
      </div>
      {action ? <div className="button-row">{action}</div> : null}
    </div>
  );
}

export function FieldMessage({
  tone = "info",
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { tone?: "info" | "success" | "warning" | "error" }): JSX.Element {
  return <p className={className ? `field-message field-message-${tone} ${className}` : `field-message field-message-${tone}`} {...props} />;
}

export function StatusLine({
  tone = "info",
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { tone?: "info" | "success" | "warning" | "error" }): JSX.Element {
  return <p className={className ? `status-line status-line-${tone} ${className}` : `status-line status-line-${tone}`} {...props} />;
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return <span className={className ? `badge ${className}` : "badge"} {...props} />;
}

export function MetricPill({ className, ...props }: HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return <span className={className ? `metric-pill ${className}` : "metric-pill"} {...props} />;
}

export function ToolbarGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={className ? `toolbar-group ${className}` : "toolbar-group"} {...props} />;
}

export function MetaRow({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={className ? `meta-row ${className}` : "meta-row"} {...props} />;
}

export function MetadataStrip({
  items,
  className
}: {
  items: Array<ReactNode>;
  className?: string;
}): JSX.Element {
  return (
    <div className={className ? `metadata-strip ${className}` : "metadata-strip"}>
      {items.map((item, index) => (
        <span key={index} className="metadata-strip-item">
          {item}
        </span>
      ))}
    </div>
  );
}

export function ArchiveIndex({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={className ? `archive-index ${className}` : "archive-index"} {...props} />;
}

export function ArchiveRow({ className, ...props }: HTMLAttributes<HTMLElement>): JSX.Element {
  return <article className={className ? `archive-row ${className}` : "archive-row"} {...props} />;
}

export function StateRail({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={className ? `state-rail ${className}` : "state-rail"} {...props} />;
}

export function WorkspaceHeader({
  eyebrow,
  title,
  summary,
  metadata,
  actions,
  className,
  titleLevel = "h2"
}: {
  eyebrow?: string;
  title: ReactNode;
  summary?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleLevel?: "h1" | "h2" | "h3";
}): JSX.Element {
  const Heading = titleLevel;
  return (
    <header className={className ? `workspace-header ${className}` : "workspace-header"}>
      <div className="workspace-header-copy">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <Heading className="workspace-title">{title}</Heading>
        {summary ? <p className="workspace-summary">{summary}</p> : null}
        {metadata ? <div className="workspace-header-metadata">{metadata}</div> : null}
      </div>
      {actions ? <div className="workspace-header-actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  action,
  className
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={className ? `section-header ${className}` : "section-header"}>
      <div className="stack-xxs">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h3 className="section-heading">{title}</h3>
      </div>
      {action ? <div className="section-header-action">{action}</div> : null}
    </div>
  );
}

export function ModuleCockpit({
  eyebrow,
  title,
  summary,
  metrics,
  actions,
  icon,
  className,
  titleClassName = "section-heading",
  titleLevel = "h2"
}: {
  eyebrow: string;
  title: ReactNode;
  summary?: ReactNode;
  metrics?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  titleClassName?: string;
  titleLevel?: "h2" | "h3";
}): JSX.Element {
  const Heading = titleLevel;
  return (
    <div className={className ? `module-cockpit ${className}` : "module-cockpit"}>
      <div className="module-cockpit-copy">
        <p className="eyebrow module-cockpit-eyebrow">
          {icon ? <span className="module-cockpit-icon" aria-hidden="true">{icon}</span> : null}
          <span>{eyebrow}</span>
        </p>
        <div className="module-cockpit-title-row">
          <Heading className={titleClassName}>{title}</Heading>
          {metrics ? <div className="module-cockpit-metrics">{metrics}</div> : null}
        </div>
        {summary ? <p className="module-cockpit-summary">{summary}</p> : null}
      </div>
      {actions ? <div className="module-cockpit-actions">{actions}</div> : null}
    </div>
  );
}

export function Tabs<TValue extends string>({
  tabs,
  value,
  onChange,
  label,
  className
}: {
  tabs: Array<{ value: TValue; label: string; count?: number }>;
  value: TValue;
  onChange: (value: TValue) => void;
  label: string;
  className?: string;
}): JSX.Element {
  return (
    <nav className={className ? `tabs ${className}` : "tabs"} aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          className={value === tab.value ? "tab tab-active" : "tab"}
          onClick={() => onChange(tab.value)}
          aria-current={value === tab.value ? "page" : undefined}
        >
          {tab.label}
          {tab.count ? <span className="tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

export function Modal({
  title,
  children,
  onClose,
  className
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}): JSX.Element {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={className ? `panel modal-panel ${className}` : "panel modal-panel"} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  destructive = false,
  onConfirm,
  onCancel
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <Modal title={title} onClose={onCancel} className="confirm-dialog">
      <div className="stack-md">
        <div className="stack-xs">
          <h2 className="section-heading">{title}</h2>
          <p>{message}</p>
        </div>
        <div className="button-row">
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} type="button" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>;
}
