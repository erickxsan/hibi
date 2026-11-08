import { useEffect, useRef, useState } from "react";
import { BarChart3, CalendarDays, Home as HomeIcon, Settings as SettingsIcon, UsersRound } from "lucide-react";
import { AttendanceChoice, Button, PaymentChoice, Segmented } from "../components/ui";
import { HibiLogo } from "../components/BrandMark";
import { StudentAvatar } from "../components/StudentAvatar";
import { getUiLocale, useI18n } from "../i18n";
import { formatMoney, formatTime, formatTimeRange } from "../utils/displayFormat";
import { ONBOARDING_DAYS } from "./onboardingModel";
import { SAMPLE_PRICE, SAMPLE_STUDENTS, TapPaw, TutorialCat } from "./tutorialShared";

const NAV = Object.freeze([
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "community", label: "Community", icon: UsersRound },
  { id: "classes", label: "Classes", icon: CalendarDays },
  { id: "tracking", label: "Tracking", icon: BarChart3 },
  { id: "settings", label: "Settings", mobileLabel: "Adjustments", icon: SettingsIcon },
]);
// Step → [title, text]. Steps 2–4 happen in Classes, 5 back in Home, then Tracking and Community.
const GUIDES = Object.freeze({
  1: ["Your turn: open your class", "Hibi already knows which class is next and who owes something. Open it."],
  2: ["Take the roll", "Tap P or A for each student. Whoever is absent is not charged."],
  3: ["Record a payment", "Marking P shows the payment. Tap ✓ if they already paid or – if it stays pending."],
  4: ["Save it", "Check the totals below and save. You can fix it later."],
  5: ["It’s already in Home", "Hibi closed the class for you. Tap Tracking to see where everything went."],
  6: [
    "Everything sorted itself out",
    "Payments and attendance already count this class, without entering anything twice. Tap Community.",
  ],
  7: ["Each group, on one card", "Its attendance, its contacts and what is missing. Today’s class is already there."],
});
const HISTORY = Object.freeze({ emilio: "PPPPP", iker: "PPAPP", renata: "PPPPP", ximena: "PAPPP" });
const WEEK_BARS = [40, 62, 30, 78, 0, 0, 0];

function screenFor(step) {
  if (step === 1 || step === 5) return "home";
  if (step <= 4) return "classes";
  return step === 6 ? "tracking" : "community";
}

/**
 * The practice class: a pretend Hibi with four sample students. The teacher opens the class, takes
 * attendance, records a payment and saves it, then sees where it went. Each step waits for the
 * teacher's own tap. As `backdrop` it only shows Community behind the group form.
 */
