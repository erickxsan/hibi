import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/index.jsx";
import { Button, EmptyState, Segmented } from "../components/ui";
import { ArchivedGroupsScope } from "../components/ArchivedGroupsScope";
import { useCompactViewport } from "../components/OverlayContext";
import { addDays, todayDateOnly } from "../domain/dates";
import { memoizeRecent } from "../domain/stateMemo";
import {
  dayNumber,
  formatDayMonth,
  formatLongDate,
  formatMoney,
  formatScore,
  formatShortDate,
  formatTime,
  minutesOf,
  monthLong,
  monthShort,
  nowTimeFor,
} from "../utils/displayFormat";
import {
  attentionSpotlight,
  buildAttentionItems,
  buildPeriodMetrics,
  buildTodayTimeline,
  periodRange,
  shortNames,
  studentPeriodRows,
} from "./homeDashboardModel";
import { rosterForClassSession } from "./classesWorkspaceModel";
import { ClassCard, SeenButton, ShowSeenButton, TodayAgenda, TodayTimeline } from "./HomeToday";
import { metricSummary, MetricCard, MetricExplorer, MetricRows, thresholds } from "./HomeMetrics";
import { randomChartView } from "./chartViewsModel";
import "../i18n/screenTranslations.js";
import "./home.css";

// Kept outside the component: coming back to Inicio with the same records reuses these instead of recomputing.
const todayTimeline = memoizeRecent(buildTodayTimeline);
const attentionItems = memoizeRecent(buildAttentionItems);
const periodMetrics = memoizeRecent(buildPeriodMetrics);
const periodRows = memoizeRecent(studentPeriodRows);
// The timeline draws itself in on the first Inicio of a session; coming back later shows it already in place.
let introShown = false;

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

/** A class an alert names: «Inglés A1, ayer» or «Clase individual de Ana, mar 3 nov». */
function alertClass(session, asOf, t, locale) {
  const name =
    session.format === "individual"
      ? t("Individual class of {name}", { name: session.title.split(" ")[0] })
      : session.title;
  const when = session.classDate === addDays(asOf, -1) ? t("yesterday") : formatShortDate(session.classDate, locale);
  return `${name}, ${when}`;
}

