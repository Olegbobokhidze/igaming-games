import type { ReactNode } from 'react';
import './Panel.css';

export type PanelVariant = 'wide' | 'medium' | 'small';

export interface PanelProps {
  readonly children?: ReactNode;
  /** Optional heading rendered above the body. */
  readonly title?: string;
  readonly variant?: PanelVariant;
  readonly className?: string;
}

/** Framed HUD container. Mirrors the panel_* atlas frames in DOM form. */
export function Panel({ children, title, variant = 'medium', className }: PanelProps) {
  const classes = ['orbit-panel', `orbit-panel--${variant}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes}>
      {title !== undefined && <h2 className="orbit-panel__title">{title}</h2>}
      <div className="orbit-panel__body">{children}</div>
    </section>
  );
}
