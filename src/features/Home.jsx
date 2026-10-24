import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { EmptyState, Segmented } from "../components/ui";
import { ArchivedGroupsScope } from "../components/ArchivedGroupsScope";
import { useCompactViewport } from "../components/OverlayContext";
import { todayDateOnly } from "../domain/dates";
import {
  dayNumber,
  formatDayMonth,
  formatLongDate,
  formatMoney,
  formatScore,
  formatShortDate,
  formatSpan,
  formatTime,
  minutesOf,
  monthLong,
  monthShort,
  nowTimeFor,
} from "../utils/displayFormat";
import {
  buildAttentionItems,
  buildPeriodMetrics,
  buildTodayTimeline,
  periodRange,
  shortNames,
  studentPeriodRows,
} from "./homeDashboardModel";
import { rosterForClassSession } from "./classesWorkspaceModel";
import { ClassCard, TodayAgenda, TodayTimeline } from "./HomeToday";
import { metricSummary, MetricCard, MetricExplorer, MetricRows, overdueSplit, thresholds } from "./HomeMetrics";
import "../i18n/screenTranslations.js";
import "./home.css";

const PERIOD_ITEMS = [
  { value: "today", label: "Today" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Late night and early morning (0:00–4:59) get the evening greeting, «¡Buenas noches, profe!». */
export function greetingKey(now) {
  if (now < 5 * 60) return "Good evening, Teacher!";
  if (now < 12 * 60) return "Good morning, Teacher!";
  if (now < 19 * 60) return "Good afternoon, Teacher!";
  return "Good evening, Teacher!";
}

function periodTitle(period, asOf, t, locale) {
  const range = periodRange(asOf, period);
  if (period === "today") return t("Today · {date}", { date: formatLongDate(asOf, locale) });
  if (period === "weekly") {
    const sameMonth = range.start.slice(0, 7) === range.end.slice(0, 7);
    const span = sameMonth
      ? t("{start} to {end}", {
          start: dayNumber(range.start),
          end: `${dayNumber(range.end)} ${monthShort(range.end, locale)}`,
        })
      : t("{start} to {end}", {
          start: formatShortDate(range.start, locale, { weekday: false }),
          end: formatShortDate(range.end, locale, { weekday: false }),
        });
    return t("Your week · {span}", { span });
  }
  if (period === "monthly") return t("Your month · {month}", { month: monthLong(asOf, locale) });
  return t("Your year · {year}", { year: asOf.slice(0, 4) });
}

/** One «Para atender» entry as a bold lead, the sentence and where it leads. */
function attentionText(item, t, locale, compact) {
  const names = (list) => shortNames(list, locale);
  switch (item.kind) {
    case "unrecorded": {
      const session = item.session;
      const date = formatShortDate(session.classDate, locale);
      const lead =
        session.format === "individual"
          ? t("Individual class of {name} on {date}", { name: session.title.split(" ")[0], date })
          : t("{title} on {date}", { title: session.title, date });
      return {
        lead,
        rest:
          item.count > 1
            ? t("is still not recorded (and {count} more).", { count: item.count - 1 })
            : t("is still not recorded."),
        link: t("Record"),
      };
    }
    case "lowAttendance":
      return compact
        ? {
            lead: t(item.students.length === 1 ? "{count} student" : "{count} students", {
              count: item.students.length,
            }),
            rest: t("below {value}% attendance", { value: Math.round(item.threshold * 100) }),
          }
        : {
            lead: names(item.students.map((student) => student.fullName)),
            rest: t(
              item.students.length === 1
                ? "is below {value}% attendance this month."
                : "are below {value}% attendance this month.",
              {
                value: Math.round(item.threshold * 100),
              },
            ),
            link: t("View in the chart"),
          };
    case "lowGrade":
      return {
        lead: t("{name} got {value}", {
          name: item.student?.fullName.split(" ")[0] || "",
          value: formatScore(item.value, locale),
        }),
        rest: compact
          ? t("in {assessment}", { assessment: item.assessment })
          : t("in {assessment} ({date}).", {
              assessment: item.assessment,
              date: formatShortDate(item.date, locale, { weekday: true }),
            }),
        link: t("View in the chart"),
      };
    case "overdue": {
      // Only inactive students owe: shown apart, never as the overdue headline.
      if (!(item.amount > 0))
        return {
          lead: t("Inactive students owe {amount}", { amount: formatMoney(item.inactiveAmount, locale) }),
          rest: compact ? names(item.inactiveNames) : `${names(item.inactiveNames)}.`,
          link: t("View in the chart"),
        };
      // «$900 vencidos · $1,125 en total»: the total is what Clases and Seguimiento show as «Debe».
      const lead = [
        t("{amount} overdue", { amount: formatMoney(item.amount, locale) }),
        item.owed > item.amount ? t("{amount} in total", { amount: formatMoney(item.owed, locale) }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const inactive = item.inactiveAmount > 0 ? formatMoney(item.inactiveAmount, locale) : "";
      if (compact)
        return {
          lead,
          rest: [
            t("from {names}", { names: names(item.names) }),
            inactive ? t("{amount} in classes owed by inactive students", { amount: inactive }) : "",
          ]
            .filter(Boolean)
            .join(" · "),
        };
      const split = overdueSplit(item, t, locale);
      return {
        lead,
        rest: [
          t("from {names}.", { names: names(item.names) }),
          split ? t("Overdue: {split}.", { split }) : "",
          inactive ? t("Aside, {amount} in classes owed by inactive students.", { amount: inactive }) : "",
        ]
          .filter(Boolean)
          .join(" "),
        link: t("View in the chart"),
      };
    }
    case "monthlyDue": {
      const lead = t(item.count === 1 ? "{count} monthly fee of {group}" : "{count} monthly fees of {group}", {
        count: item.count,
        group: item.group?.name || "",
      });
      const who = names([...new Set(item.names)]);
      const alsoToday = item.dueToday
        ? ` ${t("Due today: {names} ({amount}).", {
            names: names([...new Set(item.dueToday.names)]),
            amount: formatMoney(item.dueToday.amount, locale),
          })}`
        : "";
      return {
        lead,
        rest: compact
          ? t(item.overdue ? "overdue" : "due today")
          : `${t(item.overdue ? "are overdue: {names} ({amount})." : "due today: {names} ({amount}).", {
              names: who,
              amount: formatMoney(item.amount, locale),
            })}${alsoToday}`,
        link: t("View monthly fees"),
      };
    }
    default:
      return { lead: "", rest: "" };
  }
}

export default function Home({
  state,
  derived,
  agenda = undefined,
  archiveScope = undefined,
  openPage = undefined,
  intent = undefined,
  clearIntent = undefined,
}) {
  const { t, locale } = useI18n();
  const compact = useCompactViewport();
  const asOf = state.settings?.asOfDate || todayDateOnly();
  const today = agenda?.state || state;
  const todayDerived = agenda?.derived || derived;
  const [nowTime, setNowTime] = useState(() => nowTimeFor(asOf, todayDateOnly()));
  useEffect(() => {
    const update = () => setNowTime(nowTimeFor(asOf, todayDateOnly()));
    update();
    if (asOf !== todayDateOnly()) return undefined;
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, [asOf]);
  const [period, setPeriod] = useState("weekly");
  const [explorer, setExplorer] = useState(null);
  // What the explorer opens on: an overdue alert lands on the debts, the figure it quotes.
  const [explorerFocus, setExplorerFocus] = useState({ aside: "point", request: 0 });
  const openExplorer = (metric, aside = "point") => {
    setExplorerFocus((current) => ({ aside, request: current.request + 1 }));
    setExplorer(metric);
  };
  const shownPeriod = compact ? "monthly" : period;
  const timeline = useMemo(
    () => buildTodayTimeline(today, todayDerived, asOf, nowTime),
    [asOf, nowTime, today, todayDerived],
  );
  const [selectedKey, setSelectedKey] = useState("");
  const selectedItem =
    timeline.items.find((item) => item.key === selectedKey) ||
    timeline.items.find((item) => item.key === timeline.selectedKey) ||
    null;
  const attention = useMemo(() => buildAttentionItems(today, todayDerived, asOf), [asOf, today, todayDerived]);
  const metrics = useMemo(
    () => buildPeriodMetrics(state, derived, asOf, shownPeriod),
    [asOf, derived, shownPeriod, state],
  );
  const buildForGroup = useCallback(
    (group) => buildPeriodMetrics(state, derived, asOf, shownPeriod, group),
    [asOf, derived, shownPeriod, state],
  );
  const rows = useMemo(() => studentPeriodRows(state, derived, asOf, shownPeriod), [asOf, derived, shownPeriod, state]);
  const studentsById = useMemo(
    () => new Map((state.students || []).map((student) => [student.id, student])),
    [state.students],
  );
  const groupsById = useMemo(() => new Map((state.groups || []).map((group) => [group.id, group])), [state.groups]);
  const derivedStudents = useMemo(
    () => new Map((derived?.students || []).map((student) => [student.id, student])),
    [derived],
  );
  const context = useMemo(
    () => ({
      t,
      locale,
      period: shownPeriod,
      asOf,
      state,
      derivedRows: derived?.classLog || [],
      threshold: thresholds(state),
      rows: rows.map((row) => ({ ...row, student: derivedStudents.get(row.student.id) || row.student })),
      names: (list) => shortNames(list, locale),
      nameOf: (id) => studentsById.get(id)?.fullName || t("Former student"),
      studentOf: (id) => studentsById.get(id) || null,
      groupName: (id) => (id ? groupsById.get(id)?.name || "" : t("Individual")),
      rosterOf: (session) => rosterForClassSession(state, session),
    }),
    [asOf, derived, derivedStudents, groupsById, locale, rows, shownPeriod, state, studentsById, t],
  );
  const summaries = useMemo(
    () => Object.fromEntries(Object.entries(metrics).map(([id, metric]) => [id, metricSummary(metric, context)])),
    [context, metrics],
  );
  const groupChips = useMemo(() => {
    const active = (state.groups || []).filter((group) => group.status !== "Inactive");
    const hasIndividual = (state.students || []).some(
      (student) => student.status !== "Inactive" && (student.isIndividual || !(student.groupIds || []).length),
    );
    return [
      { value: "all", label: t("All") },
      ...active.map((group) => ({ value: group.id, label: group.name })),
      ...(hasIndividual ? [{ value: "individual", label: t("Individual") }] : []),
    ];
  }, [state.groups, state.students, t]);

  useEffect(() => {
    if (!intent) return;
    if (intent?.type === "open-home-metric" && ["attendance", "grade", "collections"].includes(intent.metric)) {
      setExplorerFocus((current) => ({ aside: "point", request: current.request + 1 }));
      setExplorer(intent.metric);
    }
    clearIntent?.();
  }, [clearIntent, intent]);

  const openClass = (session) => openPage?.("classes", { type: "open-class", sessionKey: session.key });
  const openHistory = (session) => openPage?.("classes", { type: "open-history-class", sessionKey: session.key });
  const openTracking = (metric) =>
    openPage?.("grades", {
      type: "open-tracking",
      tab: metric === "grade" ? "grades" : metric === "collections" ? "payments" : "attendance",
    });
  const runAttention = (item) => {
    if (item.action.type === "record") return openClass(item.action.session);
    if (item.action.type === "monthly") return openPage?.("grades", { type: "open-tracking", tab: "payments" });
    if (compact) return openTracking(item.action.metric);
    if (period !== "monthly" && item.kind === "lowAttendance") setPeriod("monthly");
    openExplorer(item.action.metric, item.action.focus);
    globalThis.document?.getElementById("home-period")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const runDetailAction = (action) => {
    if (action.type === "record") return openClass(action.session);
    if (action.session?.statusLabel === "Registered") return openHistory(action.session);
    return openClass(action.session);
  };

  const now = minutesOf(nowTime) ?? 0;
  const classCount = timeline.items.length;
  const headline = timeline.live
    ? t("You are in {title} now. It ends at {time}.", {
        title: timeline.live.session.title,
        time: formatTime(timeline.live.end, locale),
      })
    : timeline.next
      ? t(
          classCount === 1
            ? "You have {count} class today. Next is {title}, in {span}."
            : "You have {count} classes today. Next is {title}, in {span}.",
          {
            count: classCount,
            title: timeline.next.session.title,
            span: formatSpan(timeline.next.start - now),
          },
        )
      : classCount
        ? t("You finished today's classes.")
        : t("No classes today. A good moment to catch up.");
  const scope = archiveScope?.count ? <ArchivedGroupsScope scope={archiveScope} compact={compact} /> : null;

  if (compact) {
    return (
      <div className="page home-page is-compact">
        <header className="hi">
          <span className="overline">{formatLongDate(asOf, locale)}</span>
          <h1>{t("Hi, Teacher")}</h1>
          <p>
            {t(classCount === 1 ? "{count} class today" : "{count} classes today", { count: classCount })} ·{" "}
            {t(attention.length === 1 ? "{count} thing to attend to" : "{count} things to attend to", {
              count: attention.length,
            })}
          </p>
        </header>
        <section aria-labelledby="home-today-title" data-onboarding-tour="home">
          <div className="sh">
            <h2 id="home-today-title">{t("Today")}</h2>
            <button
              type="button"
              className="link-button"
              onClick={() => openPage?.("classes", { type: "open-calendar" })}
            >
              {t("Calendar")}
            </button>
          </div>
          {classCount ? (
            <TodayAgenda
              timeline={timeline}
              onRecord={openClass}
              onOpen={(session) => (session.statusLabel === "Registered" ? openHistory(session) : openClass(session))}
            />
          ) : (
            <p className="muted home-empty-day">{t("No classes today. A good moment to catch up.")}</p>
          )}
        </section>
        {attention.length ? (
          <section aria-labelledby="home-attention-title">
            <div className="sh">
              <h2 id="home-attention-title">{t("To attend to")}</h2>
              <span>{attention.length}</span>
            </div>
            <div className="at">
              {attention.map((item, index) => {
                const text = attentionText(item, t, locale, true);
                return (
                  <button type="button" className="ai" key={`${item.kind}-${index}`} onClick={() => runAttention(item)}>
                    <i className={`dot-${item.tone}`} />
                    <span>
                      <b>{text.lead}</b> {text.rest}
                    </span>
                    <ChevronRight className="chev" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
        <section aria-labelledby="home-month-title">
          <div className="sh">
            <h2 id="home-month-title">{capitalize(monthLong(asOf, locale))}</h2>
            <button type="button" className="link-button" onClick={() => openTracking("attendance")}>
              {t("Tracking")}
            </button>
          </div>
          {scope}
          <MetricRows
            metrics={metrics}
            summaries={summaries}
            context={context}
            monthName={capitalize(monthLong(asOf, locale))}
            onOpenTracking={openTracking}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="page home-page">
      <header className="home-hello">
        <span className="overline">
          {formatDayMonth(asOf, locale) ? `${formatLongDate(asOf, locale)} · ${formatTime(nowTime, locale)}` : ""}
        </span>
        <h1>{t(greetingKey(now))}</h1>
        <p>{headline}</p>
      </header>

      <section aria-labelledby="home-today-title" data-onboarding-tour="home">
        <div className="sh">
          <h2 id="home-today-title">{t("Today's classes")}</h2>
          <div className="sh-meta">
            <span className="meta">
              {t(classCount === 1 ? "{count} class" : "{count} classes", { count: classCount })}
            </span>
            <span className="meta">
              {t(timeline.expected === 1 ? "{count} expected student" : "{count} expected students", {
                count: timeline.expected,
              })}
            </span>
            <button
              type="button"
              className="link-button"
              onClick={() => openPage?.("classes", { type: "open-calendar" })}
            >
              {t("View calendar")}
            </button>
          </div>
        </div>
        {classCount ? (
          <>
            <TodayTimeline timeline={timeline} selectedKey={selectedItem?.key} onSelect={setSelectedKey} />
            {selectedItem ? (
              <ClassCard
                item={selectedItem}
                now={now}
                derived={todayDerived}
                onRecord={openClass}
                onOpenRecord={openHistory}
              />
            ) : null}
          </>
        ) : (
          <EmptyState
            stamp
            title={t("No classes today")}
            description={t("A good moment to catch up. Your next classes appear in the calendar.")}
          />
        )}
      </section>

      {attention.length ? (
        <section aria-labelledby="home-attention-title">
          <div className="sh is-tight">
            <h2 id="home-attention-title" className="overline home-attention-title">
              {t("To attend to · {count}", { count: attention.length })}
            </h2>
          </div>
          <div className="alerts">
            {attention.map((item, index) => {
              const text = attentionText(item, t, locale, false);
              return (
                <button type="button" className="al" key={`${item.kind}-${index}`} onClick={() => runAttention(item)}>
                  <i className={`dot-${item.tone}`} />
                  <span>
                    <b>{text.lead}</b> {text.rest}
                    {text.link ? <small>{text.link}</small> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="home-period-title" id="home-period">
        <div className="sh">
          <h2 id="home-period-title">{periodTitle(period, asOf, t, locale)}</h2>
          <Segmented value={period} onChange={setPeriod} label={t("Period")} items={PERIOD_ITEMS} />
        </div>
        {scope}
        {explorer ? (
          <MetricExplorer
            key={`${period}-${archiveScope?.included ? "all" : "active"}-${explorerFocus.request}`}
            initialAside={explorerFocus.aside}
            open={explorer}
            onChange={setExplorer}
            onClose={() => setExplorer(null)}
            period={period}
            metrics={metrics}
            summaries={summaries}
            buildForGroup={buildForGroup}
            groups={groupChips}
            state={state}
            derived={derived}
            asOf={asOf}
            context={context}
            onAction={runDetailAction}
          />
        ) : (
          <div className="minis">
            {["attendance", "grade", "collections"].map((id) => (
              <MetricCard
                key={`${id}-${period}`}
                metric={metrics[id]}
                summary={summaries[id]}
                context={context}
                onOpen={() => openExplorer(id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
