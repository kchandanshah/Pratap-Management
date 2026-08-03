import { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import api, { formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Check } from "lucide-react";

export default function Payslip() {
  const { employeeId } = useParams();
  const [search] = useSearchParams();
  const month = search.get("month") || new Date().toISOString().slice(0, 7);
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get(`/payslip/${employeeId}`, { params: { month } });
        setData(r.data);
      } finally {
        setLoading(false);
      }
    })();
  }, [employeeId, month]);

  if (loading) return <div className="p-8 text-zinc-500">Loading payslip…</div>;
  if (!data) return <div className="p-8 text-rose-600">Payslip not found.</div>;

  const monthLabel = new Date(`${month}-01`).toLocaleString("en-IN", { month: "long", year: "numeric" });
  const outstanding = data.advances.filter(a => !a.repaid);
  const repaid = data.advances.filter(a => a.repaid);

  return (
    <div className="min-h-screen bg-zinc-100 py-8">
      {/* Top toolbar — hidden on print */}
      <div className="max-w-3xl mx-auto flex items-center justify-between mb-4 print:hidden px-4">
        <Button
          data-testid="back-button"
          variant="outline"
          onClick={() => navigate(-1)}
          className="rounded-none border-zinc-300 hover:border-zinc-950"
        >
          <ArrowLeft size={14} className="mr-2" /> Back
        </Button>
        <Button
          data-testid="print-button"
          onClick={() => window.print()}
          className="rounded-none bg-zinc-950 hover:bg-zinc-800 text-white"
        >
          <Printer size={14} className="mr-2" /> Print / Save PDF
        </Button>
      </div>

      {/* Payslip sheet */}
      <div className="max-w-3xl mx-auto bg-white border border-zinc-300 p-12 print:border-0 print:p-0 print:max-w-none" data-testid="payslip-sheet">
        {/* Header */}
        <div className="flex justify-between items-start pb-6 border-b-2 border-zinc-950">
          <div>
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Payslip</div>
            <h1 className="font-display text-3xl font-medium tracking-tight mt-1">
              {data.firm?.name || "PRATAP | CALCI | LEDGER"}
            </h1>
            {data.firm && (
              <div className="text-xs text-zinc-500 mt-1 space-y-0.5">
                {data.firm.gst_number && <div className="font-mono-num">GSTIN: {data.firm.gst_number}</div>}
                {data.firm.address && <div>{data.firm.address}</div>}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Period</div>
            <div className="font-display text-2xl font-medium mt-1">{monthLabel}</div>
          </div>
        </div>

        {/* Employee info */}
        <div className="grid grid-cols-2 gap-6 py-6 border-b border-zinc-200">
          <div>
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Employee</div>
            <div className="font-medium text-lg mt-1" data-testid="payslip-employee-name">{data.employee.name}</div>
            {data.employee.role_title && <div className="text-sm text-zinc-500 mt-0.5">{data.employee.role_title}</div>}
          </div>
          <div>
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">Employee ID</div>
            <div className="font-mono-num text-sm mt-1">{data.employee.employee_id}</div>
          </div>
        </div>

        {/* Earnings/Deductions summary */}
        <div className="grid grid-cols-2 gap-8 py-6 border-b border-zinc-200">
          <div className="space-y-3">
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-emerald-700">Earnings</div>
            <div className="flex justify-between items-baseline">
              <span className="text-sm">Base Salary</span>
              <span className="font-mono-num text-lg">{formatINR(data.base_salary)}</span>
            </div>
            <div className="pt-3 border-t border-zinc-200 flex justify-between items-baseline">
              <span className="text-sm font-semibold">Gross Earnings</span>
              <span className="font-mono-num text-lg font-semibold">{formatINR(data.base_salary)}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-rose-700">Deductions</div>
            <div className="flex justify-between items-baseline">
              <span className="text-sm">Outstanding Advances</span>
              <span className="font-mono-num text-lg text-rose-600" data-testid="payslip-outstanding">-{formatINR(data.total_outstanding_advance)}</span>
            </div>
            {data.total_repaid_advance > 0 && (
              <div className="flex justify-between items-baseline text-xs text-zinc-500">
                <span>(Repaid this month — not deducted)</span>
                <span className="font-mono-num">{formatINR(data.total_repaid_advance)}</span>
              </div>
            )}
            <div className="pt-3 border-t border-zinc-200 flex justify-between items-baseline">
              <span className="text-sm font-semibold">Total Deductions</span>
              <span className="font-mono-num text-lg font-semibold">{formatINR(data.total_outstanding_advance)}</span>
            </div>
          </div>
        </div>

        {/* Net Payable */}
        <div className="bg-zinc-950 text-white p-6 my-6 flex justify-between items-center print:border print:border-zinc-950">
          <div>
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-400">Net Payable</div>
            <div className="text-xs text-zinc-400 mt-1">Amount to be paid this month</div>
          </div>
          <div className="font-mono-num text-4xl font-semibold" data-testid="payslip-net-payable">{formatINR(data.net_payable)}</div>
        </div>

        {/* Advance detail */}
        {data.advances.length > 0 && (
          <div className="py-4">
            <div className="text-[10px] font-mono-num uppercase tracking-widest text-zinc-500 mb-3">
              Salary Advances · {data.advances.length} total
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-300 text-[10px] font-mono-num uppercase tracking-widest text-zinc-500">
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Mode</th>
                  <th className="text-left py-2">Notes</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.advances.map((a) => (
                  <tr key={a.expense_id} className="border-b border-zinc-100">
                    <td className="py-2 font-mono-num">{a.date}</td>
                    <td className="py-2">{a.payment_mode}</td>
                    <td className="py-2 text-zinc-500 truncate max-w-[200px]">{a.notes || "—"}</td>
                    <td className="py-2">
                      {a.repaid ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-[10px] font-mono-num uppercase">
                          <Check size={10} /> Repaid
                        </span>
                      ) : (
                        <span className="text-rose-600 text-[10px] font-mono-num uppercase">Outstanding</span>
                      )}
                    </td>
                    <td className="py-2 text-right font-mono-num">{formatINR(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="pt-6 mt-6 border-t border-zinc-200 flex justify-between text-xs text-zinc-500">
          <div>
            Generated by <span className="font-mono-num">{data.generated_by}</span>
            {" · "}
            {new Date(data.generated_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </div>
          <div className="text-right">
            <div>Signature: ____________________</div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body { background: white !important; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
