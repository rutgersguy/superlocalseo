import { ReactNode } from 'react';
import { useClient } from '../hooks/useClient';
import { ProGate } from './ProGate';

/**
 * Route guard for Pro-only dashboard pages. The nav already hides these for Lite,
 * but a Lite user can still reach them by typing the URL — without this they'd see
 * the full page with 403'd data. Renders the ProGate upgrade prompt instead.
 * Admins (productLine resolves to 'pro') pass through.
 */
export function ProRoute({ feature, description, children }: { feature: string; description: string; children: ReactNode }) {
  const { isLite, loading } = useClient();
  if (loading) return null; // wait until the plan is known to avoid a flash of the Pro page
  if (isLite) return <ProGate feature={feature} description={description} />;
  return <>{children}</>;
}
