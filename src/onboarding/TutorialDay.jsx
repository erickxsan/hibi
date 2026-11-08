import { useEffect, useRef, useState } from "react";
import { Check, LockKeyhole } from "lucide-react";
import { AttendanceChoice, Button, Segmented } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { getUiLocale, useI18n } from "../i18n";
import { formatMoney, formatTime, formatTimeRange } from "../utils/displayFormat";
import { ONBOARDING_DAYS } from "./onboardingModel";
import { SAMPLE_PRICE, SAMPLE_STUDENTS, TutorialCat } from "./tutorialShared";

const SCENES = Object.freeze([
  {
    time: "07:30",
    section: "Home",
    title: "Your day, at a glance",
    text: "Open Hibi and you already know which class is next, who owes and what needs your attention.",
  },
  {
    time: "11:00",
    section: "Community",
    title: "A group builds your agenda",
    text: "You set its days once. The classes appear on their own, every week.",
  },
  {
    time: "17:30",
    section: "Classes",
    title: "Take attendance in seconds",
    text: "P if they came, A if they missed. From your phone, without stopping the class.",
  },
  {
    time: "18:30",
    section: "Classes",
    title: "Get paid without keeping count",
    text: "Per class or monthly. Hibi remembers who owes and since when.",
  },
  {
    time: "20:00",
    section: "Tracking",
    title: "See who needs help",
    text: "Grades, attendance and payments come together on their own. Whatever is low stands out.",
  },
  {
    time: "22:00",
    section: "Settings",
    title: "And rest",
    text: "Your work stays encrypted and backed up. Tomorrow you pick up where you left off.",
  },
]);
const ALERTS = Object.freeze([
  "Diego got 6.0 in Practice 9",
  "$1,320 overdue from 5 students",
  "1 Physics fee overdue",
]);
const TASKS = Object.freeze([
  { label: "Practice 3", score: 8.2 },
  { label: "Reading", score: 8.8 },
  { label: "Practice 5", score: 6.3, low: "Diego 5.5 · Andrés 6.0 · Valeria 7.4" },
  { label: "Exam 1", score: 9.1 },
  { label: "Practice 7", score: 7.6 },
  { label: "Practice 9", score: 6.7, low: "Diego 6.0 · Andrés 6.5 · Sofía 7.6" },
  { label: "Oral", score: 8.6 },
]);
const ORB_X = [5, 24, 46, 68, 84, 90];
const ORB_Y = { wide: [120, 40, 14, 56, 60, 72], compact: [52, 16, 8, 24, 58, 58] };
const STARS = Array.from({ length: 10 }, (_, n) => ({
  x: (n * 29 + 7) % 96,
  y: 14 + ((n * 53) % 150),
  delay: (n % 5) * 0.4,
}));

// November 2026 starts on a Sunday, so day N of the week is the Nth of November.
function narrowDay(dayOfWeek, locale) {
  return new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2026, 10, 1 + dayOfWeek, 12));
}

/**
 * «Un día con Hibi»: six moments of a teacher's day, one per section of the menu. Each moment acts out
 * its own example once (a notice gets seen, the days get picked, the roll gets taken…); moving on is
 * always the teacher's click. Everything here is a sample: nothing is saved.
 */
