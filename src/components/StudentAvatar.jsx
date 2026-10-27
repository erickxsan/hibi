import { uiText } from "../i18n";
import { useI18n } from "../i18n/index.jsx";
import { Check } from "lucide-react";
import { STUDENT_AVATAR_IDS } from "../domain/constants";
import { playHibiSound } from "../utils/hibiSounds";

const AVATAR_META = Object.freeze({
  cat: { label: "Cat", tone: "indigo" },
  dog: { label: "Dog", tone: "kraft" },
  penguin: { label: "Penguin", tone: "indigo" },
  fox: { label: "Fox", tone: "ocre" },
  rabbit: { label: "Rabbit", tone: "bermellon" },
  bear: { label: "Bear", tone: "kraft" },
  frog: { label: "Frog", tone: "jade" },
  owl: { label: "Owl", tone: "ocre" },
});

export const STUDENT_AVATARS = Object.freeze(STUDENT_AVATAR_IDS.map((id) => ({ id, ...AVATAR_META[id] })));

function AnimalFace({ id }) {
  if (id === "dog")
    return (
      <>
        <path d="M13.5 22C13.5 15 18 11 24 11S34.5 15 34.5 22V27.5C34.5 34 29.8 38.8 24 38.8S13.5 34 13.5 27.5Z" />
        <path d="M14.2 16.5C9.5 14.8 6.5 18.5 7.2 24.6 7.6 28.4 10.6 29.6 13.5 27.3M33.8 16.5C38.5 14.8 41.5 18.5 40.8 24.6 40.4 28.4 37.4 29.6 34.5 27.3" />
        <circle cx="19.2" cy="24.2" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="28.8" cy="24.2" r="1.8" fill="currentColor" stroke="none" />
        <ellipse cx="24" cy="30.8" rx="4.6" ry="3.6" />
        <ellipse cx="24" cy="29.3" rx="1.9" ry="1.3" fill="currentColor" stroke="none" />
        <path d="M24 30.4v1.4" />
        <ellipse cx="16" cy="29.2" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
        <ellipse cx="32" cy="29.2" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
      </>
    );
  if (id === "penguin")
    return (
      <>
        <ellipse cx="24" cy="26" rx="13" ry="17" />
        <ellipse cx="24" cy="29" rx="8" ry="11" />
        <circle cx="20" cy="21" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="28" cy="21" r="1.4" fill="currentColor" stroke="none" />
        <path d="m21 25 3 2 3-2-3-2-3 2ZM11 26l-5 7M37 26l5 7M18 42l-4 2M30 42l4 2" />
      </>
    );
  if (id === "fox")
    return (
      <>
        <path d="M9 9.6C9 8.6 10 8 10.8 8.6L18.4 14.6C22 13.6 26 13.6 29.6 14.6L37.2 8.6C38 8 39 8.6 39 9.6L38 22C37.4 30.5 31.5 37.5 24 39.5 16.5 37.5 10.6 30.5 10 22Z" />
        <path d="M11.6 26.4C16.4 26.9 20.8 29.8 24 33.2 27.2 29.8 31.6 26.9 36.4 26.4" />
        <circle cx="18.8" cy="23.8" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="29.2" cy="23.8" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="24" cy="36.2" r="1.5" fill="currentColor" stroke="none" />
      </>
    );
  if (id === "rabbit")
    return (
      <>
        <path d="M19.2 17.4C15.8 12.4 15.2 5.6 17.8 4.3S22.8 9.2 22.1 16.5M28.8 17.4C32.2 12.4 32.8 5.6 30.2 4.3S25.2 9.2 25.9 16.5" />
        <ellipse cx="24" cy="28" rx="13" ry="11.6" />
        <circle cx="19.2" cy="27" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="28.8" cy="27" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="24" cy="30.2" r="1.1" fill="currentColor" stroke="none" />
        <path d="M22 32.1q1 1 2 0q1 1 2 0" />
        <ellipse cx="15.6" cy="31" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
        <ellipse cx="32.4" cy="31" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
      </>
    );
  if (id === "bear")
    return (
      <>
        <circle cx="24" cy="27.2" r="13.4" />
        <path d="M13.6 19.2A5 5 0 1 1 19.9 14.4M34.4 19.2A5 5 0 1 0 28.1 14.4" />
        <circle cx="18.8" cy="25.2" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="29.2" cy="25.2" r="1.8" fill="currentColor" stroke="none" />
        <ellipse cx="24" cy="31.4" rx="5.2" ry="3.9" />
        <ellipse cx="24" cy="30" rx="1.9" ry="1.3" fill="currentColor" stroke="none" />
        <path d="M24 31.2v1.5" />
        <ellipse cx="15.2" cy="30.2" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
        <ellipse cx="32.8" cy="30.2" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
      </>
    );
  if (id === "frog")
    return (
      <>
        <path d="M9.5 19.5A6.5 6.5 0 1 1 20.8 18.9C23 18.3 25 18.3 27.2 18.9A6.5 6.5 0 1 1 38.5 19.5C42 25 41.5 34 35.5 37.5 29.5 41 18.5 41 12.5 37.5 6.5 34 6 25 9.5 19.5Z" />
        <circle cx="15" cy="16.2" r="2.3" fill="currentColor" stroke="none" />
        <circle cx="33" cy="16.2" r="2.3" fill="currentColor" stroke="none" />
        <path d="M19.6 29.4C22.2 31.6 25.8 31.6 28.4 29.4" />
        <ellipse cx="13.4" cy="28.4" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
        <ellipse cx="34.6" cy="28.4" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
      </>
    );
  if (id === "owl")
    return (
      <>
        <path d="M11.5 18C11.5 13.5 13 10.6 15.2 9.2 16.8 11 18.2 12.2 19.8 13 22.6 12.2 25.4 12.2 28.2 13 29.8 12.2 31.2 11 32.8 9.2 35 10.6 36.5 13.5 36.5 18V28C36.5 35.2 31 40 24 40S11.5 35.2 11.5 28Z" />
        <circle cx="18.7" cy="22.8" r="4.9" />
        <circle cx="29.3" cy="22.8" r="4.9" />
        <circle cx="19.3" cy="23.4" r="2.1" fill="currentColor" stroke="none" />
        <circle cx="28.7" cy="23.4" r="2.1" fill="currentColor" stroke="none" />
        <path d="M22.8 28.2Q24 31 25.2 28.2Z" fill="currentColor" />
        <ellipse cx="15.6" cy="31" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
        <ellipse cx="32.4" cy="31" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
        <path d="M21 40v1.6M27 40v1.6" />
      </>
    );
  return (
    <>
      <path d="M11 25C11 17 13 12.2 14.5 9.6Q15.3 8.3 16.4 9.2L20.4 12.6C22.7 12 25.3 12 27.6 12.6L31.6 9.2Q32.7 8.3 33.5 9.6C35 12.2 37 17 37 25C37 33.5 31.2 39 24 39S11 33.5 11 25Z" />
      <circle cx="19" cy="25.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="29" cy="25.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="24" cy="28.6" r="1.1" fill="currentColor" stroke="none" />
      <path d="M22 30.5q1 1 2 0q1 1 2 0" />
      <ellipse cx="15.8" cy="29.4" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
      <ellipse cx="32.2" cy="29.4" rx="2.3" ry="1.4" fill="currentColor" fillOpacity=".16" stroke="none" />
    </>
  );
}

