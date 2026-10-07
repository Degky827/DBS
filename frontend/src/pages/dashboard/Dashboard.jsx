import {
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  Send,
  CreditCard,
  MoreHorizontal,
  TrendingUp,
} from "lucide-react";

const BALANCES = [
  { label: "Total balance", value: 128450.75, delta: "+2.4% this month", tone: "navy" },
  { label: "Savings", value: 84200.0, delta: "+$1,200 on 1 Oct", tone: "white" },
  { label: "Checking", value: 44250.75, delta: "12 payments pending", tone: "white" },
];

const QUICK_ACTIONS = [
  { label: "Transfer", icon: Send },
  { label: "Deposit", icon: Plus },
  { label: "Pay card", icon: CreditCard },
  { label: "More", icon: MoreHorizontal },
];

const TRANSACTIONS = [
  { name: "Whole Foods Market", date: "7 Oct, 09:14", amount: -86.42, category: "Groceries", status: "Completed" },
  { name: "Salary — Ashbourne Ltd", date: "1 Oct, 00:02", amount: 6400.0, category: "Income", status: "Completed" },
  { name: "Spotify Premium", date: "6 Oct, 18:40", amount: -11.99, category: "Subscriptions", status: "Completed" },
  { name: "Transfer to Savings", date: "5 Oct, 12:05", amount: -1000.0, category: "Internal", status: "Completed" },
  { name: "Con Edison", date: "4 Oct, 08:30", amount: -142.3, category: "Utilities", status: "Pending" },
  { name: "Refund — Nordstrom", date: "3 Oct, 15:55", amount: 219.0, category: "Shopping", status: "Completed" },
];

const SPEND = [
  { day: "Mon", value: 45 },
  { day: "Tue", value: 72 },
  { day: "Wed", value: 38 },
  { day: "Thu", value: 90 },
  { day: "Fri", value: 64 },
  { day: "Sat", value: 120 },
  { day: "Sun", value: 55 },
];

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Good morning</p>
          <h1 className="mt-1 text-2xl font-extrabold">Overview</h1>
        </div>
        <div className="flex gap-3">
          <button type="button" className="btn-ghost">
            <ArrowDownLeft size={16} /> Receive
          </button>
          <button type="button" className="btn-primary w-auto! px-4! py-2.5! text-sm">
            <ArrowUpRight size={16} /> Send money
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {BALANCES.map((b) => (
          <div
            key={b.label}
            className={
              b.tone === "navy"
                ? "rounded-xl bg-navy-800 p-5 text-white shadow-[0_12px_32px_-20px_rgba(5,13,26,.8)]"
                : "card p-5"
            }
          >
            <p className={`text-[11px] font-bold uppercase tracking-[0.14em] ${b.tone === "navy" ? "text-gold-400" : "text-ink-400"}`}>
              {b.label}
            </p>
            <p className={`num mt-2 text-2xl font-extrabold ${b.tone === "navy" ? "text-white" : "text-navy-900"}`}>
              {money(b.value)}
            </p>
            <p className={`mt-1 text-xs font-medium ${b.tone === "navy" ? "text-navy-100/70" : "text-ink-400"}`}>
              {b.delta}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_ACTIONS.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            className="card group flex items-center gap-3 px-4 py-3.5 text-left transition hover:border-navy-500/40 hover:shadow-[0_8px_24px_-16px_rgba(5,13,26,.45)]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50 text-navy-700 transition group-hover:bg-navy-800 group-hover:text-white">
              <Icon size={17} />
            </span>
            <span className="text-sm font-bold text-navy-900">{label}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <h2 className="text-[15px] font-extrabold">Recent activity</h2>
            <button type="button" className="link text-[13px]!">View all</button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">
                  <th className="px-5 py-3">Transaction</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {TRANSACTIONS.map((t) => (
                  <tr key={t.name} className="transition hover:bg-ink-50">
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-bold text-navy-900">{t.name}</p>
                      <p className="text-xs text-ink-400">{t.date}</p>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-ink-500">{t.category}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          t.status === "Pending"
                            ? "bg-gold-100 text-gold-600"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td
                      className={`num px-5 py-3.5 text-right text-sm font-extrabold ${
                        t.amount < 0 ? "text-navy-900" : "text-emerald-600"
                      }`}
                    >
                      {t.amount < 0 ? "" : "+"}
                      {money(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-navy-800 via-navy-900 to-navy-950 p-5 text-white shadow-[0_16px_40px_-24px_rgba(5,13,26,.9)]">
            <div className="brand-texture absolute inset-0 opacity-40" />
            <div className="relative">
              <div className="flex items-start justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-400">
                  Meridian Platinum
                </p>
                <CreditCard size={20} className="text-navy-100/70" />
              </div>
              <p className="num mt-8 text-lg font-bold tracking-[0.25em]">
                •••• •••• •••• 4192
              </p>
              <div className="mt-5 flex items-end justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-navy-100/50">Card holder</p>
                  <p className="text-sm font-bold">ADA LOVELACE</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-navy-100/50">Expires</p>
                  <p className="num text-sm font-bold">08/29</p>
                </div>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-extrabold">Spending this week</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                <TrendingUp size={12} /> 8%
              </span>
            </div>

            <div className="mt-5 flex h-28 items-end gap-2.5">
              {SPEND.map((s) => (
                <div key={s.day} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className={`w-full rounded-t transition ${
                      s.day === "Sat" ? "bg-gold-500" : "bg-navy-800/85"
                    }`}
                    style={{ height: `${(s.value / 120) * 100}%` }}
                    title={money(s.value)}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
                    {s.day}
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-400">
              Weekly total{" "}
              <span className="num font-bold text-navy-900">
                {money(SPEND.reduce((a, s) => a + s.value, 0))}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
