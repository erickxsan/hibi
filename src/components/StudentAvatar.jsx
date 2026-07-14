import { Check } from "lucide-react";
import { STUDENT_AVATAR_IDS } from "../domain/constants";

const AVATAR_META = Object.freeze({
  cat: { label: "Cat", tone: "lilac" },
  dog: { label: "Dog", tone: "sand" },
  penguin: { label: "Penguin", tone: "blue" },
  fox: { label: "Fox", tone: "peach" },
  rabbit: { label: "Rabbit", tone: "pink" },
  bear: { label: "Bear", tone: "olive" },
  frog: { label: "Frog", tone: "mint" },
  owl: { label: "Owl", tone: "gold" },
});

export const STUDENT_AVATARS = Object.freeze(STUDENT_AVATAR_IDS.map((id) => ({ id, ...AVATAR_META[id] })));

function AnimalFace({ id }) {
  const commonFace = <><circle cx="24" cy="26" r="14" /><circle cx="19" cy="25" r="1.35" fill="currentColor" stroke="none" /><circle cx="29" cy="25" r="1.35" fill="currentColor" stroke="none" /></>;
  if (id === "dog") return <>{commonFace}<path d="M12 19c-5-5-7 1-5 8 1 4 4 6 7 5M36 19c5-5 7 1 5 8-1 4-4 6-7 5" /><ellipse cx="24" cy="31" rx="4.5" ry="3.5" /><path d="M22 31h4M24 34v2" /></>;
  if (id === "penguin") return <><ellipse cx="24" cy="26" rx="13" ry="17" /><ellipse cx="24" cy="29" rx="8" ry="11" /><circle cx="20" cy="21" r="1.4" fill="currentColor" stroke="none" /><circle cx="28" cy="21" r="1.4" fill="currentColor" stroke="none" /><path d="m21 25 3 2 3-2-3-2-3 2ZM11 26l-5 7M37 26l5 7M18 42l-4 2M30 42l4 2" /></>;
  if (id === "fox") return <><path d="m11 10 9 5a15 15 0 0 1 8 0l9-5-2 17c-1 9-6 14-11 14s-10-5-11-14L11 10Z" /><circle cx="19" cy="25" r="1.35" fill="currentColor" stroke="none" /><circle cx="29" cy="25" r="1.35" fill="currentColor" stroke="none" /><path d="m17 31 7 6 7-6-7 2-7-2Z" /></>;
  if (id === "rabbit") return <><ellipse cx="18" cy="11" rx="5" ry="10" transform="rotate(-9 18 11)" /><ellipse cx="30" cy="11" rx="5" ry="10" transform="rotate(9 30 11)" />{commonFace}<path d="m22 31 2 2 2-2M24 33v4M20 36h8" /></>;
  if (id === "bear") return <><circle cx="13" cy="16" r="6" /><circle cx="35" cy="16" r="6" />{commonFace}<ellipse cx="24" cy="31" rx="5" ry="4" /><circle cx="24" cy="29.5" r="1.5" fill="currentColor" stroke="none" /><path d="M21 33c2 2 4 2 6 0" /></>;
  if (id === "frog") return <><circle cx="16" cy="17" r="7" /><circle cx="32" cy="17" r="7" /><path d="M11 19c-3 5-2 14 3 18 5 4 15 4 20 0 5-4 6-13 3-18" /><circle cx="16" cy="17" r="1.5" fill="currentColor" stroke="none" /><circle cx="32" cy="17" r="1.5" fill="currentColor" stroke="none" /><path d="M17 31c4 4 10 4 14 0" /></>;
  if (id === "owl") return <><path d="M11 12c5 1 8 0 13-4 5 4 8 5 13 4v17c0 8-6 13-13 15-7-2-13-7-13-15V12Z" /><circle cx="18" cy="24" r="6" /><circle cx="30" cy="24" r="6" /><circle cx="18" cy="24" r="1.5" fill="currentColor" stroke="none" /><circle cx="30" cy="24" r="1.5" fill="currentColor" stroke="none" /><path d="m21 31 3 3 3-3-3-2-3 2Z" /></>;
  return <><path d="m12 21-2-12 12 7M36 21l2-12-12 7" />{commonFace}<path d="m22 31 2 2 2-2M24 33v3M11 29l-7-2M12 33l-7 2M37 29l7-2M36 33l7 2" /></>;
}

export function StudentAvatar({ avatarId, name = "Student", size = "medium", decorative = false, className = "" }) {
  const id = STUDENT_AVATAR_IDS.includes(avatarId) ? avatarId : "cat";
  const meta = AVATAR_META[id];
  return (
    <span className={`student-animal-avatar avatar-tone-${meta.tone} avatar-size-${size} ${className}`.trim()} role={decorative ? undefined : "img"} aria-hidden={decorative ? "true" : undefined} aria-label={decorative ? undefined : `${meta.label} avatar for ${name}`}>
      <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><AnimalFace id={id} /></svg>
    </span>
  );
}

export function AvatarPicker({ value, onChange }) {
  const selected = STUDENT_AVATAR_IDS.includes(value) ? value : "cat";
  return (
    <details className="avatar-picker">
      <summary aria-label="Choose student avatar">
        <StudentAvatar avatarId={selected} name="Selected student" size="small" decorative />
        <span><strong>Student avatar</strong><small>{AVATAR_META[selected].label}</small></span>
        <span className="avatar-picker-change">Change</span>
      </summary>
      <fieldset>
        <legend>Choose an avatar</legend>
        <div className="avatar-option-grid">
          {STUDENT_AVATARS.map((avatar) => (
            <label className={selected === avatar.id ? "avatar-option selected" : "avatar-option"} key={avatar.id}>
              <input type="radio" name="student-avatar" value={avatar.id} checked={selected === avatar.id} onChange={() => onChange(avatar.id)} />
              <StudentAvatar avatarId={avatar.id} name={avatar.label} size="small" decorative />
              <span>{avatar.label}</span>
              {selected === avatar.id ? <Check size={14} aria-hidden="true" /> : null}
            </label>
          ))}
        </div>
      </fieldset>
    </details>
  );
}
