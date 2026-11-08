// Reads the iPhone calendar. Expo Go only ships the legacy calendar API, so we use that.
import * as Calendar from "expo-calendar/legacy";
import type { CalEvent } from "./logic";

export type CalendarState =
  | { status: "granted"; events: CalEvent[] }
  | { status: "denied" }
  | { status: "error"; message: string };

// Many school and university timetables mark a cancelled class in the title instead of the event status.
const CANCELLED_TITLE = /^\s*(avlyst|avlysning|cancel(l)?ed|innstilt)\b|\b(avlyst|cancel(l)?ed)\s*$/i;
// An all-day event with one of these words means no alarm that day; as a timed event it's just not an appointment.
const OFF_TITLE = /ferie|fridag|\bfri\b|\bsyk|permisjon|avspasering|vacation|holiday|day off/i;
// A timed «Vekk meg» or «Alarm» sets the alarm to that time, also on a day off; no trip.
const WAKE_TITLE = /^\s*(vekk(e|ing|erklokke)?\b|alarm\b|stå opp\b|våkn|wake\b)/i;

export async function requestCalendarAccess(): Promise<boolean> {
  try {
    return (await Calendar.requestCalendarPermissionsAsync()).status === "granted";
  } catch {
    return false;
  }
}

export async function readDay(day: Date): Promise<CalendarState> {
  try {
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (perm.status !== "granted") return { status: "denied" };
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const start = new Date(day);
    start.setHours(4, 0, 0, 0);
    // A week ahead, so the server knows the timetable even if the app isn't opened every day.
    const end = new Date(day);
    end.setDate(end.getDate() + 7);
    const raw = await Calendar.getEventsAsync(calendars.map(c => c.id), start, end);
    // One `off` marker per day an all-day «Ferie» covers, at that day's midnight.
    const off: CalEvent[] = [];
    for (const e of raw.filter(e => e.allDay && OFF_TITLE.test(e.title ?? ""))) {
      const d = new Date(e.startDate);
      d.setHours(0, 0, 0, 0);
      // Some calendars end a one-day event at its own start.
      const until = Math.max(+new Date(e.endDate), d.getTime() + 1);
      for (; +d < until && d < end; d.setDate(d.getDate() + 1))
        if (d.getTime() + 24 * 3600 * 1000 > start.getTime()) off.push({ start: new Date(d), title: e.title, cancelled: false, off: true });
    }
    const wake = (e: Calendar.Event) => WAKE_TITLE.test(e.title ?? "");
    const events = raw
      .filter(e => !e.allDay && !OFF_TITLE.test(e.title ?? "") && (wake(e) || e.availability !== Calendar.Availability.FREE))
      .map(e => ({
        start: new Date(e.startDate),
        title: e.title || "Avtale",
        cancelled: e.status === Calendar.EventStatus.CANCELED || CANCELLED_TITLE.test(e.title ?? ""),
        location: e.location?.trim() || undefined,
        ...(wake(e) ? { wake: true } : {}),
      }))
      .filter(e => e.start >= start);
    return { status: "granted", events: [...off, ...events].sort((a, b) => +a.start - +b.start) };
  } catch (e) {
    return { status: "error", message: String((e as Error).message ?? e) };
  }
}