export function StudentAvatar({ avatarId, name = "Student", size = "medium", decorative = false, className = "" }) {
  const { t: uiT } = useI18n();
  const id = STUDENT_AVATAR_IDS.includes(avatarId) ? avatarId : "cat";
  const meta = AVATAR_META[id];
  return (
    <span
      className={`student-animal-avatar avatar-tone-${meta.tone} avatar-size-${size} ${className}`.trim()}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : uiT("{p0} avatar for {p1}", { p0: uiText(meta.label), p1: name })}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <AnimalFace id={id} />
      </svg>
    </span>
  );
}

export function AvatarPicker({ value, onChange }) {
  const { t: uiT } = useI18n();
  const selected = STUDENT_AVATAR_IDS.includes(value) ? value : "cat";
  return (
    <fieldset className="avatar-picker">
      <legend className="field-label">{uiT("Avatar")}</legend>
      <div className="avatar-options">
        {STUDENT_AVATARS.map((avatar) => (
          <label
            className={selected === avatar.id ? "avatar-option selected" : "avatar-option"}
            key={avatar.id}
            title={uiT(avatar.label)}
          >
            <input
              type="radio"
              name="student-avatar"
              value={avatar.id}
              checked={selected === avatar.id}
              onChange={() => {
                onChange(avatar.id);
                playHibiSound("selection");
              }}
            />
            <StudentAvatar avatarId={avatar.id} name={avatar.label} decorative />
            <span className="sr-only">{uiT(avatar.label)}</span>
            {selected === avatar.id ? (
              <span className="avatar-option-check" aria-hidden="true">
                <Check size={12} strokeWidth={3} />
              </span>
            ) : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
