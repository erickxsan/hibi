import { useId, useRef, useState } from "react";
import {
  Atom,
  BookOpen,
  Brain,
  Calculator,
  Check,
  ClipboardCheck,
  FlaskConical,
  Globe,
  GraduationCap,
  Languages,
  Music,
  Palette,
  PencilLine,
  Puzzle,
  Shapes,
  Sprout,
  Star,
  Sun,
} from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { GROUP_COLOR_IDS, GROUP_ICON_IDS } from "../domain/constants";
import { groupBadgeOf, groupInitials } from "../domain/groupBadge";
import { playHibiSound } from "../utils/hibiSounds";
import { PickerPopover } from "./PickerPopover";

const GROUP_ICONS = Object.freeze({
  book: { icon: BookOpen, label: "Book" },
  pencil: { icon: PencilLine, label: "Pencil" },
  calculator: { icon: Calculator, label: "Calculator" },
  shapes: { icon: Shapes, label: "Shapes" },
  flask: { icon: FlaskConical, label: "Flask" },
  atom: { icon: Atom, label: "Atom" },
  globe: { icon: Globe, label: "Globe" },
  languages: { icon: Languages, label: "Languages" },
  music: { icon: Music, label: "Music" },
  palette: { icon: Palette, label: "Palette" },
  brain: { icon: Brain, label: "Brain" },
  puzzle: { icon: Puzzle, label: "Puzzle" },
  star: { icon: Star, label: "Star" },
  sun: { icon: Sun, label: "Sunshine" },
  sprout: { icon: Sprout, label: "Sprout" },
  graduation: { icon: GraduationCap, label: "Graduation cap" },
  checklist: { icon: ClipboardCheck, label: "Checklist" },
});

const COLOR_LABELS = Object.freeze({
  bermellon: "Vermilion",
  ocre: "Ochre",
  jade: "Jade",
  indigo: "Indigo",
  kraft: "Neutral",
});

/** A group's stamp: its icon, or its initials, on its color. Always decorative: the group name sits next to it. */
export function GroupBadge({ group, size = "small", className = "" }) {
  const { locale } = useI18n();
  const { iconId, colorId } = groupBadgeOf(group);
  const Icon = GROUP_ICONS[iconId]?.icon;
  return (
    <span className={`group-badge group-tone-${colorId} group-badge-${size} ${className}`.trim()} aria-hidden="true">
      {Icon ? <Icon /> : <span className="group-badge-initials">{groupInitials(group?.name, locale)}</span>}
    </span>
  );
}

/** The group header's stamp: opens a picker that saves the color and icon as soon as they are chosen. */
export function GroupBadgePicker({ group, onChange, size = "large" }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const name = useId();
  const current = groupBadgeOf(group);
  const choose = (badge) => {
    onChange(badge);
    playHibiSound("selection");
  };
  return (
    <span className="group-badge-picker-wrap">
      <button
        type="button"
        ref={triggerRef}
        className="group-badge-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("Change the icon of {name}", { name: group.name })}
        onClick={() => setOpen(!open)}
      >
        <GroupBadge group={group} size={size} />
        <span className="group-badge-edit" aria-hidden="true">
          <PencilLine />
        </span>
      </button>
      <PickerPopover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        title={t("Group icon")}
        className="group-badge-menu"
      >
        <fieldset className="group-badge-colors">
          <legend>{t("Color")}</legend>
          <div className="group-badge-options">
            {GROUP_COLOR_IDS.map((colorId) => (
              <label
                key={colorId}
                className={`group-color-option group-tone-${colorId} ${current.colorId === colorId ? "selected" : ""}`}
                title={t(COLOR_LABELS[colorId])}
              >
                <input
                  type="radio"
                  name={`${name}-color`}
                  value={colorId}
                  checked={current.colorId === colorId}
                  aria-label={t(COLOR_LABELS[colorId])}
                  onChange={() => choose({ colorId })}
                />
                <span className="group-color-swatch" aria-hidden="true">
                  {current.colorId === colorId ? <Check /> : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="group-badge-icons">
          <legend>{t("Icon")}</legend>
          <div className="group-badge-options">
            <label
              className={`group-icon-option group-tone-${current.colorId} ${current.iconId ? "" : "selected"}`}
              title={t("Initials")}
            >
              <input
                type="radio"
                name={`${name}-icon`}
                value=""
                checked={!current.iconId}
                aria-label={t("Initials")}
                onChange={() => choose({ iconId: "" })}
              />
              <span className="group-badge-initials">{groupInitials(group.name, locale)}</span>
            </label>
            {GROUP_ICON_IDS.map((iconId) => {
              const { icon: Icon, label } = GROUP_ICONS[iconId];
              return (
                <label
                  key={iconId}
                  className={`group-icon-option group-tone-${current.colorId} ${current.iconId === iconId ? "selected" : ""}`}
                  title={t(label)}
                >
                  <input
                    type="radio"
                    name={`${name}-icon`}
                    value={iconId}
                    checked={current.iconId === iconId}
                    aria-label={t(label)}
                    onChange={() => choose({ iconId })}
                  />
                  <Icon aria-hidden="true" />
                </label>
              );
            })}
          </div>
        </fieldset>
      </PickerPopover>
    </span>
  );
}
