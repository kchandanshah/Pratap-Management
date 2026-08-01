import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";

import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Dashboard from "@/pages/Dashboard";
import Expenses from "@/pages/Expenses";
import StaffLedger from "@/pages/StaffLedger";
import TaxCompliance from "@/pages/TaxCompliance";
import Users from "@/pages/Users";
import Settings from "@/pages/Settings";
import Payslip from "@/pages/Payslip";
import AppLayout from "@/components/AppLayout";

function ProtectedShell() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  return <AppLayout />;
}

function AppRoutes() {
  const location = useLocation();
  // Handle Google OAuth return
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route element={<ProtectedShell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/ledger" element={<StaffLedger />} />
        <Route path="/tax" element={<TaxCompliance />} />
        <Route path="/team" element={<Users />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/payslip/:employeeId" element={<Payslip />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <Toaster position="top-right" />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