export default function TutorialPractice({ compact, backdrop = false, onFinish }) {
  const { t: uiT, language } = useI18n();
  const locale = getUiLocale();
  const timers = useRef([]);
  const headingRef = useRef(null);
  const [step, setStep] = useState(1);
  const [attendance, setAttendance] = useState({});
  const [payments, setPayments] = useState({});
  const [grades, setGrades] = useState({});
  const [assignment, setAssignment] = useState(false);
  const [stamp, setStamp] = useState(false);
  const [joy, setJoy] = useState(false);

  const screen = backdrop ? "community" : screenFor(step);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // Each new screen takes focus, as a real page change would.
  useEffect(() => {
    if (!backdrop) headingRef.current?.focus();
  }, [backdrop, screen]);

  const later = (play, delay) => timers.current.push(setTimeout(play, delay));
  const cheer = () => {
    setJoy(true);
    later(() => setJoy(false), 800);
  };
  const mark = (id, value) => {
    const next = { ...attendance, [id]: value };
    setAttendance(next);
    cheer();
    if (step === 2 && SAMPLE_STUDENTS.every((student) => next[student.id])) {
      const anyone = SAMPLE_STUDENTS.some((student) => next[student.id] === "P");
      later(() => setStep(anyone ? 3 : 4), 500);
    }
  };
  const recordPayment = (id, value) => {
    setPayments((current) => ({ ...current, [id]: value }));
    if (step === 3 && value) {
      cheer();
      later(() => setStep(4), 500);
    }
  };
  const save = () => {
    setStamp(true);
    later(() => {
      setStamp(false);
      setStep(5);
    }, 1300);
  };

  const money = (amount) => formatMoney(amount, locale);
  const saved = step >= 5;
  const group = uiT("Intermediate English");
  const range = formatTimeRange("17:30", 1, locale);
  const present = SAMPLE_STUDENTS.filter((student) => attendance[student.id] === "P");
  const absent = SAMPLE_STUDENTS.filter((student) => attendance[student.id] === "A").length;
  const paid = present.filter((student) => payments[student.id] === "Paid").length * SAMPLE_PRICE;
  const owed = present.length * SAMPLE_PRICE - paid;
  const firstUnmarked = SAMPLE_STUDENTS.find((student) => !attendance[student.id]);
  const firstPayer = present.find((student) => !payments[student.id]) || present[0];
  const spotNav = step === 5 ? "tracking" : step === 6 ? "community" : "";
  const guide = backdrop ? null : GUIDES[step];
  const progress = [1, 2, 3, 4, 5, 5, 6][step - 1];
  // A made-up Thursday afternoon: the sample group meets on Tuesdays and Thursdays at 5:30.
  const today = uiT("Today · {time}", { time: formatTime("15:20", locale) });
  const presentText = uiT(present.length === 1 ? "{count} present (count)" : "{count} present", {
    count: present.length,
  });

  const navItem = (item, short = false) => {
    const Icon = item.icon;
    const active = item.id === screen;
    const content = (
      <>
        <Icon aria-hidden="true" size={short ? 23 : 21} strokeWidth={1.8} />
        <span>{uiT(short && item.mobileLabel && language === "es" ? item.mobileLabel : item.label)}</span>
      </>
    );
    const className = `${short ? "tt-tab-item" : "tt-nav-item"} ${active ? "is-active" : ""}`.trim();
    // Only the section the guide points at answers; the rest of the pretend menu is a picture.
    if (item.id !== spotNav) {
      return (
        <span key={item.id} className={className} aria-current={active ? "page" : undefined}>
          {content}
        </span>
      );
    }
    return (
      <button
        key={item.id}
        type="button"
        className={`${className} tt-spot`}
        onClick={() => setStep(step === 5 ? 6 : 7)}
      >
        {content}
        <TapPaw className="tt-paw-nav" />
      </button>
    );
  };

  const home = (
    <section className="tt-pane">
      <p className="tt-eyebrow">{today}</p>
      <h1 ref={headingRef} tabIndex={-1} className="tt-title">
        {uiT("Good afternoon, teacher!")}
      </h1>
      {compact ? null : (
        <div className="tt-timeline" aria-hidden="true">
          <div className="tt-rail">
            <b />
          </div>
          <div className="tt-block tt-block-first">
            <span>{formatTimeRange("12:00", 2, locale)}</span>
            <b>{uiT("High school physics")}</b>
          </div>
          <div className="tt-now">
            <span>{uiT("Now · {time}", { time: formatTime("15:20", locale) })}</span>
          </div>
          <div className={`tt-block tt-block-next ${saved ? "is-done" : ""}`.trim()}>
            <span>{range}</span>
            <b>{group}</b>
          </div>
        </div>
      )}
      <div className="tt-next">
        <div className="tt-next-main">
          <p className="tt-eyebrow tt-accent">
            {saved ? uiT("Done · today") : uiT("Next · starts in {time}", { time: "2 h 10 min" })}
          </p>
          <p className="tt-h2">{group}</p>
          <p className="tt-muted">
            {range} · {uiT("{p0} students", { p0: 4 })}
          </p>
          <div className="tt-people">
            {SAMPLE_STUDENTS.map((student) => (
              <div key={student.id}>
                <StudentAvatar avatarId={student.avatarId} name={student.short} decorative />
                <span>{student.short}</span>
                {compact ? null : (
                  <span className={`tt-status ${student.owes ? "is-pending" : "is-ok"}`}>
                    {student.owes ? uiT("Owes {amount}", { amount: money(SAMPLE_PRICE) }) : uiT("Up to date")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="tt-next-side">
          {saved ? (
            <>
              <p className="tt-eyebrow">{uiT("Class result")}</p>
              <p>{uiT("{present} and {amount} collected.", { present: presentText, amount: money(paid) })}</p>
              <p className="tt-status is-ok">
                <span className="tt-dot is-ok" aria-hidden="true" />
                {uiT("Class recorded")}
              </p>
            </>
          ) : (
            <>
              <p className="tt-eyebrow">{uiT("Before you start")}</p>
              {SAMPLE_STUDENTS.filter((student) => student.owes).map((student) => (
                <p className="tt-note" key={student.id}>
                  <span className="tt-dot is-pending" aria-hidden="true" />
                  {uiT("{name} owes {amount} from the last class.", {
                    name: student.short,
                    amount: money(SAMPLE_PRICE),
                  })}
                </p>
              ))}
              <span className="tt-spot-wrap">
                <Button
                  variant="primary"
                  className={step === 1 ? "tt-spot" : ""}
                  disabled={step !== 1}
                  onClick={() => setStep(2)}
                >
                  {uiT("Record class")}
                </Button>
                {step === 1 ? <TapPaw className="tt-paw-button" /> : null}
              </span>
            </>
          )}
        </div>
      </div>
      {compact ? null : (
        <div className="tt-attention">
          <p className="tt-eyebrow">{uiT("Needs attention · {count}", { count: 2 })}</p>
          <p className="tt-note">
            <span className="tt-dot is-bad" aria-hidden="true" />
            {uiT("Diego got 6.0 in Practice 9.")} <span className="tt-link">{uiT("See it in the chart")}</span>
          </p>
        </div>
      )}
    </section>
  );

  const classes = (
    <section className="tt-pane">
      <h1 ref={headingRef} tabIndex={-1} className="tt-title">
        {uiT("Classes")}
      </h1>
      <div className="tt-tabs" aria-hidden="true">
        <span className="is-active">{uiT("Next class")}</span>
        <span>{uiT("Calendar")}</span>
        <span>{uiT("History")}</span>
      </div>
      <div className="tt-classes">
        {compact ? null : (
          <div className="tt-agenda" aria-hidden="true">
            <p className="tt-eyebrow">{uiT("Today")}</p>
            <p>
              <b>
                {formatTime("12:00", locale)} · {uiT("Physics (class)")}
              </b>
              {uiT("2 h · 3 students")}
            </p>
            <p className="is-active">
              <b>
                {formatTime("17:30", locale)} · {uiT("English (class)")}
              </b>
              {uiT("1 h · 4 students")}
            </p>
          </div>
        )}
        <div className="tt-class">
          <p className="tt-muted">{uiT("Today · {range} · Group", { range })}</p>
          <div className="tt-class-head">
            <h2 className="tt-h2">{group}</h2>
            <div className="tt-assignment">
              <span className="tt-muted">{uiT("Record an assignment?")}</span>
              <Segmented
                label={uiT("Record an assignment?")}
                value={assignment}
                onChange={setAssignment}
                items={[
                  { value: true, label: "Yes" },
                  { value: false, label: "No" },
                ]}
              />
            </div>
          </div>
          {compact ? null : (
            <div className="tt-roster-row is-head" aria-hidden="true">
              <span>{uiT("Student")}</span>
              <span>{uiT("Attendance")}</span>
              <span>{assignment ? uiT("Payment · Grade") : uiT("Payment for this class")}</span>
            </div>
          )}
          {SAMPLE_STUDENTS.map((student) => {
            const value = attendance[student.id] || "";
            let payment = compact ? null : <span className="tt-muted">—</span>;
            if (value === "A") payment = <span className="tt-muted">{uiT("— absent · not charged")}</span>;
            if (value === "P") {
              payment = (
                <>
                  <span className="tt-spot-wrap">
                    <PaymentChoice
                      value={payments[student.id] || ""}
                      name={student.name}
                      onChange={(choice) => recordPayment(student.id, choice)}
                    />
                    {step === 3 && firstPayer?.id === student.id ? <TapPaw className="tt-paw-choice" /> : null}
                  </span>
                  {assignment ? (
                    <input
                      className="control tt-grade"
                      inputMode="decimal"
                      aria-label={uiT("Grade for {name}", { name: student.name })}
                      placeholder="/10"
                      value={grades[student.id] || ""}
                      onChange={(event) =>
                        setGrades((current) => ({ ...current, [student.id]: event.target.value.replace(",", ".") }))
                      }
                    />
                  ) : null}
                </>
              );
            }
            return (
              <div className="tt-roster-row" key={student.id}>
                <span className="tt-who">
                  <StudentAvatar avatarId={student.avatarId} name={student.name} decorative />
                  <b>{student.name}</b>
                </span>
                <span className="tt-spot-wrap">
                  <AttendanceChoice value={value} name={student.name} onChange={(choice) => mark(student.id, choice)} />
                  {step === 2 && firstUnmarked?.id === student.id ? <TapPaw className="tt-paw-choice" /> : null}
                </span>
                <span className="tt-payment">{payment}</span>
              </div>
            );
          })}
          <div className="tt-class-foot">
            <p className="tt-totals">
              <span>{presentText}</span>
              <span>{uiT(absent === 1 ? "{count} absent (count)" : "{count} absent", { count: absent })}</span>
              <span>{uiT("{count} unmarked", { count: 4 - present.length - absent })}</span>
              <span>{uiT("{amount} collected today", { amount: money(paid) })}</span>
              <span>{uiT("{amount} pending", { amount: money(owed) })}</span>
            </p>
            <span className="tt-spot-wrap">
              <Button
                variant="primary"
                className={step === 4 ? "tt-spot" : ""}
                disabled={step !== 4 || stamp}
                onClick={save}
              >
                {uiT("Save class")}
              </Button>
              {step === 4 && !stamp ? <TapPaw className="tt-paw-button" /> : null}
            </span>
          </div>
        </div>
      </div>
    </section>
  );

  const tracking = (
    <section className="tt-pane">
      <h1 ref={headingRef} tabIndex={-1} className="tt-title">
        {uiT("Tracking")}
      </h1>
      <div className="tt-tabs" aria-hidden="true">
        <span>{uiT("Grades")}</span>
        <span>{uiT("Attendance")}</span>
        <span className="is-active">{uiT("Payments")}</span>
      </div>
      <div className="tt-kpis">
        <div>
          <span className="tt-muted">{uiT("Collected")}</span>
          <strong>{money(4200 + paid)}</strong>
          <span className="tt-delta">{uiT("+{amount} today", { amount: money(paid) })}</span>
        </div>
        <div>
          <span className="tt-muted">{uiT("Pending")}</span>
          <strong>{money(1320 + owed)}</strong>
          <span className="tt-delta is-pending">{uiT("+{amount} today", { amount: money(owed) })}</span>
        </div>
        <div>
          <span className="tt-muted">{uiT("Attendance")}</span>
          <strong>{Math.round(((46 + present.length) / (50 + present.length + absent)) * 100)}%</strong>
          <span className="tt-delta is-muted">{uiT("with this class")}</span>
        </div>
      </div>
      <div className="tt-tracking">
        <div>
          <p className="tt-h3">{uiT("Collected this week")}</p>
          <div className="tt-bars" aria-hidden="true">
            {ONBOARDING_DAYS.map((day, index) => (
              <div key={day.value} className={index === 3 ? "is-today" : ""}>
                <i
                  style={{
                    height: `${index === 3 ? Math.min(92, 34 + paid / 14) : WEEK_BARS[index]}%`,
                    animationDelay: `${index * 0.06}s`,
                  }}
                />
                <span>{uiT(day.shortLabel)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="tt-eyebrow">{uiT("{group} · today", { group })}</p>
          {SAMPLE_STUDENTS.map((student) => {
            const value = attendance[student.id];
            let note = uiT("Owes {amount}", { amount: money(SAMPLE_PRICE) });
            if (value === "A") note = uiT("Absent · not charged");
            else if (payments[student.id] === "Paid") note = uiT("Paid {amount}", { amount: money(SAMPLE_PRICE) });
            const tone = value === "A" ? "" : payments[student.id] === "Paid" ? "is-ok" : "is-pending";
            return (
              <div className="tt-list-row" key={student.id}>
                <StudentAvatar avatarId={student.avatarId} name={student.short} size="small" decorative />
                <b>{student.short}</b>
                <span className={`tt-status ${tone}`.trim()}>{note}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );

  const columns = ["Tue", "Thu", "Tue", "Thu", "Tue"].map((day) => uiT(day));
  const community = (
    <section className="tt-pane">
      <h1 ref={backdrop ? undefined : headingRef} tabIndex={-1} className="tt-title">
        {uiT("Community")}
      </h1>
      <div className="tt-community">
        <div className="tt-groups" aria-hidden="true">
          <p>
            <b>{uiT("Math 3B")}</b>
            {uiT("5 students · Mon and Wed")}
          </p>
          <p className="is-active">
            <b>{group}</b>
            {uiT("4 students · Tue and Thu · {time}", { time: formatTime("17:30", locale) })}
          </p>
          <p>
            <b>{uiT("High school physics")}</b>
            {uiT("3 students · Thu and Fri")}
          </p>
        </div>
        <div>
          <p className="tt-eyebrow">{uiT("Attendance by class")}</p>
          <div className="tt-grid" aria-hidden="true">
            <span />
            {columns.map((label, index) => (
              <span key={index}>{label}</span>
            ))}
            <span>{uiT("Today")}</span>
            {SAMPLE_STUDENTS.map((student) => {
              const value = attendance[student.id] || "";
              return [
                <span key={student.id} className="tt-grid-name">
                  {student.short}
                </span>,
                ...HISTORY[student.id].split("").map((mark, index) => (
                  <span key={`${student.id}-${index}`} className={`tt-cell ${mark === "A" ? "is-absent" : ""}`.trim()}>
                    {mark}
                  </span>
                )),
                <span
                  key={`${student.id}-today`}
                  className={`tt-cell is-new ${value === "A" ? "is-absent" : value ? "" : "is-unmarked"}`.trim()}
                >
                  {value || "–"}
                </span>,
              ];
            })}
          </div>
          <div className="tt-directory">
            <p className="tt-eyebrow">{uiT("Directory")}</p>
            <span className="tt-link">{uiT("Copy emails")}</span>
          </div>
          <p className="tt-muted">emilio@correo.mx · iker@correo.mx · +2</p>
        </div>
      </div>
    </section>
  );

  const panes = { home, classes, tracking, community };

  return (
    <div className={`tt-practice ${compact ? "is-compact" : ""}`.trim()} inert={backdrop}>
      {compact ? (
        <header className="tt-topbar">
          <HibiLogo className="tt-logo" height={32} />
          {backdrop ? null : (
            <Button variant="ghost" onClick={onFinish}>
              {uiT("Skip")}
            </Button>
          )}
        </header>
      ) : (
        <aside className="tt-side">
          <HibiLogo className="tt-logo" height={42} />
          <nav className="tt-nav" aria-label={uiT("Practice menu")}>
            {NAV.map((item) => navItem(item))}
          </nav>
          <span className="tt-sync">{uiT("Local only")}</span>
        </aside>
      )}
      <main className="tt-sheet">
        {backdrop ? null : (
          <div className="tt-practice-bar">
            <span className="tt-practice-pill">{uiT("Practice · nothing is saved")}</span>
            {compact ? null : (
              <Button variant="ghost" onClick={onFinish}>
                {uiT("Skip")}
              </Button>
            )}
          </div>
        )}
        <div key={screen} className="tt-pane-wrap">
          {panes[screen]}
        </div>
        {guide ? (
          <section
            className={`tt-guide ${step >= 2 && step <= 4 ? "is-left" : ""} ${step === 4 ? "is-up" : ""}`.trim()}
            aria-label={uiT("Guide")}
          >
            <div className="tt-guide-top">
              <TutorialCat mood={`${step === 1 ? "wave" : ""} ${joy || saved ? "happy" : ""}`.trim()} size={42} />
              <span className="tt-progress" role="img" aria-label={uiT("Step {p0} of {p1}", { p0: progress, p1: 6 })}>
                {[1, 2, 3, 4, 5, 6].map((index) => (
                  <i key={index} className={index <= progress ? "is-on" : ""} />
                ))}
              </span>
            </div>
            <div aria-live="polite">
              <p className="tt-guide-title">{uiT(guide[0])}</p>
              <p className="tt-guide-text">{uiT(guide[1])}</p>
            </div>
            {step === 2 ? (
              <p className="tt-guide-foot tt-muted">
                {uiT("{count} of 4 students", { count: present.length + absent })}
              </p>
            ) : null}
            {step === 7 ? (
              <div className="tt-guide-foot">
                <Button variant="primary" onClick={onFinish}>
                  {uiT("Now mine")}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
        {stamp ? (
          <div className="tt-stamp" aria-hidden="true">
            {uiT("Class recorded")}
          </div>
        ) : null}
      </main>
      {compact ? (
        <nav className="tt-tabbar" aria-label={uiT("Practice menu")}>
          {NAV.map((item) => navItem(item, true))}
        </nav>
      ) : null}
    </div>
  );
}
