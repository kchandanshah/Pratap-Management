import { useEffect, useState, Fragment } from "react";
import api, { formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, ChevronDown, ChevronRight, Check, RotateCcw, Pencil, FileText } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function StaffLedger() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const navigate = useNavigate();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [ledger, setLedger] = useState(null);
  const [firms, setFirms] = useState([]);
  const [firmFilter, setFirmFilter] = useState("all");
  const [expanded, setExpanded] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [form, setForm] = useState({ name: "", base_salary: "", role_title: "", firm_id: "" });
  const [advOpen, setAdvOpen] = useState(false);
  const [advForm, setAdvForm] = useState({ employee_id: "", amount: "", date: new Date().toISOString().slice(0, 10), payment_mode: "UPI/Bank", notes: "" });

  const load = async () => {
    const params = { month };
    if (firmFilter !== "all") params.firm_id = firmFilter;
    const [l, f] = await Promise.all([
      api.get("/ledger", { params }),
      api.get("/firms"),
    ]);
    setLedger(l.data);
    setFirms(f.data);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [month, firmFilter]);

  const toggleRepaid = async (expense_id, currentlyRepaid) => {
    try {
      await api.patch(`/expenses/${expense_id}/repay`, { repaid: !currentlyRepaid });
      toast.success(currentlyRepaid ? "Marked as outstanding" : "Marked as repaid");
      load();
    } catch (e) {
      toast.error("Failed to update");
    }
  };

  const openAdd = () => {
    setEditingEmp(null);
    setForm({ name: "", base_salary: "", role_title: "", firm_id: "" });
    setAddOpen(true);
  };
  const openEdit = (e) => {
    setEditingEmp(e);
    setForm({ name: e.name, base_salary: String(e.base_salary), role_title: e.role_title || "", firm_id: e.firm_id || "" });
    setAddOpen(true);
  };

  const saveEmployee = async () => {
    if (!form.name || !form.base_salary) return toast.error("Name and salary required");
    try {
      const payload = {
        name: form.name,
        base_salary: parseFloat(form.base_salary),
        role_title: form.role_title,
        firm_id: form.firm_id || null,
      };
      if (editingEmp) {
        await api.put(`/employees/${editingEmp.employee_id}`, payload);
        toast.success("Employee updated");
      } else {
        await api.post("/employees", payload);
        toast.success("Employee added");
      }
      setAddOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };

  const removeEmployee = async (id) => {
    if (!confirm("Remove this employee from active ledger?")) return;
    await api.delete(`/employees/${id}`);
    toast.success("Removed");
    load();
  };

  const addAdvance = async () => {
    if (!advForm.employee_id || !advForm.amount) return toast.error("Employee & amount required");
    try {
      const emp = ledger.employees.find(e => e.employee_id === advForm.employee_id);
      await api.post("/expenses", {
        date: advForm.date,
        vendor: emp?.name || "Advance",
        category: "Salary Advance",
        amount: parseFloat(advForm.amount),
        payment_mode: advForm.payment_mode,
        notes: advForm.notes,
        employee_id: advForm.employee_id,
      });
      toast.success("Advance recorded");
      setAdvOpen(false);
      setAdvForm({ employee_id: "", amount: "", date: new Date().toISOString().slice(0, 10), payment_mode: "UPI/Bank", notes: "" });
      load();
    } catch (e) {
      toast.error("Failed");
    }
  };

  const totalBase = (ledger?.employees || []).reduce((s, e) => s + e.base_salary, 0);
  const totalAdv = (ledger?.employees || []).reduce((s, e) => s + e.advances, 0);
  const totalNet = (ledger?.employees || []).reduce((s, e) => s + e.net_payable, 0);

  return (
    <div className="p-8 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="text-xs font-mono-num uppercase tracking-widest text-zinc-500 mb-2">03 · Payroll</div>
          <h1 className="font-display text-4xl font-medium tracking-tight">Staff Ledger</h1>
          <p className="text-sm text-zinc-500 mt-1">Base salary, month advances, and net payable at month-end.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            data-testid="ledger-month-picker"
            className="h-9 border border-zinc-300 px-3 text-sm font-mono-num focus:outline-none focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 bg-white"
          />
          <Button data-testid="record-advance-button" onClick={() => setAdvOpen(true)} variant="outline" className="rounded-none border-zinc-300 hover:border-zinc-950 h-9">
            <Plus size={14} className="mr-2" /> Record Advance
          </Button>
          {isOwner && (
            <Button data-testid="add-employee-button" onClick={openAdd} className="rounded-none bg-zinc-950 hover:bg-zinc-800 h-9">
              <Plus size={14} className="mr-2" /> Add Employee
            </Button>
          )}
        </div>
      </div>

      {/* Firm filter */}
      {firms.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500 mr-1">Firm</span>
          <button
            data-testid="firm-filter-all"
            onClick={() => setFirmFilter("all")}
            className={`text-xs px-3 h-8 border transition-colors duration-150 ${
              firmFilter === "all" ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white hover:border-zinc-950"
            }`}
          >
            All firms
          </button>
          {firms.map((f) => (
            <button
              key={f.firm_id}
              data-testid={`firm-filter-${f.firm_id}`}
              onClick={() => setFirmFilter(f.firm_id)}
              className={`text-xs px-3 h-8 border transition-colors duration-150 ${
                firmFilter === f.firm_id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white hover:border-zinc-950"
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total Base Salaries", value: formatINR(totalBase), testid: "total-base" },
          { label: "Total Advances Given", value: formatINR(totalAdv), testid: "total-advances" },
          { label: "Total Net Payable", value: formatINR(totalNet), testid: "total-net", accent: true },
        ].map((k) => (
          <div key={k.label} className={`border ${k.accent ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white"} p-5`} data-testid={k.testid}>
            <div className={`text-[10px] font-mono-num uppercase tracking-widest ${k.accent ? "text-zinc-300" : "text-zinc-500"}`}>{k.label}</div>
            <div className="font-mono-num text-2xl mt-2">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="border border-zinc-200 bg-white overflow-x-auto">
        <table className="w-full text-sm" data-testid="ledger-table">
          <thead>
            <tr className="border-b border-zinc-200 text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">
              <th className="text-left py-3 px-4">Employee</th>
              <th className="text-left py-3 px-4">Role</th>
              <th className="text-right py-3 px-4">Base Salary</th>
              <th className="text-right py-3 px-4">Paid Days</th>
              <th className="text-right py-3 px-4">Salary by Attendance</th>
              <th className="text-right py-3 px-4">Advances ({ledger?.month})</th>
              <th className="text-right py-3 px-4">Net Payable</th>
              {isOwner && <th className="w-12"></th>}
            </tr>
          </thead>
          <tbody>
            {!ledger && <tr><td colSpan={8} className="text-center py-8 text-zinc-500">Loading…</td></tr>}
            {ledger && ledger.employees.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-zinc-500">No employees yet. Add one to start tracking.</td></tr>
            )}
            {ledger?.employees.map((e) => {
              const isOpen = !!expanded[e.employee_id];
              const outstanding = (e.advance_entries || []).filter(a => !a.repaid);
              const repaid = (e.advance_entries || []).filter(a => a.repaid);
              return (
                <Fragment key={e.employee_id}>
                  <tr className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors duration-150" data-testid={`employee-row-${e.employee_id}`}>
                    <td className="py-3 px-4 font-medium">
                      <button
                        data-testid={`toggle-employee-${e.employee_id}`}
                        onClick={() => setExpanded({ ...expanded, [e.employee_id]: !isOpen })}
                        className="inline-flex items-center gap-2 hover:text-zinc-950 text-zinc-700"
                      >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {e.name}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-zinc-500 text-xs">{e.role_title || "—"}</td>
                    <td className="py-3 px-4 text-right font-mono-num">{formatINR(e.base_salary)}</td>
                    <td className="py-3 px-4 text-right font-mono-num">{e.attendance_recorded ? e.payable_days : "Full month"}</td>
                    <td className="py-3 px-4 text-right font-mono-num">{formatINR(e.attendance_salary || e.base_salary)}</td>
                    <td className="py-3 px-4 text-right font-mono-num text-rose-600">
                      -{formatINR(e.advances)}
                      {repaid.length > 0 && (
                        <div className="text-[10px] text-emerald-600 font-normal">
                          + {formatINR(repaid.reduce((s, a) => s + a.amount, 0))} repaid
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-emerald-700">{formatINR(e.net_payable)}</td>
                    {isOwner && (
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => navigate(`/payslip/${e.employee_id}?month=${ledger.month}`)}
                          data-testid={`payslip-${e.employee_id}`}
                          className="text-zinc-400 hover:text-zinc-950 mr-3"
                          title="View payslip"
                        >
                          <FileText size={14} />
                        </button>
                        <button
                          onClick={() => openEdit(e)}
                          data-testid={`edit-employee-${e.employee_id}`}
                          className="text-zinc-400 hover:text-zinc-950 mr-3"
                          title="Edit employee"
                        >
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => removeEmployee(e.employee_id)} data-testid={`delete-employee-${e.employee_id}`} className="text-zinc-400 hover:text-rose-600">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                  {isOpen && (
                    <tr className="bg-zinc-50/50" data-testid={`advances-detail-${e.employee_id}`}>
                      <td colSpan={isOwner ? 8 : 7} className="p-0">
                        <div className="px-8 py-4">
                          <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500 mb-3">
                            Advance entries for {ledger.month} · {e.advance_entries.length} total
                          </div>
                          {e.advance_entries.length === 0 ? (
                            <div className="text-sm text-zinc-500 py-3">No advances given this month.</div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-zinc-200 text-[10px] font-mono-num uppercase tracking-widest text-zinc-400">
                                  <th className="text-left py-2">Date</th>
                                  <th className="text-left py-2">Mode</th>
                                  <th className="text-right py-2">Amount</th>
                                  <th className="text-left py-2 pl-4">Notes</th>
                                  <th className="text-left py-2">Status</th>
                                  <th className="text-right py-2 w-40">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {e.advance_entries.map((a) => (
                                  <tr key={a.expense_id} className="border-b border-zinc-100 last:border-0" data-testid={`advance-row-${a.expense_id}`}>
                                    <td className="py-2 font-mono-num text-zinc-600">{a.date}</td>
                                    <td className="py-2">{a.payment_mode}</td>
                                    <td className="py-2 text-right font-mono-num">{formatINR(a.amount)}</td>
                                    <td className="py-2 pl-4 text-zinc-500 truncate max-w-xs">{a.notes || "—"}</td>
                                    <td className="py-2">
                                      {a.repaid ? (
                                        <span className="inline-flex items-center gap-1 text-emerald-700 text-[10px] font-mono-num uppercase tracking-widest">
                                          <Check size={10} /> Repaid
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 text-rose-600 text-[10px] font-mono-num uppercase tracking-widest">
                                          Outstanding
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 text-right">
                                      <button
                                        data-testid={`repay-advance-${a.expense_id}`}
                                        onClick={() => toggleRepaid(a.expense_id, a.repaid)}
                                        className={`inline-flex items-center gap-1 text-[10px] font-mono-num uppercase tracking-widest px-2 py-1 border transition-colors duration-150 ${
                                          a.repaid
                                            ? "border-zinc-300 text-zinc-700 hover:border-zinc-950"
                                            : "border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white"
                                        }`}
                                      >
                                        {a.repaid ? (<><RotateCcw size={10} /> Undo</>) : (<><Check size={10} /> Mark Repaid</>)}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Employee Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="rounded-none bg-white max-w-md">
          <DialogHeader><DialogTitle className="font-display">{editingEmp ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Name</Label>
              <Input data-testid="employee-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-2 rounded-none border-zinc-300" />
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Role / Title</Label>
              <Input data-testid="employee-role-input" value={form.role_title} onChange={(e) => setForm({ ...form, role_title: e.target.value })} className="mt-2 rounded-none border-zinc-300" placeholder="Optional" />
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Base Salary (₹)</Label>
              <Input data-testid="employee-salary-input" type="number" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} className="mt-2 rounded-none border-zinc-300 font-mono-num" />
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Firm</Label>
              <select
                data-testid="employee-firm-select"
                value={form.firm_id}
                onChange={(e) => setForm({ ...form, firm_id: e.target.value })}
                className="mt-2 w-full h-10 border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:border-zinc-950"
              >
                <option value="">— Unassigned —</option>
                {firms.map((f) => <option key={f.firm_id} value={f.firm_id}>{f.name}</option>)}
              </select>
              {firms.length === 0 && (
                <p className="text-[10px] text-zinc-500 mt-1">
                  Add firms in Settings to map employees.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} className="rounded-none">Cancel</Button>
            <Button data-testid="save-employee-button" onClick={saveEmployee} className="rounded-none bg-zinc-950 hover:bg-zinc-800">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Advance Dialog */}
      <Dialog open={advOpen} onOpenChange={setAdvOpen}>
        <DialogContent className="rounded-none bg-white max-w-md">
          <DialogHeader><DialogTitle className="font-display">Record Salary Advance</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Employee</Label>
              <select
                data-testid="advance-employee-select"
                value={advForm.employee_id}
                onChange={(e) => setAdvForm({ ...advForm, employee_id: e.target.value })}
                className="mt-2 w-full h-10 border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:border-zinc-950"
              >
                <option value="">Select employee</option>
                {ledger?.employees.map((e) => (
                  <option key={e.employee_id} value={e.employee_id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Date</Label>
                <Input type="date" value={advForm.date} onChange={(e) => setAdvForm({ ...advForm, date: e.target.value })} className="mt-2 rounded-none border-zinc-300 font-mono-num" />
              </div>
              <div>
                <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Amount (₹)</Label>
                <Input data-testid="advance-amount-input" type="number" value={advForm.amount} onChange={(e) => setAdvForm({ ...advForm, amount: e.target.value })} className="mt-2 rounded-none border-zinc-300 font-mono-num" />
              </div>
            </div>
            <div>
              <Label className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Payment Mode</Label>
              <select
                value={advForm.payment_mode}
                onChange={(e) => setAdvForm({ ...advForm, payment_mode: e.target.value })}
                className="mt-2 w-full h-10 border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:border-zinc-950"
              >
                <option>UPI/Bank</option>
                <option>Cash</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvOpen(false)} className="rounded-none">Cancel</Button>
            <Button data-testid="save-advance-button" onClick={addAdvance} className="rounded-none bg-zinc-950 hover:bg-zinc-800">Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
