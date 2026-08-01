import { useEffect, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Download, Trash2, Filter } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/lib/api";

const PAYMENT_MODES = ["Cash", "UPI/Bank"];

export default function Expenses() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [categories, setCategories] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [firms, setFirms] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [filter, setFilter] = useState({ category: "all", payment_mode: "all", start: "", end: "", preset: "all", firm_id: "all" });
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    date: today,
    vendor: "",
    category: "",
    amount: "",
    payment_mode: "UPI/Bank",
    notes: "",
    employee_id: "",
    firm_id: "",
  });

  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [c, ex, emp, f] = await Promise.all([
        api.get("/categories"),
        api.get("/expenses", {
          params: {
            ...(filter.category !== "all" ? { category: filter.category } : {}),
            ...(filter.payment_mode !== "all" ? { payment_mode: filter.payment_mode } : {}),
            ...(filter.firm_id !== "all" ? { firm_id: filter.firm_id } : {}),
            ...(filter.start ? { start: filter.start } : {}),
            ...(filter.end ? { end: filter.end } : {}),
          },
        }),
        api.get("/employees"),
        api.get("/firms"),
      ]);
      setCategories(c.data);
      setExpenses(ex.data);
      setEmployees(emp.data);
      setFirms(f.data);
      if (!form.category && c.data.length) setForm((prev) => ({ ...prev, category: c.data[0].name }));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filter.category, filter.payment_mode, filter.firm_id, filter.start, filter.end]);

  const applyPreset = (preset) => {
    const now = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    let start = "", end = "";
    if (preset === "today") {
      start = end = iso(now);
    } else if (preset === "this_week") {
      const d = new Date(now); d.setDate(d.getDate() - d.getDay());
      start = iso(d); end = iso(now);
    } else if (preset === "this_month") {
      start = iso(new Date(now.getFullYear(), now.getMonth(), 1));
      end = iso(now);
    } else if (preset === "last_month") {
      start = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      end = iso(new Date(now.getFullYear(), now.getMonth(), 0));
    } else if (preset === "this_quarter") {
      const q = Math.floor(now.getMonth() / 3);
      start = iso(new Date(now.getFullYear(), q * 3, 1));
      end = iso(now);
    } else if (preset === "this_fy") {
      // Indian FY starts April 1
      const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      start = iso(new Date(y, 3, 1));
      end = iso(now);
    }
    setFilter((f) => ({ ...f, preset, start, end }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.vendor || !form.amount || !form.category) {
      toast.error("Vendor, amount and category are required");
      return;
    }
    try {
      await api.post("/expenses", {
        ...form,
        amount: parseFloat(form.amount),
        employee_id: form.category === "Salary Advance" ? form.employee_id || null : null,
        firm_id: form.firm_id || null,
      });
      toast.success("Expense logged");
      setForm({ ...form, vendor: "", amount: "", notes: "", employee_id: "" });
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to log expense");
    }
  };

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      const r = await api.post("/categories", { name: newCatName.trim() });
      toast.success("Category added");
      setNewCatOpen(false);
      setNewCatName("");
      const cats = await api.get("/categories");
      setCategories(cats.data);
      setForm((f) => ({ ...f, category: r.data.name }));
    } catch (err) {
      toast.error("Failed to add category");
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this expense?")) return;
    try {
      await api.delete(`/expenses/${id}`);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  const exportCsv = () => {
    fetch(`${API}/expenses/export`, { credentials: "include" })
      .then(r => r.blob())
      .then(b => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = u; a.download = "expenses.csv"; a.click();
        URL.revokeObjectURL(u);
      });
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="text-xs font-mono-num uppercase tracking-widest text-zinc-500 mb-2">02 · Ledger</div>
          <h1 className="font-display text-4xl font-medium tracking-tight">Expenses</h1>
          <p className="text-sm text-zinc-500 mt-1">Fast entry with dynamic categories and payment mode.</p>
        </div>
        <Button
          data-testid="export-expenses-button"
          variant="outline"
          onClick={exportCsv}
          className="rounded-none border-zinc-300 hover:border-zinc-950"
        >
          <Download size={14} className="mr-2" /> Export CSV
        </Button>
      </div>

      {/* Entry Form */}
      <form onSubmit={submit} className="border border-zinc-200 bg-white p-6 mb-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="lg:col-span-1">
          <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Date</Label>
          <Input
            type="date"
            data-testid="expense-date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="mt-2 h-10 rounded-none border-zinc-300 focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 font-mono-num"
          />
        </div>
        <div className="lg:col-span-1">
          <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Vendor / Name</Label>
          <Input
            data-testid="expense-vendor"
            placeholder="e.g., HP Petrol Pump"
            value={form.vendor}
            onChange={(e) => setForm({ ...form, vendor: e.target.value })}
            className="mt-2 h-10 rounded-none border-zinc-300 focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950"
          />
        </div>
        <div className="lg:col-span-1">
          <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Category</Label>
          <Select value={form.category} onValueChange={(v) => {
            if (v === "__add__") { setNewCatOpen(true); return; }
            setForm({ ...form, category: v });
          }}>
            <SelectTrigger data-testid="expense-category" className="mt-2 h-10 rounded-none border-zinc-300">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent className="rounded-none bg-white border border-zinc-200">
              {categories.map((c) => (
                <SelectItem key={c.category_id} value={c.name} data-testid={`category-option-${c.name}`}>
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2" style={{ background: c.color }} />
                    {c.name}
                  </span>
                </SelectItem>
              ))}
              <SelectItem value="__add__" data-testid="add-custom-category-option">
                <span className="flex items-center gap-2 text-zinc-950 font-medium"><Plus size={12} /> Add Custom Category</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="lg:col-span-1">
          <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Amount (₹)</Label>
          <Input
            type="number"
            step="0.01"
            data-testid="expense-amount"
            placeholder="0"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="mt-2 h-10 rounded-none border-zinc-300 focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 font-mono-num"
          />
        </div>
        <div className="lg:col-span-1">
          <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Payment Mode</Label>
          <Select value={form.payment_mode} onValueChange={(v) => setForm({ ...form, payment_mode: v })}>
            <SelectTrigger data-testid="expense-payment-mode" className="mt-2 h-10 rounded-none border-zinc-300">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none bg-white border border-zinc-200">
              {PAYMENT_MODES.map((m) => (
                <SelectItem key={m} value={m} data-testid={`payment-mode-${m}`}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="lg:col-span-1 flex items-end">
          <Button
            type="submit"
            data-testid="submit-expense-button"
            className="w-full h-10 rounded-none bg-zinc-950 hover:bg-zinc-800 text-white active:scale-[0.99] transition-transform duration-150"
          >
            <Plus size={14} className="mr-2" /> Log Expense
          </Button>
        </div>
        {form.category === "Salary Advance" && (
          <div className="lg:col-span-2">
            <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Employee (for advance)</Label>
            <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
              <SelectTrigger data-testid="expense-employee" className="mt-2 h-10 rounded-none border-zinc-300">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent className="rounded-none bg-white border border-zinc-200">
                {employees.map((e) => (
                  <SelectItem key={e.employee_id} value={e.employee_id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {firms.length > 0 && (
          <div className="lg:col-span-2">
            <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Firm</Label>
            <select
              data-testid="expense-firm-select"
              value={form.firm_id}
              onChange={(e) => setForm({ ...form, firm_id: e.target.value })}
              className="mt-2 w-full h-10 border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:border-zinc-950"
            >
              <option value="">— Unassigned —</option>
              {firms.map((f) => <option key={f.firm_id} value={f.firm_id}>{f.name}</option>)}
            </select>
          </div>
        )}
        <div className="lg:col-span-4">
          <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Notes</Label>
          <Textarea
            data-testid="expense-notes"
            placeholder="Optional…"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="mt-2 rounded-none border-zinc-300 focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 min-h-[40px]"
          />
        </div>
      </form>

      {/* Filters */}
      <div className="border border-zinc-200 bg-white p-4 mb-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500 mr-1 flex items-center gap-1">
            <Filter size={12} /> Quick range
          </span>
          {[
            { k: "all", label: "All time" },
            { k: "today", label: "Today" },
            { k: "this_week", label: "This week" },
            { k: "this_month", label: "This month" },
            { k: "last_month", label: "Last month" },
            { k: "this_quarter", label: "This quarter" },
            { k: "this_fy", label: "This FY" },
          ].map((p) => (
            <button
              key={p.k}
              data-testid={`preset-${p.k}`}
              onClick={() => p.k === "all" ? setFilter({ ...filter, preset: "all", start: "", end: "" }) : applyPreset(p.k)}
              className={`text-xs px-3 h-8 border transition-colors duration-150 font-mono-num ${
                filter.preset === p.k
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-950"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">From</span>
            <input
              type="date"
              data-testid="filter-start-date"
              value={filter.start}
              onChange={(e) => setFilter({ ...filter, start: e.target.value, preset: "custom" })}
              className="h-8 border border-zinc-300 px-2 text-xs font-mono-num focus:outline-none focus:border-zinc-950 bg-white"
            />
            <span className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">To</span>
            <input
              type="date"
              data-testid="filter-end-date"
              value={filter.end}
              onChange={(e) => setFilter({ ...filter, end: e.target.value, preset: "custom" })}
              className="h-8 border border-zinc-300 px-2 text-xs font-mono-num focus:outline-none focus:border-zinc-950 bg-white"
            />
          </div>
          <Select value={filter.category} onValueChange={(v) => setFilter({ ...filter, category: v })}>
            <SelectTrigger data-testid="filter-category" className="w-56 h-8 rounded-none border-zinc-300 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-none bg-white border border-zinc-200">
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c.category_id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filter.payment_mode} onValueChange={(v) => setFilter({ ...filter, payment_mode: v })}>
            <SelectTrigger data-testid="filter-payment-mode" className="w-40 h-8 rounded-none border-zinc-300 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-none bg-white border border-zinc-200">
              <SelectItem value="all">All modes</SelectItem>
              {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          {firms.length > 0 && (
            <Select value={filter.firm_id} onValueChange={(v) => setFilter({ ...filter, firm_id: v })}>
              <SelectTrigger data-testid="filter-firm" className="w-48 h-8 rounded-none border-zinc-300 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-none bg-white border border-zinc-200">
                <SelectItem value="all">All firms</SelectItem>
                {firms.map((f) => <SelectItem key={f.firm_id} value={f.firm_id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto text-xs text-zinc-500 font-mono-num" data-testid="filter-result-count">
            {expenses.length} entr{expenses.length === 1 ? "y" : "ies"} · {formatINR(expenses.reduce((s, e) => s + e.amount, 0))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-zinc-200 bg-white overflow-x-auto">
        <table className="w-full text-sm" data-testid="expenses-table">
          <thead>
            <tr className="border-b border-zinc-200 text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">
              <th className="text-left py-3 px-4">Date</th>
              <th className="text-left py-3 px-4">Vendor</th>
              <th className="text-left py-3 px-4">Category</th>
              <th className="text-left py-3 px-4">Mode</th>
              <th className="text-right py-3 px-4">Amount</th>
              <th className="text-left py-3 px-4">Notes</th>
              {isOwner && <th className="w-12"></th>}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-8 text-zinc-500 text-sm">Loading…</td></tr>}
            {!loading && expenses.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-zinc-500 text-sm">No expenses yet. Log your first one above.</td></tr>
            )}
            {expenses.map((e) => (
              <tr key={e.expense_id} className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors duration-150" data-testid={`expense-row-${e.expense_id}`}>
                <td className="py-3 px-4 font-mono-num text-zinc-600">{e.date}</td>
                <td className="py-3 px-4">{e.vendor}</td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center gap-2 border border-zinc-200 px-2 py-0.5 text-xs">
                    {e.category}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className={`text-xs font-mono-num ${e.payment_mode === "Cash" ? "text-rose-600" : "text-zinc-950"}`}>
                    {e.payment_mode}
                  </span>
                </td>
                <td className="py-3 px-4 text-right font-mono-num font-medium">{formatINR(e.amount)}</td>
                <td className="py-3 px-4 text-xs text-zinc-500 truncate max-w-xs">{e.notes}</td>
                {isOwner && (
                  <td className="py-3 px-4 text-right">
                    <button
                      data-testid={`delete-expense-${e.expense_id}`}
                      onClick={() => remove(e.expense_id)}
                      className="text-zinc-400 hover:text-rose-600 transition-colors duration-150"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Custom Category Dialog */}
      <Dialog open={newCatOpen} onOpenChange={setNewCatOpen}>
        <DialogContent className="rounded-none bg-white border border-zinc-200 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">Add Custom Category</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Category name</Label>
            <Input
              data-testid="new-category-input"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="e.g., Internet Bill"
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
              className="rounded-none border-zinc-300 focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCatOpen(false)} className="rounded-none">Cancel</Button>
            <Button data-testid="save-category-button" onClick={addCategory} className="rounded-none bg-zinc-950 hover:bg-zinc-800">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
