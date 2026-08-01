import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Shield, Trash2, ArrowUpRight, ArrowDownRight, Users as UsersIcon, AlertTriangle, Mail, Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "react-router-dom";

export default function Users() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [invites, setInvites] = useState([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "accountant" });

  const load = async () => {
    setLoading(true);
    try {
      const [r, inv] = await Promise.all([
        api.get("/users"),
        api.get("/invitations").catch(() => ({ data: [] })),
      ]);
      setRows(r.data);
      setInvites(inv.data || []);
    } catch (e) {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const sendInvite = async () => {
    const email = inviteForm.email.trim().toLowerCase();
    if (!email || !email.includes("@")) return toast.error("Valid email required");
    try {
      const r = await api.post("/invitations", { email, role: inviteForm.role });
      toast.success(
        r.data.applied_to_existing_user
          ? `${email} is now ${inviteForm.role}`
          : `Invitation saved. ${email} will be ${inviteForm.role} on first sign-in.`
      );
      setInviteOpen(false);
      setInviteForm({ email: "", role: "accountant" });
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to invite");
    }
  };

  const revokeInvite = async (email) => {
    if (!confirm(`Revoke invitation for ${email}?`)) return;
    try {
      await api.delete(`/invitations/${encodeURIComponent(email)}`);
      toast.success("Invitation revoked");
      load();
    } catch (e) {
      toast.error("Failed");
    }
  };

  if (user && user.role !== "owner") return <Navigate to="/dashboard" replace />;

  const changeRole = async (u, newRole) => {
    if (u.user_id === user.user_id && newRole === "accountant") {
      const owners = rows.filter((r) => r.role === "owner").length;
      if (owners <= 1) {
        toast.error("You can't demote the last owner");
        return;
      }
      if (!confirm("Demote yourself to accountant? You will lose owner privileges.")) return;
    }
    try {
      await api.put(`/users/${u.user_id}/role`, { role: newRole });
      toast.success(`Role updated to ${newRole}`);
      load();
    } catch (e) {
      toast.error("Failed to update role");
    }
  };

  const removeUser = async (u) => {
    if (!confirm(`Remove ${u.name} (${u.email})? This will end their session immediately.`)) return;
    try {
      await api.delete(`/users/${u.user_id}`);
      toast.success("User removed");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to remove user");
    }
  };

  const resetData = async () => {
    if (resetConfirm !== "RESET") {
      toast.error("Type RESET to confirm");
      return;
    }
    setResetting(true);
    try {
      const r = await api.post("/admin/reset", { confirm: "RESET" });
      const d = r.data.deleted;
      toast.success(`Wiped ${d.expenses} expenses, ${d.employees} employees, ${d.tax_entries} tax entries, ${d.custom_categories} custom categories`);
      setResetOpen(false);
      setResetConfirm("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const owners = rows.filter((r) => r.role === "owner").length;
  const accountants = rows.filter((r) => r.role === "accountant").length;

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="text-xs font-mono-num uppercase tracking-widest text-zinc-500 mb-2">05 · Access</div>
          <h1 className="font-display text-4xl font-medium tracking-tight">Team</h1>
          <p className="text-sm text-zinc-500 mt-1">Promote accountants to owners, or remove access instantly.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="invite-user-button"
            onClick={() => setInviteOpen(true)}
            className="rounded-none bg-zinc-950 hover:bg-zinc-800 h-9"
          >
            <Mail size={14} className="mr-2" /> Invite by Email
          </Button>
          <Button
            data-testid="reset-data-button"
            variant="outline"
            onClick={() => setResetOpen(true)}
            className="rounded-none border-rose-300 text-rose-700 hover:border-rose-600 hover:bg-rose-50 h-9"
          >
            <AlertTriangle size={14} className="mr-2" /> Reset App Data
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="border border-zinc-200 bg-white p-5" data-testid="stat-owners">
          <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Owners</div>
          <div className="font-mono-num text-2xl mt-2">{owners}</div>
        </div>
        <div className="border border-zinc-200 bg-white p-5" data-testid="stat-accountants">
          <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Accountants</div>
          <div className="font-mono-num text-2xl mt-2">{accountants}</div>
        </div>
      </div>

      <div className="border border-zinc-200 bg-white overflow-x-auto">
        <table className="w-full text-sm" data-testid="users-table">
          <thead>
            <tr className="border-b border-zinc-200 text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">
              <th className="text-left py-3 px-4">User</th>
              <th className="text-left py-3 px-4">Email</th>
              <th className="text-left py-3 px-4">Role</th>
              <th className="text-right py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="text-center py-8 text-zinc-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={4} className="text-center py-8 text-zinc-500">
                <UsersIcon size={32} className="mx-auto text-zinc-300 mb-2" />
                No team members yet. Invite users by email. Only invited users can sign in and access this workspace.
              </td></tr>
            )}
            {rows.map((u) => {
              const isSelf = u.user_id === user.user_id;
              return (
                <tr key={u.user_id} className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors duration-150" data-testid={`user-row-${u.user_id}`}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      {u.picture ? (
                        <img src={u.picture} alt="" className="w-8 h-8 rounded-full border border-zinc-200" />
                      ) : (
                        <div className="w-8 h-8 bg-zinc-900 text-white text-xs flex items-center justify-center rounded-full font-mono-num">
                          {u.name?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{u.name}{isSelf && <span className="ml-2 text-[10px] font-mono-num text-zinc-500 uppercase tracking-widest">You</span>}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs text-zinc-600 font-mono-num">{u.email}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-mono-num uppercase tracking-widest px-2 py-1 border ${
                      u.role === "owner" ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300 text-zinc-700 bg-white"
                    }`}>
                      <Shield size={10} /> {u.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                    {u.role === "accountant" ? (
                      <Button
                        data-testid={`promote-${u.user_id}`}
                        size="sm"
                        onClick={() => changeRole(u, "owner")}
                        className="rounded-none bg-zinc-950 hover:bg-zinc-800 h-8 text-xs"
                      >
                        <ArrowUpRight size={12} className="mr-1" /> Promote to Owner
                      </Button>
                    ) : (
                      <Button
                        data-testid={`demote-${u.user_id}`}
                        size="sm"
                        variant="outline"
                        onClick={() => changeRole(u, "accountant")}
                        className="rounded-none border-zinc-300 hover:border-zinc-950 h-8 text-xs"
                        disabled={owners <= 1}
                        title={owners <= 1 ? "Cannot demote the last owner" : ""}
                      >
                        <ArrowDownRight size={12} className="mr-1" /> Demote
                      </Button>
                    )}
                    {!isSelf && (
                      <Button
                        data-testid={`remove-user-${u.user_id}`}
                        size="sm"
                        variant="outline"
                        onClick={() => removeUser(u)}
                        className="rounded-none border-zinc-300 hover:border-rose-600 hover:text-rose-600 h-8 text-xs"
                      >
                        <Trash2 size={12} className="mr-1" /> Remove
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pending invitations */}
      {invites.length > 0 && (
        <div className="mt-10">
          <div className="mb-4">
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Pre-approved emails</div>
            <h2 className="font-display text-xl font-medium tracking-tight mt-1">Invitations</h2>
            <p className="text-xs text-zinc-500 mt-1">These emails will get the assigned role automatically the moment they Google-sign-in.</p>
          </div>
          <div className="border border-zinc-200 bg-white">
            <table className="w-full text-sm" data-testid="invites-table">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">
                  <th className="text-left py-3 px-4">Email</th>
                  <th className="text-left py-3 px-4">Role on Sign-in</th>
                  <th className="text-right py-3 px-4 w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.email} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`invite-row-${inv.email}`}>
                    <td className="py-3 px-4 font-mono-num text-sm">{inv.email}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono-num uppercase tracking-widest px-2 py-1 border border-zinc-300 text-zinc-700 bg-white">
                        <Shield size={10} /> {inv.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        data-testid={`revoke-invite-${inv.email}`}
                        onClick={() => revokeInvite(inv.email)}
                        className="text-zinc-400 hover:text-rose-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="rounded-none bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Invite by Email</DialogTitle>
            <DialogDescription className="text-zinc-500 text-sm">
              Pre-approve an email address. When they sign in with Google using that email, they instantly get the role you choose below. If they already exist in the app, their role is updated immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Google Email</Label>
              <Input
                data-testid="invite-email-input"
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                placeholder="name@company.com"
                className="mt-2 rounded-none border-zinc-300 focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 font-mono-num"
              />
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Assign Role</Label>
              <select
                data-testid="invite-role-select"
                value={inviteForm.role}
                onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                className="mt-2 w-full h-10 border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:border-zinc-950"
              >
                <option value="accountant">Accountant</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)} className="rounded-none">Cancel</Button>
            <Button data-testid="send-invite-button" onClick={sendInvite} className="rounded-none bg-zinc-950 hover:bg-zinc-800">
              <Plus size={14} className="mr-2" /> Save Invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="rounded-none bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <AlertTriangle size={18} className="text-rose-600" /> Reset App Data
            </DialogTitle>
            <DialogDescription className="text-zinc-600 pt-2">
              This will permanently delete <span className="font-semibold text-zinc-950">all expenses, employees, tax entries, and custom categories</span>.
              Your team members, default categories, and this app itself are preserved.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">
              Type <span className="text-rose-600 font-semibold">RESET</span> to confirm
            </Label>
            <Input
              data-testid="reset-confirm-input"
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              placeholder="RESET"
              className="rounded-none border-zinc-300 focus:border-rose-600 focus:ring-1 focus:ring-rose-600 font-mono-num"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetOpen(false); setResetConfirm(""); }} className="rounded-none">Cancel</Button>
            <Button
              data-testid="confirm-reset-button"
              onClick={resetData}
              disabled={resetConfirm !== "RESET" || resetting}
              className="rounded-none bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
            >
              {resetting ? "Wiping…" : "Wipe All Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
