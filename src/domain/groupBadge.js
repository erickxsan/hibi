import { GROUP_COLOR_IDS, GROUP_ICON_IDS } from "./constants.js";

// Groups without a chosen color get one of the vivid tones; the neutral one is only picked by hand.
const AUTOMATIC_COLORS = GROUP_COLOR_IDS.filter((id) => id !== "kraft");

/**
 * The badge fields a group stores. Only a chosen icon or color is kept: a missing one means
 * «automatic», so groups saved before badges existed are not rewritten.
 */
export function groupBadgeFields(source) {
  return {
    ...(GROUP_ICON_IDS.includes(source?.iconId) ? { iconId: source.iconId } : {}),
    ...(GROUP_COLOR_IDS.includes(source?.colorId) ? { colorId: source.colorId } : {}),
  };
}

/** The group with `badge` applied; an empty `iconId` or `colorId` goes back to automatic. */
export function withGroupBadge(group, badge) {
  const { iconId, colorId, ...rest } = group;
  return { ...rest, ...groupBadgeFields({ iconId, colorId, ...badge }) };
}

function hashOf(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash;
}

/** «IS SA 10 – 12» → «IS», «Diagnóstico 11 Octubre» → «D». */
export function groupInitials(name, locale = undefined) {
  const word = String(name || "")
    .trim()
    .split(/\s+/)[0];
  const letters = Array.from(word);
  return (letters.length <= 2 ? word : letters[0]).toLocaleUpperCase(locale);
}

/** What a group's badge shows: its chosen icon (or none, for initials) and its chosen or automatic color. */
export function groupBadgeOf(group) {
  return {
    iconId: GROUP_ICON_IDS.includes(group?.iconId) ? group.iconId : "",
    colorId: GROUP_COLOR_IDS.includes(group?.colorId)
      ? group.colorId
      : AUTOMATIC_COLORS[hashOf(group?.id || group?.name || "") % AUTOMATIC_COLORS.length],
  };
}
