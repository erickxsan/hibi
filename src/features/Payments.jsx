import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, History, TrendingUp, WalletCards } from "lucide-react";
import { Button } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { getUiLocale } from "../i18n";

function money(value) {
  return new Intl.NumberFormat(getUiLocale(), { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(
    Number(value || 0),
  );
}

function shortDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(getUiLocale(), { month: "short", day: "numeric" });
}

function ForecastChart({ actual, ideal, recent }) {
  const max = Math.max(ideal, recent, actual, 1);
  const points = (target) =>
    [0, 0.14, 0.3, 0.44, 0.6, 0.76, 0.88, 1]
      .map((x, index) => `${18 + x * 564},${178 - (target / max) * (index / 7) * 132}`)
      .join(" ");
  return (
    <div className="forecast-chart">
      <div className="chart-legend">
        <span>
          <i className="actual" />
          Actual
        </span>
        <span>
          <i className="ideal" />
          Ideal attendance
        </span>
        <span>
          <i className="recent" />
          Recent collections
        </span>
      </div>
      <svg viewBox="0 0 600 200" role="img" aria-label="Revenue forecast chart">
        <g className="grid">
          <line x1="18" y1="46" x2="582" y2="46" />
          <line x1="18" y1="90" x2="582" y2="90" />
          <line x1="18" y1="134" x2="582" y2="134" />
          <line x1="18" y1="178" x2="582" y2="178" />
        </g>
        <polyline className="ideal-line" points={points(ideal)} />
        <polyline className="recent-line" points={points(recent)} />
        <polyline className="actual-line" points={points(actual)} />
      </svg>
      <div className="chart-labels">
        <span>Month start</span>
        <span>Today</span>
        <span>Month end</span>
      </div>
    </div>
  );
}

export default function Payments({ state, derived, actions, openPage }) {
  const [range, setRange] = useState("month");
  const [payingId, setPayingId] = useState("");
  const dashboard = derived.dashboard;
  const pending = useMemo(
    () =>
      derived.classLog
        .filter((row) => Number(row.outstanding) > 0)
        .sort((left, right) => right.classDate.localeCompare(left.classDate)),
    [derived.classLog],
  );
  const paid = derived.classLog.filter((row) => Number(row.recognizedPaid) > 0);
  const overdue = pending.filter((row) => row.classDate < state.settings.asOfDate);
  const studentsById = derived.studentsById || new Map(state.students.map((student) => [student.id, student]));
  const collected = range === "week" ? dashboard.collectedThisWeek : dashboard.collectedSelectedMonth;
  const cards = [
    {
      label: `Collected this ${range}`,
      value: money(collected),
      note: `${paid.length} paid class records`,
      icon: TrendingUp,
      tone: "sage",
    },
    {
      label: "Paid class records",
      value: paid.length,
      note: money(paid.reduce((sum, row) => sum + Number(row.recognizedPaid || 0), 0)),
      icon: CheckCircle2,
      tone: "blue",
    },
    {
      label: "Pending balance",
      value: money(dashboard.outstandingThroughToday),
      note: `${pending.length} records`,
      icon: WalletCards,
      tone: "yellow",
    },
    {
      label: "Overdue balance",
      value: money(overdue.reduce((sum, row) => sum + Number(row.outstanding || 0), 0)),
      note: `${overdue.length} records`,
      icon: CalendarClock,
      tone: "lilac",
    },
  ];
  const markPaid = async (row) => {
    setPayingId(row.id);
    try {
      await actions.upsertClassLog({
        ...row,
        amountPaid: row.charge,
        paymentDate: state.settings.asOfDate,
        paymentMethod: row.paymentMethod || "Cash",
      });
    } finally {
      setPayingId("");
    }
  };

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Payments & Revenue</h1>
          <p>Track class-by-class collections, balances, advance payments, and both revenue projections.</p>
        </div>
        <div className="segmented compact">
          <button type="button" className={range === "week" ? "active" : ""} onClick={() => setRange("week")}>
            Week
          </button>
          <button type="button" className={range === "month" ? "active" : ""} onClick={() => setRange("month")}>
            Month
          </button>
        </div>
      </div>
      <section className="payment-metrics">
        {cards.map(({ icon: Icon, ...card }) => (
          <article className={`payment-metric ${card.tone}`} key={card.label}>
            <Icon size={20} />
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>
      <section className="payments-layout">
        <article className="payment-list-panel">
          <header>
            <div>
              <h2>Current unpaid / pending</h2>
              <p>Balances come directly from saved class records.</p>
            </div>
            <Button icon={History} onClick={() => openPage("classes", "class-history")}>
              Detailed history
            </Button>
          </header>
          <div className="payment-list">
            {pending.slice(0, 10).map((row) => (
              <div className="payment-row" key={row.id}>
                <StudentAvatar
                  avatarId={studentsById.get(row.studentId)?.avatarId}
                  name={row.studentName}
                  size="tiny"
                  decorative
                />
                <span>
                  <strong>{row.studentName}</strong>
                  <small>
                    {shortDate(row.classDate)}
                    {row.startTime ? ` · ${row.startTime}` : ""} ·{" "}
                    {row.classTitle || row.groupName || "Individual class"}
                  </small>
                </span>
                <strong>{money(row.outstanding)}</strong>
                <span
                  className={
                    row.classDate < state.settings.asOfDate ? "record-status overdue" : "record-status pending"
                  }
                >
                  {row.classDate < state.settings.asOfDate ? "Overdue" : "Pending"}
                </span>
                <Button onClick={() => markPaid(row)} disabled={payingId === row.id}>
                  {payingId === row.id ? "Saving…" : "Mark paid"}
                </Button>
              </div>
            ))}
            {!pending.length ? (
              <div className="empty-box">
                <CheckCircle2 size={28} />
                <h2>Everything is paid</h2>
                <p>No outstanding class balances through today.</p>
              </div>
            ) : null}
          </div>
        </article>
        <article className="forecast-panel">
          <header>
            <div>
              <h2>Revenue forecast</h2>
              <p>Actual collections vs both requested projections.</p>
            </div>
          </header>
          <ForecastChart
            actual={dashboard.collectedSelectedMonth}
            ideal={dashboard.idealRevenue}
            recent={dashboard.recentProjection}
          />
          <div className="forecast-totals">
            <span>
              <small>Actual</small>
              <strong>{money(dashboard.collectedSelectedMonth)}</strong>
            </span>
            <span>
              <small>Ideal · all attend</small>
              <strong>{money(dashboard.idealRevenue)}</strong>
            </span>
            <span>
              <small>Recent trend</small>
              <strong>{money(dashboard.recentProjection)}</strong>
            </span>
          </div>
        </article>
      </section>
      <section className="encouragement slim">
        <img src="/hibi-companion.png" alt="" />
        <div>
          <strong>Your collections are visible at a glance.</strong>
          <p>Advance payments remain tied to the future class record they cover.</p>
        </div>
      </section>
    </div>
  );
}
