import { useEffect, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function Controls() {
  const { user } = useAuth(); const month = new Date().toISOString().slice(0, 7);
  const [reminders, setReminders] = useState([]); const [recurring, setRecurring] = useState([]); const [report, setReport] = useState(null);
  const [form, setForm] = useState({ vendor: "", category: "Office Expense", amount: "", day_of_month: "1" });
  const load = async () => { const [a,b] = await Promise.all([api.get("/reminders"), api.get("/recurring-expenses")]); setReminders(a.data); setRecurring(b.data); };
  useEffect(() => { load(); }, []);
  if (user?.role !== "owner") return <Navigate to="/dashboard" replace />;
  const addRecurring = async () => { try { await api.post("/recurring-expenses", {...form, amount: +form.amount, day_of_month: +form.day_of_month}); setForm({vendor:"",category:"Office Expense",amount:"",day_of_month:"1"}); load(); toast.success("Recurring expense saved"); } catch { toast.error("Complete the recurring expense fields"); } };
  const importCsv = async (e) => { const f=e.target.files?.[0]; if (!f) return; const d=new FormData(); d.append("file", f); try { const r=await api.post("/expenses/import",d); toast.success(`${r.data.imported} entries imported`); } catch(e) { toast.error(e.response?.data?.detail||"Import failed"); } };
  const runReport = async () => { const start=`${month}-01`, end=new Date(new Date(`${month}-01`).getFullYear(), new Date(`${month}-01`).getMonth()+1, 0).toISOString().slice(0,10); const r=await api.get("/reports/summary",{params:{start,end}}); setReport(r.data); };
  return <div className="p-8 max-w-[1400px] mx-auto space-y-8"><div className="border-b pb-6"><div className="text-xs font-mono-num uppercase text-zinc-500">07 · Controls</div><h1 className="font-display text-4xl mt-2">Planning & reports</h1><p className="text-sm text-zinc-500 mt-1">Owner-only budgets, imports, recurring costs and compliance reminders.</p></div>
    <section className="grid md:grid-cols-2 gap-4"><div className="border p-5 bg-white"><h2 className="font-display text-xl">Compliance reminders</h2><div className="mt-4 space-y-2">{reminders.length ? reminders.map(x=><div key={x.due_date+x.title} className="flex justify-between text-sm border-b pb-2"><span>{x.title}</span><span className="font-mono-num">{x.due_date} · {x.days_remaining}d</span></div>) : <p className="text-sm text-zinc-500">No deadlines in the next 30 days.</p>}</div></div><div className="border p-5 bg-white"><h2 className="font-display text-xl">Monthly report</h2><div className="flex gap-2 mt-4"><Input type="month" defaultValue={month} onChange={e=>{}}/><Button onClick={runReport} className="rounded-none bg-zinc-950">Generate</Button></div>{report&&<div className="mt-4 text-sm space-y-1"><div>Expenses: <b>{formatINR(report.expense_total)}</b> · Tax: <b>{formatINR(report.tax_total)}</b></div><div>{report.entries} entries · Cash {formatINR(report.cash)} · UPI {formatINR(report.upi)}</div></div>}</div></section>
    <section className="border p-5 bg-white"><h2 className="font-display text-xl">Recurring expenses</h2><div className="grid md:grid-cols-5 gap-2 mt-4"><Input placeholder="Vendor" value={form.vendor} onChange={e=>setForm({...form,vendor:e.target.value})}/><Input placeholder="Category" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/><Input type="number" placeholder="Amount" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/><Input type="number" min="1" max="28" placeholder="Day" value={form.day_of_month} onChange={e=>setForm({...form,day_of_month:e.target.value})}/><Button onClick={addRecurring} className="rounded-none bg-zinc-950">Save recurring</Button></div><div className="mt-4 text-sm">{recurring.map(r=><div className="border-b py-2" key={r.recurring_id}>{r.vendor} · {r.category} · {formatINR(r.amount)} on day {r.day_of_month}</div>)}</div></section>
    <section className="border p-5 bg-white"><h2 className="font-display text-xl">Import bank / UPI statement</h2><p className="text-sm text-zinc-500 mt-1">Upload a UTF-8 CSV using the exported expense column headings. Invalid rows are skipped safely.</p><input className="mt-4 text-sm" type="file" accept=".csv,text/csv" onChange={importCsv}/></section>
  </div>;
}
