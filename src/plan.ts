// Fetches the trips for one morning: from home to where the first appointment is, falling back to the usual destination.
// Shared by the app and the server.
import { fetchTrips, resolveLocation, type Place } from "./api";
import { deadlines, isFreeMorning, type CalEvent, type Deadline, type Pattern, type Settings } from "./logic";

async function destinationFor(d: Deadline, fallback: Place, home: Place): Promise<{ place: Place; fromCalendar: boolean }> {
  // The phone has usually looked the place up already (with Apple Maps); only fall back to Entur here.
  const hit = d.event.place ?? (d.event.location ? await resolveLocation(d.event.location, home) : null);
  return hit ? { place: hit, fromCalendar: true } : { place: fallback, fromCalendar: false };
}

export type DayPlan = {
  patterns: Pattern[] | null; // null = Entur unreachable
  patternsLater: Pattern[] | null;
  destination: Place;
  fromCalendar: boolean;
};

export async function planDay(inp: {
  home: Place;
  fallbackTo: Place;
  day: Date;
  events: CalEvent[];
  settings: Settings;
  lectureDemo: boolean;
}): Promise<DayPlan> {
  const { base, now } = deadlines(inp.day, inp.events, inp.settings, inp.lectureDemo);
  // A free morning needs no trip at all.
  if (isFreeMorning(inp.day, now, inp.settings, inp.events))
    return { patterns: [], patternsLater: [], destination: inp.fallbackTo, fromCalendar: false };
  const destBase = await destinationFor(base, inp.fallbackTo, inp.home);
  const destNow = now.event === base.event ? destBase : await destinationFor(now, inp.fallbackTo, inp.home);
  const patterns = await fetchTrips(inp.home, destBase.place, base.time).catch(() => null);
  const same = +now.time === +base.time && destNow.place.id === destBase.place.id;
  const patternsLater = same ? patterns : await fetchTrips(inp.home, destNow.place, now.time).catch(() => null);
  return { patterns, patternsLater, destination: destNow.place, fromCalendar: destNow.fromCalendar };
}
