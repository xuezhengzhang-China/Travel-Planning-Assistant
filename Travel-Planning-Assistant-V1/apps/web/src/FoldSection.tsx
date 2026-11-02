import type { ReactNode } from 'react';
import './trip-features.css';

export default function FoldSection({ title, hint, children, defaultOpen = true }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  return <details className="fold-section" open={defaultOpen}><summary><span>{title}</span>{hint && <small>{hint}</small>}<i aria-hidden="true">⌄</i></summary><div className="fold-content">{children}</div></details>;
}
