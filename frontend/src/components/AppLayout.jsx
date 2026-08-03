import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { LayoutDashboard, Receipt, Users, FileText, LogOut, Wallet, Shield, UsersRound, Settings as SettingsIcon, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/expenses", label: "Expenses", icon: Receipt, testid: "nav-expenses" },
  { to: "/ledger", label: "Staff Ledger", icon: Users, testid: "nav-ledger" },
  { to: "/attendance", label: "Attendance", icon: CalendarCheck, testid: "nav-attendance" },
  { to: "/tax", label: "Tax Compliance", icon: FileText, testid: "nav-tax" },
];

const OWNER_NAV = [
  { to: "/team", label: "Team", icon: UsersRound, testid: "nav-team" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, testid: "nav-settings" },
  { to: "/controls", label: "Controls", icon: SettingsIcon, testid: "nav-controls" },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    navigate("/");
    return null;
  }

  return (
    <div className="min-h-screen flex bg-[#FAFAFA]">
      <aside className="w-64 border-r border-zinc-200 bg-white flex flex-col sticky top-0 h-screen">
        <div className="p-5 border-b border-zinc-200 flex items-center gap-2">
          <div className="w-8 h-8 border border-zinc-950 flex items-center justify-center">
            <Wallet size={16} />
          </div>
          <div>
            <div className="font-display text-sm font-semibold tracking-tight leading-none">PRATAP | CALCI | LEDGER</div>
            <div className="text-[10px] font-mono-num text-zinc-500 uppercase tracking-widest mt-1">Ledger Works · IN</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              data-testid={n.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 text-sm border-l-2 transition-colors duration-150 ${
                  isActive
                    ? "border-zinc-950 bg-zinc-50 text-zinc-950 font-medium"
                    : "border-transparent text-zinc-600 hover:text-zinc-950 hover:bg-zinc-50"
                }`
              }
            >
              <n.icon size={16} />
              {n.label}
            </NavLink>
          ))}
          {user.role === "owner" && (
            <>
              <div className="pt-4 pb-1 px-3 text-[10px] font-mono-num uppercase tracking-widest text-zinc-400">Admin</div>
              {OWNER_NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  data-testid={n.testid}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 text-sm border-l-2 transition-colors duration-150 ${
                      isActive
                        ? "border-zinc-950 bg-zinc-50 text-zinc-950 font-medium"
                        : "border-transparent text-zinc-600 hover:text-zinc-950 hover:bg-zinc-50"
                    }`
                  }
                >
                  <n.icon size={16} />
                  {n.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <div className="p-3 border-t border-zinc-200 space-y-2">
          <div className="flex items-center gap-3 p-2">
            {user.picture ? (
              <img src={user.picture} alt="" className="w-8 h-8 rounded-full border border-zinc-200" />
            ) : (
              <div className="w-8 h-8 bg-zinc-900 text-white text-xs flex items-center justify-center rounded-full font-mono-num">
                {user.name?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate" data-testid="user-name">{user.name}</div>
              <div className="text-[10px] uppercase font-mono-num tracking-widest text-zinc-500 flex items-center gap-1">
                <Shield size={10} /> <span data-testid="user-role">{user.role}</span>
              </div>
            </div>
          </div>
          <Button
            data-testid="logout-button"
            variant="outline"
            onClick={logout}
            className="w-full h-9 rounded-none border-zinc-200 hover:border-zinc-950 hover:bg-white text-xs justify-start"
          >
            <LogOut size={14} className="mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
