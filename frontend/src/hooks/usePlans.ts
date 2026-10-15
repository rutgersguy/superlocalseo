import useSWR from 'swr';
import { fetcher } from '../services/api';
export type PlanKey = 'starter' | 'pro' | 'multi';
export type BillingInterval = 'month' | 'year';
export interface PlanDefinition { name: string; monthly: number; annual: number; includedLocations: number; extraMonthly: number; extraAnnual: number; maxLocations: number; features: string[]; keywords: number; competitors: number; gridSize: number; gridScans: number; reviewRequests: number; sms: number; aiChecks: number; rankingRuns: number; teamSeats: number; whiteLabel: boolean; proFeatures: boolean }
export interface PlanCatalog { version: string; trialDays: number; annualPaidMonths: number; currency: string; plans: Record<PlanKey, PlanDefinition> }
export const money = (cents: number, currency = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100);
export function usePlans() { return useSWR<{ success: boolean; data: PlanCatalog }>('/billing/catalog', fetcher); }
