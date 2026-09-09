import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

export function AppTheme({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <div className={pathname === '/' ? undefined : 'app-theme'}>{children}</div>;
}

export function PageHeader({ title, description, action, status }: { title: string; description?: string; action?: ReactNode; status?: ReactNode }) {
  return <header className="workspace-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}{status}</div>{action && <div className="workspace-page-actions">{action}</div>}</header>;
}

export function Surface({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`workspace-surface ${className}`} {...props} />;
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  return <button type={type} className={`workspace-button workspace-button-${variant} ${className}`} {...props} />;
}

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'error' }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'neutral' ? Info : AlertCircle;
  return <span className={`workspace-status workspace-status-${tone}`}><Icon size={13} aria-hidden="true" />{children}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="workspace-empty"><Info size={25} aria-hidden="true" /><h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function TableToolbar({ children, label = 'Table filters' }: { children: ReactNode; label?: string }) {
  return <div className="workspace-toolbar" role="group" aria-label={label}>{children}</div>;
}
