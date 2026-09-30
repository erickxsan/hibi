const MARGIN = 16;
const GAP = 12;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

// Keep the target and its one instruction card together, including at browser zoom.
export function tourLayout(rect, viewport, measuredHeight = 256) {
  const width = Math.min(420, viewport.width - MARGIN * 2);
  const height = Math.min(measuredHeight, viewport.height - MARGIN * 2);
  if (!rect) {
    return {
      left: (viewport.width - width) / 2,
      top: Math.max(MARGIN, (viewport.height - height) / 2),
      width,
      side: "none",
      pointer: width / 2,
      highlight: null,
    };
  }
  const target = {
    left: clamp(rect.left - 4, 4, viewport.width - 4),
    top: clamp(rect.top - 4, 4, viewport.height - 4),
    right: clamp(rect.right + 4, 4, viewport.width - 4),
    bottom: clamp(rect.bottom + 4, 4, viewport.height - 4),
  };
  const center = (target.left + target.right) / 2;
  let left = clamp(center - width / 2, MARGIN, viewport.width - width - MARGIN);
  let top;
  let side;
  if (target.bottom + GAP + height <= viewport.height - MARGIN) {
    top = target.bottom + GAP;
    side = "top";
  } else if (target.top - GAP - height >= MARGIN) {
    top = target.top - GAP - height;
    side = "bottom";
  } else if (target.right + GAP + width <= viewport.width - MARGIN) {
    left = target.right + GAP;
    top = clamp(target.top, MARGIN, viewport.height - height - MARGIN);
    side = "left";
  } else if (target.left - GAP - width >= MARGIN) {
    left = target.left - GAP - width;
    top = clamp(target.top, MARGIN, viewport.height - height - MARGIN);
    side = "right";
  } else {
    // Long tables cannot fit beside a card on a phone. Highlight the visible
    // upper portion and dock the same card below, keeping its header readable.
    top = Math.max(MARGIN, viewport.height - height - MARGIN);
    target.bottom = Math.min(target.bottom, top - GAP);
    side = "top";
  }
  const highlight =
    target.bottom > target.top && target.right > target.left
      ? { left: target.left, top: target.top, width: target.right - target.left, height: target.bottom - target.top }
      : null;
  if (!highlight) side = "none";
  const pointer =
    side === "left" || side === "right"
      ? clamp((target.top + target.bottom) / 2 - top, 24, height - 24)
      : clamp(center - left, 24, width - 24);
  return { left, top, width, side, pointer, highlight };
}
