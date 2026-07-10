import useSWR from 'swr';
import { fetcher } from '../services/api';
import { useAuth } from './useAuth';
import type { Plan } from '../config/planFeatures';

export interface ClientData {
  id: string;
  email: string;
  emailVerified: boolean;
  businessName: string;
  industry: string | null;
  productLine: Plan;
  onboardingStep: number;
  billing: { plan: string; status: string };
  integrations: {
    google: { connected: boolean };
    facebook: { connected: boolean; pageName: string | null };
  };
  locations: Array<{
    id: string; name: string; address: string | null;
    city: string | null; state: string | null; zip: string | null;
    phone: string | null; website: string | null; isPrimary: boolean;
  }>;
  emrProvisioningStatus: string | null;
  whiteLabel: { companyName: string | null; logoUrl: string | null; color: string | null };
}

interface UseClientResult {
  client: ClientData | null;
  productLine: Plan;
  isLite: boolean;
  isPro: boolean;
  loading: boolean;
  mutate: () => void;
}

/**
 * Client profile + plan tier. Returns productLine/isLite/isPro for plan-gating UI.
 * Defaults to 'pro' when unknown (loading, or admin with no client) so we never
 * hide features from a Pro user mid-load. Server-side requireProPlan is the real gate.
 */
export function useClient(): UseClientResult {
  const { isAuthenticated, role } = useAuth();
  const { data, isLoading, mutate } = useSWR<{ success: boolean; data: ClientData }>(
    isAuthenticated && role === 'client' ? '/clients' : null,
    fetcher,
  );

  const client = data?.data ?? null;
  const productLine: Plan = (client?.productLine ?? 'pro') as Plan;

  return {
    client,
    productLine,
    isLite: productLine === 'lite',
    isPro: productLine === 'pro',
    loading: isLoading,
    mutate,
  };
}