/** One «Para atender» alert: a title with the figure first, at most one line under it and the verb of its action. */
function attentionText(item, t, locale, asOf) {
  const names = (list) => shortNames(list, locale);
  const money = (amount) => formatMoney(amount, locale);
  switch (item.kind) {
    case "unrecorded":
      return {
        title: t(item.count === 1 ? "{count} class not recorded" : "{count} classes not recorded", {
          count: item.count,
        }),
        detail:
          item.count > 1
            ? t("Latest: {class}", { class: alertClass(item.session, asOf, t, locale) })
            : alertClass(item.session, asOf, t, locale),
        action: t("Record"),
      };
    case "unmarked":
      return {
        title: t(item.names.length === 1 ? "{count} student unmarked" : "{count} students unmarked", {
          count: item.names.length,
        }),
        detail:
          item.count > 1
            ? t("Latest: {class}", { class: alertClass(item.session, asOf, t, locale) })
            : alertClass(item.session, asOf, t, locale),
        action: t("Take attendance"),
      };
    case "lowAttendance":
      return {
        title: t(
          item.students.length === 1
            ? "{count} student below {value}% attendance"
            : "{count} students below {value}% attendance",
          { count: item.students.length, value: Math.round(item.threshold * 100) },
        ),
        detail: names(item.students.map((student) => student.fullName)),
        action: t("View"),
      };
    case "lowGrade":
      return {
        title: t("{name} got {value}", {
          name: item.student?.fullName.split(" ")[0] || "",
          value: formatScore(item.value, locale),
        }),
        detail: t("in {assessment}, {date}", {
          assessment: item.assessment,
          date: formatShortDate(item.date, locale, { weekday: true }),
        }),
        action: t("View"),
      };
    case "overdue": {
      const stale = item.staleAmount > 0 ? t("{amount} over 3 months old", { amount: money(item.staleAmount) }) : "";
      const inactive =
        item.inactiveAmount > 0 ? t("{amount} from inactive students", { amount: money(item.inactiveAmount) }) : "";
      // Only inactive students (or only old debts) owe: never called «vencidos» in the headline.
      if (!(item.amount > 0))
        return item.inactiveAmount > 0
          ? {
              title: inactive,
              detail: [names(item.inactiveNames), stale].filter(Boolean).join(" · "),
              action: t("Collect"),
            }
          : { title: stale, detail: "", action: t("Collect") };
      const people = item.studentCount
        ? t(item.studentCount === 1 ? "{count} student" : "{count} students", { count: item.studentCount })
        : "";
      return {
        title: t("{amount} overdue", { amount: money(item.amount) }),
        // One line: old debts matter more than inactive students' (both are in Seguimiento › Pagos).
        detail: [people, stale || inactive].filter(Boolean).join(" · "),
        action: t("Collect"),
      };
    }
    case "dueToday": {
      const who = names(item.names);
      const groups = new Intl.ListFormat(locale, { type: "conjunction" }).format(item.groupNames);
      return {
        title: t(item.count === 1 ? "{count} monthly fee due today" : "{count} monthly fees due today", {
          count: item.count,
        }),
        detail: [who, groups].filter(Boolean).join(" · "),
        action: t("Collect"),
      };
    }
    default:
      return { title: "", detail: "", action: "" };
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
  actions = undefined,
}) {
  const { t, locale } = useI18n();
  const compact = useCompactViewport();
  const asOf = state.settings?.asOfDate || todayDateOnly();
  const today = agenda?.state || state;
  const todayDerived = agenda?.derived || derived;
  const [nowTime, setNowTime] = useState(() => nowTimeFor(asOf, todayDateOnly()));
  const [revisit] = useState(() => introShown);
  useEffect(() => {
    introShown = true;
  }, []);
  const pageClass = `page home-page${compact ? " is-compact" : ""}${revisit ? " is-revisit" : ""}`;
  useEffect(() => {
    const update = () => setNowTime(nowTimeFor(asOf, todayDateOnly()));
    update();
    if (asOf !== todayDateOnly()) return undefined;
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, [asOf]);
  const [period, setPeriod] = useState("weekly");
  const [explorer, setExplorer] = useState(null);
  // Each card shows one of its metric's views, drawn at random on every visit; the detail opens on it.
  const [cardViews, setCardViews] = useState(() => ({
    attendance: randomChartView("attendance"),
    grade: randomChartView("grade"),
    collections: randomChartView("collections"),
  }));
  const chooseView = (metric, view) => setCardViews((current) => ({ ...current, [metric]: view }));
  // What the explorer opens on: an overdue alert lands on the debts, the figure it quotes.
  const [explorerFocus, setExplorerFocus] = useState({ aside: "point", request: 0, spotlight: null });
  const openExplorer = (metric, aside = "point", spotlight = null) => {
    setExplorerFocus((current) => ({ aside, request: current.request + 1, spotlight }));
    setExplorer(metric);
  };
  // The explorer marks the alert's students once it mounts; later remounts (another period) do not repeat it.
  useEffect(() => {
    if (explorerFocus.spotlight) setExplorerFocus((current) => ({ ...current, spotlight: null }));
  }, [explorerFocus.spotlight]);
  const shownPeriod = compact ? "monthly" : period;
  const timeline = useMemo(
    () => todayTimeline(today, todayDerived, asOf, nowTime),
    [asOf, nowTime, today, todayDerived],
  );
  const [selectedKey, setSelectedKey] = useState("");
  const selectedItem =
    timeline.items.find((item) => item.key === selectedKey) ||
    timeline.items.find((item) => item.key === timeline.selectedKey) ||
    null;
  const attentionAll = useMemo(() => attentionItems(today, todayDerived, asOf), [asOf, today, todayDerived]);
  // Items marked as seen stay out of the list and the counts until something new brings them back.
  const attention = attentionAll.filter((item) => !item.dismissed);
  const seenAttention = attentionAll.filter((item) => item.dismissed);
  // «Ocultar» hides a notice (an alert or a note before class) and offers to undo it from the notice it leaves.
  const dismissedNotes = today.settings?.dismissedNotes;
  const setNotesDismissed = actions?.setNotesDismissed;
  const notify = actions?.notify;
  const hideNotices = useCallback(
    (keys, dismissed = true, count = 1) => {
      if (!setNotesDismissed) return;
      if (!dismissed) return setNotesDismissed(keys, false);
      // «Deshacer» brings back only what this click hid; what was already hidden stays hidden.
      const fresh = keys.filter((key) => !Object.hasOwn(dismissedNotes || {}, key));
      if (!fresh.length) return;
      setNotesDismissed(fresh, true);
      notify?.(count === 1 ? "Notice hidden" : "Notices hidden", "success", {
        label: "Undo",
        run: () => setNotesDismissed(fresh, false),
      });
    },
    [dismissedNotes, notify, setNotesDismissed],
  );
  const onDismissNotes = setNotesDismissed ? hideNotices : undefined;
  const showSeenAttention = (
    <ShowSeenButton
      count={seenAttention.length}
      keys={seenAttention.flatMap((item) => item.seenKeys)}
      onDismiss={onDismissNotes}
    />
  );
  const metrics = useMemo(() => periodMetrics(state, derived, asOf, shownPeriod), [asOf, derived, shownPeriod, state]);
  const buildForGroup = useCallback(
    (group) => buildPeriodMetrics(state, derived, asOf, shownPeriod, group),
    [asOf, derived, shownPeriod, state],
  );
  const rows = useMemo(() => periodRows(state, derived, asOf, shownPeriod), [asOf, derived, shownPeriod, state]);
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
    const active = state.groups || [];
    const hasIndividual =
      (state.students || []).some(
        (student) => student.status !== "Inactive" && (student.isIndividual || !(student.groupIds || []).length),
      ) || (state.classLog || []).some((row) => !row.groupId);
    return [
      { value: "all", label: t("All groups") },
      ...active.map((group) => ({ value: group.id, label: group.name })),
      ...(hasIndividual ? [{ value: "individual", label: t("Individual") }] : []),
    ];
  }, [state.groups, state.students, state.classLog, t]);

  useEffect(() => {
    if (!intent) return;
    if (intent?.type === "open-home-metric" && ["attendance", "grade", "collections"].includes(intent.metric)) {
      setExplorerFocus((current) => ({ aside: "point", request: current.request + 1, spotlight: null }));
      setExplorer(intent.metric);
    }
    clearIntent?.();
  }, [clearIntent, intent]);

  const openClass = (session, spotlight = null) =>
    openPage?.("classes", { type: "open-class", sessionKey: session.key, ...(spotlight ? { spotlight } : {}) });
  const openHistory = (session) => openPage?.("classes", { type: "open-history-class", sessionKey: session.key });
  const openTracking = (metric, spotlight = null) =>
    openPage?.("grades", {
      type: "open-tracking",
      tab: metric === "grade" ? "grades" : metric === "collections" ? "payments" : "attendance",
      ...(spotlight ? { spotlight } : {}),
    });
  // Each alert opens where it can be acted on, with what it named marked for a moment.
  const runAttention = (item) => {
    const spotlight = attentionSpotlight(item);
    if (item.action.type === "record") return openClass(item.action.session, spotlight);
    if (item.action.type === "monthly") return openTracking("collections", spotlight);
    if (compact) return openTracking(item.action.metric, spotlight);
    if (period !== "monthly" && item.kind === "lowAttendance") setPeriod("monthly");
    openExplorer(item.action.metric, item.action.focus, spotlight);
    globalThis.document?.getElementById("home-period")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  // Each alert is a row: dot, title and its one line, the action and «Ocultar».
  const attentionRows = attention.map((item) => {
    const text = attentionText(item, t, locale, asOf);
    return (
      <div className="al-item" role="listitem" key={item.kind}>
        <i className={`dot-${item.tone}`} aria-hidden="true" />
        <span className="al-text">
          <b>{text.title}</b>
          {text.detail ? <span>{text.detail}</span> : null}
        </span>
        <Button
          className="al-act"
          aria-label={t("{action} · {name}", { action: text.action, name: text.title })}
          onClick={() => runAttention(item)}
        >
          {text.action}
        </Button>
        <SeenButton keys={item.seenKeys} label={t("Hide: {name}", { name: text.title })} onDismiss={onDismissNotes} />
      </div>
    );
  });
  const runDetailAction = (action) => {
    if (action.type === "record") return openClass(action.session);
    if (action.session?.statusLabel === "Registered") return openHistory(action.session);
    return openClass(action.session);
  };

  const now = minutesOf(nowTime) ?? 0;
  // The greeting has no subtitle on any screen size: the timeline (or the agenda on the phone) already says how
  // many classes there are and which one is next, and «Para atender» counts its own items.
  const classCount = timeline.items.length;
  // Archived groups stay out of Inicio's figures by default; the chip only appears to say they were let in
  // (from Seguimiento) and to take them out again.
  const scope = archiveScope?.count && archiveScope.included ? <ArchivedGroupsScope scope={archiveScope} /> : null;

  if (compact) {
    return (
      <div className={pageClass}>
        <header className="hi">
          <span className="overline">{formatLongDate(asOf, locale)}</span>
          <h1>{t("Hi, Teacher")}</h1>
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
              onDismissNotes={onDismissNotes}
            />
          ) : (
            <p className="muted home-empty-day">{t("No classes today. A good moment to catch up.")}</p>
          )}
        </section>
        {attentionAll.length ? (
          <section aria-labelledby="home-attention-title">
            <div className="sh">
              <h2 id="home-attention-title">{t("To attend to")}</h2>
              <span>{attention.length}</span>
            </div>
            {attention.length ? (
              <div className="alerts" role="list">
                {attentionRows}
              </div>
            ) : null}
            {showSeenAttention}
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
    <div className={pageClass}>
      <header className="home-hello">
        <span className="overline">
          {formatDayMonth(asOf, locale) ? `${formatLongDate(asOf, locale)} · ${formatTime(nowTime, locale)}` : ""}
        </span>
        <h1>{t(greetingKey(now))}</h1>
      </header>

      <section aria-labelledby="home-today-title" data-onboarding-tour="home">
        <div className="sh">
          <h2 id="home-today-title">{t("Today's classes")}</h2>
          <div className="sh-meta">
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
            <TodayTimeline timeline={timeline} day={asOf} selectedKey={selectedItem?.key} onSelect={setSelectedKey} />
            {selectedItem ? (
              <ClassCard
                item={selectedItem}
                now={now}
                derived={todayDerived}
                onRecord={openClass}
                onOpenRecord={openHistory}
                onDismissNotes={onDismissNotes}
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

      {attentionAll.length ? (
        <section aria-labelledby="home-attention-title">
          <div className="sh is-tight">
            <h2 id="home-attention-title" className="overline home-attention-title">
              {t("To attend to · {count}", { count: attention.length })}
            </h2>
            {showSeenAttention}
          </div>
          {attention.length ? (
            <div className="alerts" role="list">
              {attentionRows}
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="home-period-title" id="home-period">
        <div className="sh">
          <h2 id="home-period-title">{periodTitle(period, asOf, t, locale)}</h2>
          <div className="sh-tools">
            {scope}
            <Segmented value={period} onChange={setPeriod} label={t("Period")} items={PERIOD_ITEMS} />
          </div>
        </div>
        {explorer ? (
          <MetricExplorer
            key={`${period}-${archiveScope?.included ? "all" : "active"}-${explorerFocus.request}`}
            initialAside={explorerFocus.aside}
            spotlight={explorerFocus.spotlight}
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
            views={cardViews}
            onViewChange={chooseView}
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
                view={cardViews[id]}
                onViewChange={(view) => chooseView(id, view)}
                onOpen={() => openExplorer(id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
