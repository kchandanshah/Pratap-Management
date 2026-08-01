import { useEffect, useState } from "react";
import api, { formatINR, API } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Download, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function TaxCompliance() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [entries, setEntries] = useState([]);
  const [firms, setFirms] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    tax_type: "GST",
    period: "",
    challan_number: "",
    amount: "",
    payment_mode: "UPI/Bank",
    notes: "",
    firm_id: "",
  });

  const load = async () => {
    const [r, f] = await Promise.all([api.get("/tax"), api.get("/firms")]);
    setEntries(r.data);
    setFirms(f.data);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.challan_number || !form.amount) {
      toast.error("Challan number and amount required");
      return;
    }
    try {
      await api.post("/tax", { ...form, amount: parseFloat(form.amount), firm_id: form.firm_id || null });
      toast.success("Tax entry recorded");
      setOpen(false);
      setForm({ ...form, challan_number: "", amount: "", period: "", notes: "" });
      load();
    } catch (e) {
      toast.error("Failed");
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this tax entry?")) return;
    await api.delete(`/tax/${id}`);
    toast.success("Deleted");
    load();
  };

  const exportCsv = () => {
    fetch(`${API}/tax/export`, { credentials: "include" })
      .then(r => r.blob())
      .then(b => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = u; a.download = "tax_register.csv"; a.click();
        URL.revokeObjectURL(u);
      });
  };

  const totalGst = entries.filter(e => e.tax_type === "GST").reduce((s, e) => s + e.amount, 0);
  const totalItr = entries.filter(e => e.tax_type === "ITR Advance Tax").reduce((s, e) => s + e.amount, 0);

  return (
    <div className="p-8 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="text-xs font-mono-num uppercase tracking-widest text-zinc-500 mb-2">04 · Compliance</div>
          <h1 className="font-display text-4xl font-medium tracking-tight">Tax Register</h1>
          <p className="text-sm text-zinc-500 mt-1">GST and ITR Advance Tax payments with challan numbers.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button data-testid="export-tax-button" variant="outline" onClick={exportCsv} className="rounded-none border-zinc-300 hover:border-zinc-950 h-9">
            <Download size={14} className="mr-2" /> Export CSV
          </Button>
          <Button data-testid="add-tax-button" onClick={() => setOpen(true)} className="rounded-none bg-zinc-950 hover:bg-zinc-800 h-9">
            <Plus size={14} className="mr-2" /> Record Payment
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="border border-zinc-200 bg-white p-5" data-testid="total-gst">
          <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Total GST Paid</div>
          <div className="font-mono-num text-2xl mt-2">{formatINR(totalGst)}</div>
        </div>
        <div className="border border-zinc-200 bg-white p-5" data-testid="total-itr">
          <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Total ITR Advance Tax</div>
          <div className="font-mono-num text-2xl mt-2">{formatINR(totalItr)}</div>
        </div>
      </div>

      <div className="border border-zinc-200 bg-white overflow-x-auto">
        <table className="w-full text-sm" data-testid="tax-table">
          <thead>
            <tr className="border-b border-zinc-200 text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">
              <th className="text-left py-3 px-4">Date</th>
              <th className="text-left py-3 px-4">Tax Type</th>
              <th className="text-left py-3 px-4">Period</th>
              <th className="text-left py-3 px-4">Challan No.</th>
              <th className="text-left py-3 px-4">Mode</th>
              <th className="text-right py-3 px-4">Amount</th>
              <th className="text-left py-3 px-4">Notes</th>
              {isOwner && <th className="w-12"></th>}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-zinc-500">No tax entries yet.</td></tr>}
            {entries.map((e) => (
              <tr key={e.tax_id} className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors duration-150">
                <td className="py-3 px-4 font-mono-num text-zinc-600">{e.date}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs border px-2 py-0.5 ${e.tax_type === "GST" ? "border-blue-300 text-blue-700 bg-blue-50" : "border-amber-300 text-amber-700 bg-amber-50"}`}>
                    {e.tax_type}
                  </span>
                </td>
                <td className="py-3 px-4 text-xs text-zinc-500">{e.period || "—"}</td>
                <td className="py-3 px-4 font-mono-num text-xs">{e.challan_number}</td>
                <td className="py-3 px-4 text-xs">{e.payment_mode}</td>
                <td className="py-3 px-4 text-right font-mono-num font-medium">{formatINR(e.amount)}</td>
                <td className="py-3 px-4 text-xs text-zinc-500 truncate max-w-xs">{e.notes}</td>
                {isOwner && (
                  <td className="py-3 px-4 text-right">
                    <button onClick={() => remove(e.tax_id)} data-testid={`delete-tax-${e.tax_id}`} className="text-zinc-400 hover:text-rose-600">
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none bg-white max-w-lg">
          <DialogHeader><DialogTitle className="font-display">Record Tax Payment</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2 grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-2 rounded-none border-zinc-300 font-mono-num" />
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Tax Type</Label>
              <select
                data-testid="tax-type-select"
                value={form.tax_type}
                onChange={(e) => setForm({ ...form, tax_type: e.target.value })}
                className="mt-2 w-full h-10 border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:border-zinc-950"
              >
                <option>GST</option>
                <option>ITR Advance Tax</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Period</Label>
              <Input data-testid="tax-period-input" placeholder="e.g., Q1 FY25-26" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} className="mt-2 rounded-none border-zinc-300" />
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Challan No.</Label>
              <Input data-testid="tax-challan-input" value={form.challan_number} onChange={(e) => setForm({ ...form, challan_number: e.target.value })} className="mt-2 rounded-none border-zinc-300 font-mono-num" />
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Amount (₹)</Label>
              <Input data-testid="tax-amount-input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-2 rounded-none border-zinc-300 font-mono-num" />
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Payment Mode</Label>
              <select
                value={form.payment_mode}
                onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}
                className="mt-2 w-full h-10 border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:border-zinc-950"
              >
                <option>UPI/Bank</option>
                <option>Cash</option>
              </select>
            </div>
            <div className="col-span-2">
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-2 rounded-none border-zinc-300 min-h-[40px]" />
            </div>
            {firms.length > 0 && (
              <div className="col-span-2">
                <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Firm</Label>
                <select
                  data-testid="tax-firm-select"
                  value={form.firm_id}
                  onChange={(e) => setForm({ ...form, firm_id: e.target.value })}
                  className="mt-2 w-full h-10 border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:border-zinc-950"
                >
                  <option value="">— Unassigned —</option>
                  {firms.map((f) => <option key={f.firm_id} value={f.firm_id}>{f.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">Cancel</Button>
            <Button data-testid="save-tax-button" onClick={submit} className="rounded-none bg-zinc-950 hover:bg-zinc-800">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
