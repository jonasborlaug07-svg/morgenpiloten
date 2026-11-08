// The user's trip, timings and whether they have finished the onboarding, saved on the phone.
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_FROM, DEFAULT_TO, type Stop } from "./api";
import type { Settings } from "./logic";

// `from` is home (an address, or a stop for older installs); `to` is the usual destination when the calendar has no place.
export type Prefs = {
  from: Stop;
  to: Stop;
  settings: Settings;
  onboarded: boolean;
  lastWake?: string; // ISO time of the last alarm, for the morning question
  lastFeedbackFor?: string; // which alarm the user already answered about
  feedbackCount?: number; // how many mornings the user has answered; the question stops after a few
  awayDismissedUntil?: string; // the user said "start from home" tonight; don't ask again before this
};

export const DEFAULT_PREFS: Prefs = {
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  settings: { routine: 40, walk: 0, margin: 10, snowExtra: 5 },
  onboarded: false,
};

// After the alarm has rung, ask how the morning went and nudge the routine time.
// Only the first few mornings: after that the routine has settled and the app stops asking.
export const ROUTINE_STEP = 5;
export const FEEDBACK_MORNINGS = 3;
export function shouldAskFeedback(p: Prefs, now = new Date()): boolean {
  if (!p.lastWake || p.lastFeedbackFor === p.lastWake || (p.feedbackCount ?? 0) >= FEEDBACK_MORNINGS) return false;
  const since = now.getTime() - new Date(p.lastWake).getTime();
  return since > 0 && since < 14 * 3600 * 1000;
}
const PREFS_KEY = "morgenpiloten.prefs.v2";
const OLD_KEY = "morgenpiloten.prefs.v1";

// v1 had fixed times and a "day off" button (the calendar decides that now) and woke 15 min early for snow (now 5).
function fromV1(raw: string): Prefs {
  const p = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  const { schedule, skipDate, onlyWithEvents, ...settings } = p.settings;
  return { ...p, settings: { ...settings, snowExtra: DEFAULT_PREFS.settings.snowExtra } };
}

async function readPrefs(): Promise<Prefs | null> {
  const raw = await AsyncStorage.getItem(PREFS_KEY);
  if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  const old = await AsyncStorage.getItem(OLD_KEY);
  return old ? fromV1(old) : null;
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    return (await readPrefs()) ?? DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    readPrefs()
      .then(p => p && setPrefs(p))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
  }, [prefs, loaded]);

  return { prefs, setPrefs, loaded };
}