export default function TutorialDay({ compact, onDone }) {
  const { t: uiT } = useI18n();
  const locale = getUiLocale();
  const headingRef = useRef(null);
  const actionsRef = useRef(null);
  const [step, setStep] = useState(0);
  const [seen, setSeen] = useState(() => new Set());
  const [days, setDays] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [paid, setPaid] = useState({});
  const [mode, setMode] = useState("perClass");
  const [point, setPoint] = useState({ index: 3, touched: false });

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // The moment plays its example once; leaving it cancels whatever had not happened yet.
  useEffect(() => {
    const notice = (n) => () => setSeen((current) => new Set(current).add(n));
    const pickDay = (n) => () => setDays((current) => (current.includes(n) ? current : [...current, n]));
    const mark = (id, value) => () => setAttendance((current) => (current[id] ? current : { ...current, [id]: value }));
    const pay = (id) => () => setPaid((current) => ({ ...current, [id]: true }));
    const show = (index) => () => setPoint((current) => (current.touched ? current : { index, touched: false }));
    /** @type {[number, () => void][][]} */
    const script = [
      [
        [1700, notice(0)],
        [3100, notice(1)],
      ],
      [
        [1100, pickDay(1)],
        [2100, pickDay(3)],
      ],
      [
        [900, mark("emilio", "P")],
        [1600, mark("iker", "P")],
        [2300, mark("renata", "A")],
        [3000, mark("ximena", "P")],
      ],
      [
        [1200, pay("emilio")],
        [2300, pay("ximena")],
      ],
      [
        [1400, show(2)],
        [3200, show(5)],
      ],
      [],
    ];
    const timers = script[step].map(([delay, play]) => setTimeout(play, delay));
    return () => timers.forEach(clearTimeout);
  }, [step]);

  const see = (index) => () => setSeen((current) => new Set(current).add(index));
  const scene = SCENES[step];
  const last = step === SCENES.length - 1;
  const night = step >= 4;
  const money = (amount) => formatMoney(amount, locale);
  const group = uiT("Intermediate English");
  const marked = SAMPLE_STUDENTS.filter((student) => attendance[student.id]);
  const present = marked.filter((student) => attendance[student.id] === "P").length;
  const absent = marked.length - present;
  const monthly = mode === "monthly";
  const price = monthly ? SAMPLE_PRICE * 4 : SAMPLE_PRICE;
  let collected = 0;
  let pending = 0;
  for (const student of SAMPLE_STUDENTS) {
    if (!monthly && attendance[student.id] === "A") continue;
    if (paid[student.id]) collected += price;
    else pending += price;
  }
  const tried = [seen.size > 0, days.length > 0, marked.length === 4, Object.keys(paid).length > 0, point.touched];
  const catMood = last ? "sleep" : tried[step] ? "happy" : step === 0 ? "wave" : "";
  const task = TASKS[point.index];
  const chart = TASKS.map((item, index) => ({
    ...item,
    index,
    x: 24 + index * 72,
    y: Math.round(160 - (item.score - 5) * 34),
  }));

  const demos = [
    <>
      <p className="tt-eyebrow tt-accent">{uiT("Next · {time}", { time: formatTime("17:30", locale) })}</p>
      <p className="tt-h2">{group}</p>
      <p className="tt-muted">
        {uiT("4 students · {name} owes {amount}", { name: "Emilio", amount: money(SAMPLE_PRICE) })}
      </p>
      <p className="tt-eyebrow tt-gap">{uiT("Needs attention · {count}", { count: ALERTS.length - seen.size })}</p>
      {ALERTS.map((text, index) => (
        <button
          key={text}
          type="button"
          className={`tt-alert ${seen.has(index) ? "is-seen" : ""}`.trim()}
          aria-pressed={seen.has(index)}
          onClick={see(index)}
        >
          <span className="tt-dot is-bad" aria-hidden="true" />
          <span>{uiT(text)}</span>
        </button>
      ))}
      <p className="tt-hint">{uiT("Each notice takes you to the exact place")}</p>
    </>,
    <>
      <p className="tt-h2">{group}</p>
      <p className="tt-muted">{uiT("Class days · {time}", { time: formatTime("17:30", locale) })}</p>
      <div className="tt-days">
        {ONBOARDING_DAYS.map((day, index) => (
          <button
            key={day.value}
            type="button"
            className={`tt-day-button ${days.includes(index) ? "is-on" : ""}`.trim()}
            aria-pressed={days.includes(index)}
            aria-label={uiT(day.label)}
            onClick={() =>
              setDays((current) =>
                current.includes(index) ? current.filter((value) => value !== index) : [...current, index],
              )
            }
          >
            {narrowDay(day.value, locale)}
          </button>
        ))}
      </div>
      <div className="tt-mini-month" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => (
          <div className="tt-mini-day" key={index}>
            <span>{9 + index}</span>
            {days.includes(index % 7) ? <i style={{ animationDelay: `${index >= 7 ? 0.18 : 0}s` }} /> : null}
          </div>
        ))}
      </div>
      <p className="tt-muted tt-gap-small">
        <b>
          {days.length
            ? uiT("{count} a week · {month} a month", { count: days.length, month: days.length * 4 })
            : uiT("No classes yet")}
        </b>
      </p>
      <p className="tt-hint">{uiT("Mark the days and the agenda fills up")}</p>
    </>,
    <>
      <p className="tt-muted">{uiT("Today · {range}", { range: formatTimeRange("17:30", 1, locale) })}</p>
      <p className="tt-h2">{group}</p>
      {SAMPLE_STUDENTS.map((student) => (
        <div className="tt-demo-row" key={student.id}>
          <StudentAvatar avatarId={student.avatarId} name={student.short} decorative />
          <b>{student.short}</b>
          <AttendanceChoice
            value={attendance[student.id] || ""}
            name={student.short}
            onChange={(value) => setAttendance((current) => ({ ...current, [student.id]: value }))}
          />
        </div>
      ))}
      <p className="tt-sum">
        <span>{uiT(present === 1 ? "{count} present (count)" : "{count} present", { count: present })}</span>
        <span>{uiT(absent === 1 ? "{count} absent (count)" : "{count} absent", { count: absent })}</span>
        <span>{uiT("{count} unmarked", { count: 4 - marked.length })}</span>
      </p>
    </>,
    <>
      <Segmented
        label={uiT("Billing mode")}
        value={mode}
        onChange={setMode}
        items={[
          { value: "perClass", label: "Per class" },
          { value: "monthly", label: "Monthly fee" },
        ]}
      />
      <div className="tt-gap-small">
        {SAMPLE_STUDENTS.map((student) => {
          const excused = !monthly && attendance[student.id] === "A";
          let note = uiT("Owes {amount}", { amount: money(price) });
          if (excused) note = uiT("Absent · not charged");
          else if (paid[student.id]) note = uiT("Up to date");
          return (
            <div className="tt-demo-row" key={student.id}>
              <StudentAvatar avatarId={student.avatarId} name={student.short} decorative />
              <b>{student.short}</b>
              <span className={`tt-status ${excused ? "" : paid[student.id] ? "is-ok" : "is-pending"}`.trim()}>
                {note}
              </span>
              {excused ? null : (
                <span className="choice-group payment-choice">
                  <button
                    type="button"
                    className={paid[student.id] ? "is-paid" : ""}
                    aria-pressed={Boolean(paid[student.id])}
                    aria-label={uiT("{name} paid", { name: student.short })}
                    onClick={() => setPaid((current) => ({ ...current, [student.id]: !current[student.id] }))}
                  >
                    <Check aria-hidden="true" strokeWidth={2.4} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="tt-sum">
        <span>{uiT("{amount} collected", { amount: money(collected) })}</span>
        <span>{uiT("{amount} pending", { amount: money(pending) })}</span>
      </p>
      <p className="tt-muted">
        {monthly ? uiT("Due on day 5 and adjusts per student.") : uiT("Only charged if the student attended.")}
      </p>
    </>,
    <>
      <div className="tt-chart-head">
        <p className="tt-h3">{uiT("Average per assignment")}</p>
        <span className="tt-fake-button" aria-hidden="true">
          {uiT("Export Excel")}
        </span>
      </div>
      <svg
        className="tt-chart"
        viewBox="0 0 480 170"
        role="img"
        aria-label={uiT("Average per assignment: two assignments below 7")}
      >
        <line className="tt-chart-limit" x1="0" y1="62" x2="480" y2="62" />
        <polyline className="tt-chart-line" points={chart.map((item) => `${item.x},${item.y}`).join(" ")} />
        {chart.map((item) => (
          <circle
            key={item.label}
            cx={item.x}
            cy={item.y}
            r={point.index === item.index ? 11 : 8}
            className={item.score < 7 ? "is-low" : undefined}
            onClick={() => setPoint({ index: item.index, touched: true })}
          />
        ))}
      </svg>
      <p className="tt-muted" aria-live="polite">
        <b>
          {uiT(task.label)} · {task.score.toFixed(1)}
        </b>
        <br />
        {task.low || uiT("The whole group is doing well on this one.")}
      </p>
      <p className="tt-hint">{uiT("Each point shows its students")}</p>
    </>,
    <>
      <div className="tt-lock" aria-hidden="true">
        <LockKeyhole strokeWidth={1.8} />
      </div>
      {["End-to-end encryption", "Sync across your devices", "Backups (.hibi) whenever you want"].map((text, index) => (
        <p className="tt-feature" key={text} style={{ animationDelay: `${0.1 + index * 0.15}s` }}>
          <Check aria-hidden="true" strokeWidth={2.4} />
          {uiT(text)}
        </p>
      ))}
    </>,
  ];

  const copy = (
    <div className="tt-copy" aria-live="polite">
      <div key={step} className="tt-fade-up">
        <span className="tt-hour">
          {formatTime(scene.time, locale)} · {uiT(scene.section)}
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="tt-day-title">
          {uiT(scene.title)}
        </h1>
        <p className="tt-day-text">{uiT(scene.text)}</p>
      </div>
    </div>
  );
  const buttons = (
    <div className="tt-day-actions" ref={actionsRef}>
      {step > 0 ? (
        <Button
          onClick={() => {
            // Back on the first moment disappears; keep the keyboard on «Next» instead of losing it.
            if (step === 1) /** @type {HTMLElement | null} */ (actionsRef.current?.lastElementChild)?.focus();
            setStep(step - 1);
          }}
        >
          {uiT("Back")}
        </Button>
      ) : null}
      <Button variant="primary" onClick={() => (last ? onDone() : setStep(step + 1))}>
        {last ? uiT("Your turn") : uiT("Next")}
      </Button>
    </div>
  );
  const demo = (
    <div key={step} className="tt-demo">
      {demos[step]}
    </div>
  );

  return (
    <div className={`tt-day tt-day-${step} ${night ? "is-night" : ""}`.trim()}>
      <div className="tt-sky" aria-hidden="true">
        {STARS.map((star) => (
          <i
            key={`${star.x}-${star.y}`}
            className="tt-star"
            style={{ left: `${star.x}%`, top: star.y, animationDelay: `${star.delay}s` }}
          />
        ))}
        <div
          className={`tt-orb ${night ? "is-moon" : ""}`.trim()}
          style={{ left: `${ORB_X[step]}%`, top: (compact ? ORB_Y.compact : ORB_Y.wide)[step] }}
        />
      </div>
      <header className="tt-day-top">
        <img
          className="tt-logo"
          src={night ? "/brand/hibi-logo-horizontal-dark.svg" : "/brand/hibi-logo-horizontal.svg"}
          alt="hibi"
        />
        <Button variant="ghost" onClick={onDone}>
          {uiT("Skip")}
        </Button>
      </header>
      {/* On a phone the moment scrolls while its buttons stay in reach, above the day line. */}
      <section className="tt-stage">
        {compact ? (
          <>
            {copy}
            {demo}
          </>
        ) : (
          <>
            <div>
              {copy}
              {buttons}
            </div>
            {demo}
          </>
        )}
      </section>
      {compact ? buttons : null}
      <nav className="tt-track" aria-label={uiT("Moments of the day")}>
        <div className="tt-track-line" />
        <div className="tt-track-fill" style={{ width: `${step * 20}%` }} />
        {SCENES.map((item, index) => (
          <button
            key={item.time}
            type="button"
            className={`tt-stop ${index <= step ? "is-done" : ""}`.trim()}
            style={{ left: `${index * 20}%` }}
            aria-label={uiT("Go to {time}", { time: formatTime(item.time, locale) })}
            aria-current={index === step ? "step" : undefined}
            onClick={() => setStep(index)}
          >
            <span>{formatTime(item.time, locale)}</span>
          </button>
        ))}
        <div className="tt-track-cat" style={{ left: `${step * 20}%` }} aria-hidden="true">
          <div key={step} className="tt-hop">
            <TutorialCat mood={catMood} />
            {last ? (
              <>
                <span className="tt-zz">z</span>
                <span className="tt-zz">z</span>
              </>
            ) : null}
          </div>
        </div>
      </nav>
    </div>
  );
}
