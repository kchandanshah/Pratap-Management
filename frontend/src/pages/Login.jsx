import { Button } from "@/components/ui/button";
import { Wallet, ChartLine, Users, Receipt } from "lucide-react";

export default function Login() {
  const handleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-zinc-950 text-zinc-100 overflow-hidden">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "url(https://images.unsplash.com/photo-1498262257252-c282316270bc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1OTV8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMGFyY2hpdGVjdHVyZSUyMHRleHR1cmV8ZW58MHx8fHwxNzg1NTgxMTE4fDA&ixlib=rb-4.1.0&q=85)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(9,9,11,0.4) 0%, rgba(9,9,11,0.9) 100%)",
          }}
        />
        <div className="relative z-10 flex items-center gap-2">
          <div className="w-8 h-8 border border-zinc-100 flex items-center justify-center">
            <Wallet size={18} />
          </div>
          <span className="font-display font-semibold tracking-tight">PRATAP | CALCI | LEDGER</span>
        </div>
        <div className="relative z-10 space-y-6">
          <h1 className="font-display text-5xl xl:text-6xl font-medium leading-[0.95] tracking-tight">
            Every rupee.<br />
            Every challan.<br />
            Every advance.
          </h1>
          <p className="text-zinc-400 max-w-md">
            An operator-grade ledger for daily expenses, staff salary advances, and GST/ITR compliance.
            Built for Indian SMBs.
          </p>
          <div className="grid grid-cols-3 gap-4 pt-8 max-w-md">
            {[
              { icon: Receipt, label: "Expenses" },
              { icon: Users, label: "Staff Ledger" },
              { icon: ChartLine, label: "Tax Register" },
            ].map((f) => (
              <div key={f.label} className="border border-zinc-800 p-4 bg-zinc-900/50">
                <f.icon size={18} className="mb-2 text-zinc-300" />
                <div className="text-xs text-zinc-400">{f.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-xs text-zinc-500 font-mono-num">v1.0 · IN · ₹</div>
      </div>

      {/* Right panel */}
      <div className="flex items-center justify-center p-8 lg:p-16 bg-white">
        <div className="w-full max-w-md space-y-8 animate-fade-in">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="w-8 h-8 border border-zinc-950 flex items-center justify-center">
              <Wallet size={18} />
            </div>
            <span className="font-display font-semibold tracking-tight">PRATAP | CALCI | LEDGER</span>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-mono-num uppercase tracking-widest text-zinc-500">
              01 · Access
            </div>
            <h2 className="font-display text-4xl font-medium tracking-tight">Sign in to continue</h2>
            <p className="text-sm text-zinc-500">
              Access is private. Your Google email must be invited by an Owner before you can sign in.
            </p>
          </div>
          <Button
            data-testid="google-signin-button"
            onClick={handleLogin}
            className="w-full h-12 rounded-none bg-zinc-950 hover:bg-zinc-800 text-white transition-colors duration-150 active:scale-[0.99]"
          >
            <svg className="w-4 h-4 mr-2" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C33.7 6.1 29.1 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C33.7 6.1 29.1 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.2 2.4-5.3 0-9.8-3.4-11.4-8.1l-6.6 5.1C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.6l6.2 5.2c-.4.3 6.6-4.9 6.6-14.8 0-1.3-.1-2.4-.4-3.5z"/>
            </svg>
            Continue with Google
          </Button>
          <div className="pt-8 border-t border-zinc-200 space-y-3">
            <div className="text-xs font-mono-num uppercase tracking-widest text-zinc-500">
              02 · What you get
            </div>
            <ul className="space-y-2 text-sm">
              {[
                "Fast expense entry with custom categories",
                "Monthly staff advance & net-payable calc",
                "GST + ITR challan register",
                "Cash vs UPI split & category charts",
              ].map((t) => (
                <li key={t} className="flex gap-2 text-zinc-700">
                  <span className="text-zinc-950 font-mono-num">—</span> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
