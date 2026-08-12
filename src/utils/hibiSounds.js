export const HIBI_SOUND_STORAGE_KEY = "hibi:sounds:v1";

let audioContext;

export function getHibiSoundsEnabled() {
  try {
    return globalThis.localStorage?.getItem(HIBI_SOUND_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHibiSoundsEnabled(enabled) {
  try {
    globalThis.localStorage?.setItem(HIBI_SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Keep the in-memory interaction working when storage is unavailable.
  }
}

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContext) return null;
  try {
    audioContext = new AudioContext();
    return audioContext;
  } catch {
    return null;
  }
}

function scheduleNote(context, start, frequency, duration, volume, wave = "sine") {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function scheduleCue(context, kind) {
  const start = context.currentTime + 0.012;
  const cues = {
    attendance: [
      [0, 659.25, 0.11, 0.026, "sine"],
      [0.075, 783.99, 0.15, 0.022, "sine"],
    ],
    payment: [
      [0, 880, 0.09, 0.022, "triangle"],
      [0.055, 1318.51, 0.17, 0.018, "sine"],
    ],
    selection: [[0, 523.25, 0.1, 0.018, "sine"]],
    success: [
      [0, 523.25, 0.12, 0.022, "sine"],
      [0.085, 659.25, 0.14, 0.022, "sine"],
      [0.17, 783.99, 0.2, 0.018, "sine"],
    ],
  };
  (cues[kind] || cues.success).forEach(([delay, frequency, duration, volume, wave]) => {
    scheduleNote(context, start + delay, frequency, duration, volume, wave);
  });
}

export function primeHibiAudio() {
  if (!getHibiSoundsEnabled()) return false;
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === "suspended") context.resume().catch(() => {});
  return true;
}

export function playHibiSound(kind = "success") {
  if (!getHibiSoundsEnabled()) return false;
  const context = getAudioContext();
  if (!context) return false;
  const play = () => {
    try {
      scheduleCue(context, kind);
    } catch {
      // Audio feedback is optional and must never interrupt the workflow.
    }
  };
  if (context.state === "suspended") {
    context
      .resume()
      .then(play)
      .catch(() => {});
  } else {
    play();
  }
  return true;
}
