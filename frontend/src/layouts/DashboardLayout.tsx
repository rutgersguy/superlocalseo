import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Home, BarChart2, Star, Link2, Settings, LogOut, Menu, X, FileText, Megaphone, Users2, ClipboardList } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: <Home size={18} aria-hidden="true" /> },
  { to: '/dashboard/rankings', label: 'Rankings', icon: <BarChart2 size={18} aria-hidden="true" /> },
  { to: '/dashboard/reviews', label: 'Reviews', icon: <Star size={18} aria-hidden="true" /> },
  { to: '/dashboard/campaigns', label: 'Campaigns', icon: <Megaphone size={18} aria-hidden="true" /> },
  { to: '/dashboard/competitors', label: 'Competitors', icon: <Users2 size={18} aria-hidden="true" /> },
  { to: '/dashboard/citations', label: 'Citations', icon: <Link2 size={18} aria-hidden="true" /> },
  { to: '/dashboard/audit', label: 'SEO Audit', icon: <ClipboardList size={18} aria-hidden="true" /> },
  { to: '/dashboard/reports', label: 'Reports', icon: <FileText size={18} aria-hidden="true" /> },
  { to: '/dashboard/settings', label: 'Settings', icon: <Settings size={18} aria-hidden="true" /> },
];

function SidebarNav({ onNav }: { onNav?: () => void }) {
  const { logout } = useAuth();
  return (
    <>
      <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Dashboard navigation">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/dashboard'}
            onClick={onNav}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-500 text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-gray-100">
        <button
          onClick={() => void logout()}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          aria-label="Sign out"
        >
          <LogOut size={18} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </>
  );
}

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — desktop: always visible; mobile: slide-in drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-[220px] bg-white border-r border-gray-200 flex flex-col transform transition-transform duration-200 ease-in-out
          lg:relative lg:translate-x-0 lg:flex-shrink-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
        aria-label="Sidebar"
      >
        <div className="px-5 py-5 border-b border-gray-100 flex items-center justify-between">
          <span className="text-lg font-bold text-brand-500">SuperLocalSEO</span>
          <button
            className="lg:hidden p-1 rounded text-gray-400 hover:text-gray-600"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>
        <SidebarNav onNav={() => setSidebarOpen(false)} />
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <span className="text-base sm:text-lg font-semibold text-gray-900">SuperLocalSEO</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
