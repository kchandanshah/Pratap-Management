import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = location.hash || window.location.hash;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const sessionId = params.get("session_id");

    if (!sessionId) {
      navigate("/");
      return;
    }

    (async () => {
      try {
        const r = await api.post("/auth/session", { session_id: sessionId });
        setUser(r.data);
        // Clean hash
        window.history.replaceState(null, "", "/#/dashboard");
        navigate("/dashboard", { replace: true });
      } catch (e) {
        console.error("Auth callback failed", e);
        navigate("/");
      }
    })();
  }, [location, navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center space-y-4">
        <div className="w-8 h-8 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-zinc-600 font-mono-num uppercase tracking-widest">Signing you in…</p>
      </div>
    </div>
  );
}
