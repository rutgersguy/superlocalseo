import { useState, useEffect, useRef } from 'react';
import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom';
import { Home, BarChart2, Star, Link2, Settings, LogOut, Menu, X, FileText, Megaphone, Users2, ClipboardList, ShieldAlert, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useClient } from '../hooks/useClient';
import { fetcher, apiFetch } from '../services/api';
import { NAV_ITEMS as PLAN_NAV } from '../config/planFeatures';
import useSWR from 'swr';

declare global {
  interface Window {
    $crisp: unknown[];
    CRISP_WEBSITE_ID: string;
  }
}

const CRISP_WEBSITE_ID = 'b43a3ca0-74af-4cac-b7a7-e310cd2041d0';

function OnboardingRedirect() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const { data } = useSWR<{ success: boolean; data: { onboardingStep: number; productLine?: string } }>(
    role === 'client' ? '/clients' : null,
    fetcher,
  );

  useEffect(() => {
    if (role !== 'client' || !data?.data) return;
    if (data.data.onboardingStep === 0) {
      // Lite uses the same Onboarding page in a 2-step mode via ?lite=1
      const dest = data.data.productLine === 'lite' ? '/onboarding?lite=1' : '/onboarding';
      navigate(dest, { replace: true });
    }
  }, [data, role, navigate]);

  return null;
}

function CrispWidget() {
  const { isAuthenticated } = useAuth();
  const { data } = useSWR<{ success: boolean; data: { email: string; businessName: string } }>(
    isAuthenticated ? '/clients' : null,
    fetcher,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.$crisp = [];
    window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;
    const s = document.createElement('script');
    s.src = 'https://client.crisp.chat/l.js';
    s.async = true;
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, []);

  useEffect(() => {
    if (!data?.data) return;
    const { email, businessName } = data.data;
    const push = (cmd: unknown[]) => {
      if (Array.isArray(window.$crisp)) window.$crisp.push(cmd);
    };
    if (email) push(['set', 'user:email', [email]]);
    if (businessName) push(['set', 'user:nickname', [businessName]]);
  }, [data]);

  return null;
}

interface NavItem { to: string; label: string; icon: React.ReactNode; }

const navItems: NavItem[] = [
  { to: '/dashboard',              label: 'Overview',   icon: <Home size={17} aria-hidden="true" /> },
  { to: '/dashboard/ai-visibility', label: 'AI visibility', icon: <Sparkles size={17} aria-hidden="true" /> },
  { to: '/dashboard/rankings',     label: 'Google rankings',    icon: <BarChart2 size={17} aria-hidden="true" /> },
  { to: '/dashboard/reviews',      label: 'Reviews',     icon: <Star size={17} aria-hidden="true" /> },
  { to: '/dashboard/campaigns',    label: 'Review requests',   icon: <Megaphone size={17} aria-hidden="true" /> },
  { to: '/dashboard/competitors',  label: 'Competitors', icon: <Users2 size={17} aria-hidden="true" /> },
  { to: '/dashboard/citations',    label: 'Business listings',   icon: <Link2 size={17} aria-hidden="true" /> },
  { to: '/dashboard/audit',        label: 'Website audit',   icon: <ClipboardList size={17} aria-hidden="true" /> },
  { to: '/dashboard/reports',      label: 'Reports',     icon: <FileText size={17} aria-hidden="true" /> },
  { to: '/dashboard/settings',     label: 'Settings',    icon: <Settings size={17} aria-hidden="true" /> },
];

function SidebarNav({ onNav }: { onNav?: () => void }) {
  const { logout, role } = useAuth();
  const { productLine } = useClient();

  // planFeatures.ts is the source of truth for which tiers see each nav item.
  // Admins always see everything.
  const plansFor = (to: string) => PLAN_NAV.find((n) => n.to === to)?.plans ?? ['lite', 'pro'];
  const visibleNavItems = role === 'admin'
    ? navItems
    : navItems.filter((item) => plansFor(item.to).includes(productLine));

  return (
    <>
      <nav className="flex-1 px-2.5 py-2 space-y-0.5" aria-label="Dashboard navigation">
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/dashboard'}
            onClick={onNav}
            className={({ isActive }) =>
              `sidebar-nav-link flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'text-white'
                  : 'text-slate-200'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`shrink-0 ${isActive ? 'text-white' : ''}`}>{item.icon}</span>
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {role === 'admin' && (
        <div className="px-2.5 pb-2">
          <NavLink
            to="/admin"
            onClick={onNav}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive ? 'bg-red-900/40 text-red-300' : 'text-red-400/80 hover:bg-red-900/30 hover:text-red-300'
              }`
            }
          >
            <ShieldAlert size={17} aria-hidden="true" />
            Admin
          </NavLink>
        </div>
      )}

      <div className="px-2.5 py-3 border-t border-white/15">
        <button
          onClick={() => void logout()}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-all duration-150"
          aria-label="Sign out"
        >
          <LogOut size={17} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </>
  );
}


interface BillingStatus {
  status: string;
  trialDaysLeft: number | null;
  trialEndsAt: string | null;
  locationsLimit: number;
  locationCount: number;
}

