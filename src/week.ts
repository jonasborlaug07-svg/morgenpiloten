// Plans the coming week, so alarms are set for every morning even if the app isn't opened.
import { fetchWeather, type Place } from "./api";
import { readDay } from "./calendar";
import { placeEvents } from "./places";
import { planDay } from "./plan";
import { at, dayAfter, decide, startPoint, targetDay, type CalEvent, type Decision } from "./logic";
import type { Prefs } from "./prefs";

const DAY_MS = 24 * 3600 * 1000;
const NO_SCEN = { cancel: false, delay: false, snow: false, lecture: false };

export type PlannedMorning = { day: Date; decision: Decision; destination: Place };

export const whyText = (d: Decision) => d.reasons.map(r => r.title).join(" · ");

// The next 7 mornings, from the coming one. Also returns the calendar it used.
export async function planWeek(prefs: Prefs): Promise<{ mornings: PlannedMorning[]; events: CalEvent[] }> {
  const first = targetDay();
  const cal = await readDay(first);
  const events = cal.status === "granted" ? await placeEvents(cal.events, prefs.from) : [];
  const mornings: PlannedMorning[] = [];
  for (let i = 0; i < 7; i++) {
    const day = dayAfter(first, i);
    const dayEvents = events.filter(e => e.start >= day && e.start.getTime() < day.getTime() + DAY_MS);
    const home = startPoint(prefs.from, prefs.settings, at(day, "05:00"));
    const plan = await planDay({ home, fallbackTo: prefs.to, day, events: dayEvents, settings: prefs.settings, lectureDemo: false });
    // Snow is checked for every morning. MET's forecast covers the week in one (cached) call,
    // and each refresh fetches it again, so the alarm follows the forecast as it firms up.
    const weather = await fetchWeather(home).catch(() => null);
    const decision = decide({
      day, settings: prefs.settings, events: dayEvents, scen: NO_SCEN,
      fromName: home.name, toName: plan.destination.name,
      patterns: plan.patterns, patternsLater: plan.patternsLater, weather,
    });
    mornings.push({ day, decision, destination: plan.destination });
  }
  return { mornings, events };
}
