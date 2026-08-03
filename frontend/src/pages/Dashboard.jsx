import { useEffect, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { ArrowUpRight, TrendingUp, Fuel, Users, Wallet, Download, CalendarCheck } from "lucide-react";
import { API } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend,
} from "recharts";

const MonthPicker = ({ month, onChange }) => (
  <input
    type="month"
    value={month}
    onChange={(e) => onChange(e.target.value)}
    data-testid="dashboard-month-picker"
    className="h-9 border border-zinc-300 px-3 text-sm font-mono-num focus:outline-none focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 bg-white"
  />
);

const KpiCard = ({ label, value, index, icon: Icon, sub, testid }) => (
  <div
    data-testid={testid}
    className="border border-zinc-200 bg-white p-6 flex flex-col justify-between min-h-[140px] hover:border-zinc-400 transition-colors duration-150 animate-fade-in"
    style={{ animationDelay: `${index * 60}ms` }}
  >
    <div className="flex items-start justify-between">
      <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">{label}</div>
      <Icon size={14} className="text-zinc-400" />
    </div>
    <div className="mt-6">
      <div className="font-mono-num text-3xl tracking-tight text-zinc-950">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  </div>
);

export default function Dashboard() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [periodMode, setPeriodMode] = useState("month");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api.get("/dashboard", { params: periodMode === "year" ? { year: month.slice(0, 4) } : { month } });
        setData(r.data);
      } finally {
        setLoading(false);
      }
    })();
  }, [month, periodMode]);
  const exportCategories = () => { const value = periodMode === "year" ? `year=${month.slice(0, 4)}` : `month=${month}`; window.location.href = `${API}/reports/category-spend/export?${value}`; };

  const cashUpiTotal = (data?.cash || 0) + (data?.upi || 0);
  const cashPct = cashUpiTotal > 0 ? Math.round(((data?.cash || 0) / cashUpiTotal) * 100) : 0;
  const upiPct = 100 - cashPct;

  const chartData = (data?.category_breakdown || []).filter(c => c.amount > 0);
  const pieData = [
    { name: "Cash", value: data?.cash || 0, color: "#E11D48" },
    { name: "UPI/Bank", value: data?.upi || 0, color: "#09090b" },
  ].filter(d => d.value > 0);

  return (
    <div className="p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-8 pb-6 border-b border-zinc-200">
        <div>
          <div className="text-xs font-mono-num uppercase tracking-widest text-zinc-500 mb-2">
            01 · Overview
          </div>
          <h1 className="font-display text-4xl font-medium tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Business spend, staff advances & tax posture for the selected period.
          </p>
        </div>
        <div className="flex gap-2"><select value={periodMode} onChange={(e) => setPeriodMode(e.target.value)} className="h-9 border border-zinc-300 px-2 text-sm bg-white"><option value="month">Month</option><option value="year">Year</option></select>{periodMode === "month" ? <MonthPicker month={month} onChange={setMonth} /> : <input type="number" value={month.slice(0,4)} onChange={(e) => setMonth(`${e.target.value}-01`)} className="h-9 w-24 border border-zinc-300 px-2 text-sm" />}</div>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500 font-mono-num">Loading…</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
            <KpiCard testid="kpi-total-spend" index={0} label="Total Spend" value={formatINR(data.total_spend)} icon={TrendingUp} sub={`${data.expense_count} entries`} />
            <KpiCard testid="kpi-petrol" index={1} label="Petrol / Fuel" value={formatINR(data.total_petrol)} icon={Fuel} sub="Fuel spend this period" />
            <KpiCard testid="kpi-advances" index={2} label="Staff Advances" value={formatINR(data.total_advances)} icon={Users} sub="Given to employees" />
            <KpiCard testid="kpi-cash-upi" index={3} label="Cash vs UPI" value={`${cashPct}% / ${upiPct}%`} icon={Wallet} sub={`${formatINR(data.cash)} · ${formatINR(data.upi)}`} />
            <KpiCard testid="kpi-attendance" index={4} label="Attendance" value={`${data.attendance?.present || 0} P · ${data.attendance?.half_day || 0} H · ${data.attendance?.absent || 0} A`} icon={CalendarCheck} sub={`Recorded for ${data.month}`} />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 border border-zinc-200 bg-white p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">02 · Category Breakdown</div>
                  <h2 className="font-display text-xl font-medium tracking-tight mt-1">Where the money went</h2>
                </div>
                <div className="text-xs text-zinc-500 font-mono-num">{chartData.length} categories</div>
              </div>
              {chartData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-sm text-zinc-500">No expenses logged for this month.</div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 40 }}>
                    <CartesianGrid stroke="#E4E4E7" vertical={false} />
                    <XAxis
                      dataKey="category"
                      tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                      angle={-25}
                      textAnchor="end"
                      interval={0}
                      stroke="#71717a"
                    />
                    <YAxis tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#71717a" tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: "#fff", border: "1px solid #E4E4E7", borderRadius: 0, fontFamily: 'IBM Plex Mono', fontSize: 12 }}
                      formatter={(v) => formatINR(v)}
                    />
                    <Bar dataKey="amount" radius={0}>
                      {chartData.map((entry) => (
                        <Cell key={entry.category} fill={entry.color || "#09090b"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="border border-zinc-200 bg-white p-6">
              <div className="mb-6">
                <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">03 · Payment Mix</div>
                <h2 className="font-display text-xl font-medium tracking-tight mt-1">Cash vs UPI</h2>
              </div>
              {pieData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-sm text-zinc-500">No data.</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} stroke="#fff" strokeWidth={2}>
                        {pieData.map((e) => <Cell key={e.name} fill={e.color} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "#fff", border: "1px solid #E4E4E7", borderRadius: 0, fontFamily: 'IBM Plex Mono', fontSize: 12 }}
                        formatter={(v) => formatINR(v)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 mt-4">
                    {pieData.map((d) => (
                      <div key={d.name} className="flex items-center justify-between text-sm border-b border-zinc-100 pb-2">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2" style={{ background: d.color }} />
                          {d.name}
                        </span>
                        <span className="font-mono-num">{formatINR(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Category table */}
          <div className="mt-8 border border-zinc-200 bg-white">
            <div className="p-5 border-b border-zinc-200 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">04 · All Categories</div>
                <h2 className="font-display text-xl font-medium tracking-tight mt-1">Line items</h2>
              </div><Button onClick={exportCategories} variant="outline" className="rounded-none h-9"><Download size={14} className="mr-2" /> Export Excel CSV</Button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">
                  <th className="text-left py-3 px-5">Category</th>
                  <th className="text-right py-3 px-5">Amount</th>
                  <th className="text-right py-3 px-5">Share</th>
                </tr>
              </thead>
              <tbody>
                {(data.category_breakdown || []).map((c) => {
                  const share = data.total_spend > 0 ? (c.amount / data.total_spend) * 100 : 0;
                  return (
                    <tr key={c.category} className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors duration-150">
                      <td className="py-3 px-5">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2" style={{ background: c.color }} />
                          {c.category}
                        </span>
                      </td>
                      <td className="py-3 px-5 text-right font-mono-num">{formatINR(c.amount)}</td>
                      <td className="py-3 px-5 text-right font-mono-num text-zinc-500">{share.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