function TrialBanner() {
  const { role } = useAuth();
  const { data } = useSWR<{ success: boolean; data: BillingStatus }>(
    role === 'client' ? '/billing/status' : null,
    fetcher,
    { refreshInterval: 60000 },
  );
  const billing = data?.data;
  if (!billing || billing.status !== 'trialing' || billing.trialDaysLeft === null) return null;
  if (billing.trialDaysLeft > 5) return null; // only show when getting close

  const urgent = billing.trialDaysLeft <= 2;
  return (
    <div className={`px-4 py-2 text-sm flex items-center justify-between gap-4 ${urgent ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>
      <span>
        {billing.trialDaysLeft === 0
          ? 'Your trial has expired.'
          : `Your trial ends in ${billing.trialDaysLeft} day${billing.trialDaysLeft === 1 ? '' : 's'}.`}
      </span>
      <a href="/billing" className="shrink-0 text-xs font-semibold underline hover:no-underline">
        Choose your plan →
      </a>
    </div>
  );
}

// Non-blocking nudge for unverified emails. Verification is NOT required to use the app;
// this just prompts the user and offers a resend. Dismissible for the session.
function VerifyEmailBanner() {
  const { role } = useAuth();
  const { data } = useSWR<{ success: boolean; data: { email: string; emailVerified: boolean } }>(
    role === 'client' ? '/clients' : null,
    fetcher,
  );
  const [sent, setSent] = useState(false);
  const [resendError, setResendError] = useState('');
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const client = data?.data;
  if (!client || client.emailVerified || dismissed) return null;

  const resend = async () => {
    setSending(true);
    try {
      // apiFetch does NOT throw on 4xx/5xx when the response is JSON — it returns
      // the parsed error body. So `setSent(true)` used to run even on failure,
      // and because the button renders behind {!sent} it then vanished, leaving
      // no way to retry and a user waiting for an email that never sent (#154).
      const res = await apiFetch<{ success: boolean; error?: { message: string } }>(
        '/auth/resend-verification',
        { method: 'POST', body: JSON.stringify({ email: client.email }) },
      );
      if (res?.success) {
        setSent(true);
      } else {
        setResendError(res?.error?.message ?? 'Could not send the email. Please try again.');
      }
    } catch (e) {
      setResendError((e as Error).message || 'Could not send the email. Please try again.');
    } finally { setSending(false); }
  };

  return (
    <div className="px-4 py-2 text-sm flex items-center justify-between gap-4 bg-forest text-white">
      <span>
        {sent
          ? 'Verification email sent — check your inbox.'
          : resendError
            ? resendError
            : 'Please verify your email address to secure your account and keep receiving reports.'}
      </span>
      <div className="flex items-center gap-3 shrink-0">
        {!sent && (
          <button
            onClick={() => void resend()}
            disabled={sending}
            className="text-xs font-semibold underline hover:no-underline disabled:opacity-60"
          >
            {sending ? 'Sending…' : 'Resend email'}
          </button>
        )}
        <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-xs opacity-80 hover:opacity-100">✕</button>
      </div>
    </div>
  );
}

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const { isAuthenticated } = useAuth();
  const { data: clientData } = useSWR<{ success: boolean; data: { businessName: string; email: string } }>(
    isAuthenticated ? '/clients' : null, fetcher,
  );
  const businessName = clientData?.data?.businessName ?? 'Your business';

  useEffect(() => {
    if (sidebarOpen) drawer.current?.showModal();
    else if (drawer.current?.open) drawer.current.close();
    if (Array.isArray(window.$crisp)) window.$crisp.push(['do', sidebarOpen ? 'chat:hide' : 'chat:show']);
  }, [sidebarOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (mq.matches) setSidebarOpen(false); };
    mq.addEventListener('change', closeOnDesktop);
    return () => mq.removeEventListener('change', closeOnDesktop);
  }, []);

  const sidebar = (mobile: boolean) => <div className="workspace-sidebar">
    <div className="px-5 pt-6 pb-5 flex items-center justify-between gap-3">
      <Link to="/dashboard" aria-label="SuperLocalSEO overview" onClick={() => setSidebarOpen(false)}>
        <img src="/sls_logo_wide_color-white.png" alt="SuperLocalSEO" className="h-7 w-auto" />
      </Link>
      {mobile && <button autoFocus onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" className="p-2 text-white"><X size={20} /></button>}
    </div>
    <div className="px-4 pb-4"><div className="workspace-business-pill">{businessName}</div></div>
    <SidebarNav onNav={() => setSidebarOpen(false)} />
  </div>;

  return <>
    <OnboardingRedirect />
    <CrispWidget />
    <a href="#workspace-main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 z-50 bg-white px-4 py-2">Skip to content</a>
    <div className="flex h-dvh min-h-0 bg-canvas">
      <aside className="workspace-desktop-sidebar" aria-label="Sidebar">{sidebar(false)}</aside>
      <dialog ref={drawer} className="workspace-mobile-dialog" aria-label="Navigation"
        onClose={() => setSidebarOpen(false)} onCancel={() => setSidebarOpen(false)}>
        {sidebar(true)}
      </dialog>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="workspace-topbar">
          <button className="lg:hidden p-2 rounded-lg text-forest" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar" aria-expanded={sidebarOpen}><Menu size={21} /></button>
          <div className="min-w-0"><p className="workspace-topbar-label">Your visibility workspace</p><p className="workspace-topbar-name">{businessName}</p></div>
          <Link to="/dashboard/settings" className="workspace-topbar-account">Account <span aria-hidden="true">↗</span></Link>
        </header>
        <VerifyEmailBanner />
        <TrialBanner />
        <main id="workspace-main" className="workspace-content flex-1 overflow-y-auto min-w-0" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  </>;
}
