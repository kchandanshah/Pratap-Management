import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Building2, Trash2, Pencil, Info } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "react-router-dom";

export default function Settings() {
  const { user } = useAuth();
  const [firms, setFirms] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", gst_number: "", address: "" });

  const load = async () => {
    const r = await api.get("/firms");
    setFirms(r.data);
  };
  useEffect(() => { load(); }, []);

  if (user && user.role !== "owner") return <Navigate to="/dashboard" replace />;

  const openNew = () => { setEditing(null); setForm({ name: "", gst_number: "", address: "" }); setOpen(true); };
  const openEdit = (f) => { setEditing(f); setForm({ name: f.name, gst_number: f.gst_number || "", address: f.address || "" }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Firm name required"); return; }
    try {
      if (editing) {
        await api.put(`/firms/${editing.firm_id}`, form);
        toast.success("Firm updated");
      } else {
        await api.post("/firms", form);
        toast.success("Firm added");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };

  const remove = async (f) => {
    if (!confirm(`Delete "${f.name}"? Employees and entries mapped to this firm will become unassigned.`)) return;
    try {
      await api.delete(`/firms/${f.firm_id}`);
      toast.success("Firm removed");
      load();
    } catch (e) { toast.error("Failed"); }
  };

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="text-xs font-mono-num uppercase tracking-widest text-zinc-500 mb-2">06 · Configuration</div>
          <h1 className="font-display text-4xl font-medium tracking-tight">Settings</h1>
          <p className="text-sm text-zinc-500 mt-1">Manage your firms, deployment, and app configuration.</p>
        </div>
      </div>

      {/* Firms section */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">A · Firms</div>
            <h2 className="font-display text-2xl font-medium tracking-tight mt-1 flex items-center gap-2">
              <Building2 size={20} /> Your Businesses
            </h2>
            <p className="text-xs text-zinc-500 mt-1">Add each firm you operate. Employees, expenses and tax entries can be mapped to a firm.</p>
          </div>
          <Button data-testid="add-firm-button" onClick={openNew} className="rounded-none bg-zinc-950 hover:bg-zinc-800 h-9">
            <Plus size={14} className="mr-2" /> Add Firm
          </Button>
        </div>

        <div className="border border-zinc-200 bg-white">
          <table className="w-full text-sm" data-testid="firms-table">
            <thead>
              <tr className="border-b border-zinc-200 text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">
                <th className="text-left py-3 px-4">Firm Name</th>
                <th className="text-left py-3 px-4">GST Number</th>
                <th className="text-left py-3 px-4">Address</th>
                <th className="text-right py-3 px-4 w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {firms.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-zinc-500">No firms yet. Add your first business to start mapping.</td></tr>}
              {firms.map((f) => (
                <tr key={f.firm_id} className="border-b border-zinc-100 hover:bg-zinc-50" data-testid={`firm-row-${f.firm_id}`}>
                  <td className="py-3 px-4 font-medium">{f.name}</td>
                  <td className="py-3 px-4 font-mono-num text-xs text-zinc-600">{f.gst_number || "—"}</td>
                  <td className="py-3 px-4 text-xs text-zinc-500">{f.address || "—"}</td>
                  <td className="py-3 px-4 text-right space-x-2">
                    <button data-testid={`edit-firm-${f.firm_id}`} onClick={() => openEdit(f)} className="text-zinc-400 hover:text-zinc-950 p-1"><Pencil size={14} /></button>
                    <button data-testid={`delete-firm-${f.firm_id}`} onClick={() => remove(f)} className="text-zinc-400 hover:text-rose-600 p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* App info */}
      <section>
        <div className="mb-4">
          <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">B · App</div>
          <h2 className="font-display text-2xl font-medium tracking-tight mt-1 flex items-center gap-2">
            <Info size={20} /> App Information
          </h2>
        </div>
        <div className="border border-zinc-200 bg-white p-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Brand</div>
            <div className="font-display text-lg mt-1">PRATAP | CALCI | LEDGER</div>
          </div>
          <div>
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Owner Signed In</div>
            <div className="mt-1">{user?.name} · <span className="text-zinc-500 font-mono-num text-xs">{user?.email}</span></div>
          </div>
          <div>
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Currency</div>
            <div className="mt-1 font-mono-num">INR (₹)</div>
          </div>
          <div>
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Time Zone</div>
            <div className="mt-1 font-mono-num">IST (UTC+5:30)</div>
          </div>
        </div>
      </section>

      {/* Firm dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">{editing ? "Edit Firm" : "Add Firm"}</DialogTitle>
            <DialogDescription className="text-zinc-500 text-sm">
              A firm represents a business you operate. Employees, expenses and tax entries can be mapped to it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Firm Name</Label>
              <Input data-testid="firm-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-2 rounded-none border-zinc-300" />
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">GST Number</Label>
              <Input data-testid="firm-gst-input" value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} className="mt-2 rounded-none border-zinc-300 font-mono-num" placeholder="Optional" />
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Address</Label>
              <Textarea data-testid="firm-address-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-2 rounded-none border-zinc-300 min-h-[60px]" placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">Cancel</Button>
            <Button data-testid="save-firm-button" onClick={save} className="rounded-none bg-zinc-950 hover:bg-zinc-800">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
