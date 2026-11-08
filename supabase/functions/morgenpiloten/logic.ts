// Pure wake-up logic, shared with the web prototype. No React Native imports here.

export type Pattern = {
  aimedStart: Date;
  expStart: Date;
  aimedEnd: Date;
  expEnd: Date;
  lines: string;
  cancelled: boolean;
  realtime: boolean;
};

// A point on the map; same shape as Place in api.ts.
export type Spot = { id: string; name: string; label: string; lat: number; lon: number };

// `place` is the event's location already looked up on the phone, so the server can skip it.
// `off` marks a day the calendar says the user is off (an all-day «Fri», «Ferie» or «Syk»); `start` is that day's midnight.
// `wake` is a «Vekk meg» the user put in the calendar: the alarm rings then at the latest, also on a day off.
export type CalEvent = { start: Date; title: string; cancelled: boolean; location?: string; place?: Spot; off?: boolean; wake?: boolean };

export type Settings = {
  routine: number; // minutes from wake-up to leaving home
  walk: number; // minutes from home to the stop; 0 when trips start at the home address (Entur adds the walk)
  margin: number; // minutes early for the first appointment
  snowExtra: number; // extra minutes when snow is expected
  away?: { place: Spot; until: string }; // sleeping somewhere else tonight: start the trip there until `until`
  workHolidays?: boolean; // alarm on Norwegian public holidays too (off by default)
};

// Where tomorrow's trip starts: tonight's place while it is valid, otherwise home.
export const startPoint = (home: Spot, settings: Settings, now = new Date()): Spot =>
  settings.away && now < new Date(settings.away.until) ? settings.away.place : home;

export type Scenario = { cancel: boolean; delay: boolean; snow: boolean; lecture: boolean };

export type WeatherPoint = { time: Date; temp: number; precip: number };

export type Reason = { time: string; title: string; detail: string; tag: string; tone: "bad" | "good" | "info" | "neutral" };

export type Decision = {
  // "free": no alarm on purpose; "asked": no trip, but a «Vekk meg» in the calendar; "noRoute": Entur found no way there in time.
  status: "ok" | "free" | "asked" | "noRoute";
  wake: Date | null;
  baselineWake: Date | null;
  pick: Pattern | null;
  patterns: Pattern[];
  deadline: Deadline;
  reasons: Reason[];
};

export type Deadline = { time: Date; event: { title: string; start: Date; location?: string; place?: Spot }; fallback: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
export const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60000);
export const diffMin = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 60000);

// All wall-clock times are Norwegian, also when this runs on the server in UTC.
const TZ = "Europe/Oslo";
const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
// Hermes on iOS lacks formatToParts; a phone in Norway is already on Oslo time, so its local clock is right there.
const hasParts = typeof fmt.formatToParts === "function";
function oslo(d: Date) {
  if (!hasParts) return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(d)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute };
}
function osloMidnight(y: number, mo: number, d: number): Date {
  const guess = Date.UTC(y, mo - 1, d);
  const o = oslo(new Date(guess));
  const offsetMin = Math.round((Date.UTC(o.y, o.mo - 1, o.d, o.h, o.mi) - guess) / 60000);
  return new Date(guess - offsetMin * 60000);
}
const weekday = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

export const hm = (d: Date) => {
  const o = oslo(d);
  return pad(o.h) + ":" + pad(o.mi);
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_MS = 24 * 3600 * 1000;

// The coming morning: today until noon, otherwise tomorrow (or the next of `days`).
export function targetDay(now = new Date(), days: number[] = ALL_DAYS): Date {
  const o = oslo(now);
  let { y, mo, d } = o;
  if (days.includes(weekday(y, mo, d)) && o.h < 12) return osloMidnight(y, mo, d);
  do {
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    y = next.getUTCFullYear(); mo = next.getUTCMonth() + 1; d = next.getUTCDate();
  } while (!days.includes(weekday(y, mo, d)));
  return osloMidnight(y, mo, d);
}

// Norwegian calendar date and weekday of a moment, e.g. "2026-11-09" and 1 (Monday).
export const osloDate = (d: Date) => {
  const o = oslo(d);
  return `${o.y}-${pad(o.mo)}-${pad(o.d)}`;
};
export const osloWeekday = (d: Date) => {
  const o = oslo(d);
  return weekday(o.y, o.mo, o.d);
};

// Easter Sunday (Meeus/Jones/Butcher), as [month, day].
function easter(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return [month, ((h + l - 7 * m + 114) % 31) + 1];
}

// The Norwegian public holiday on this day ("17. mai"), or null.
export function holidayName(day: Date): string | null {
  const o = oslo(day);
  const fixed: Record<string, string> = {
    "1-1": "Nyttårsdag", "5-1": "Arbeidernes dag", "5-17": "17. mai", "12-25": "1. juledag", "12-26": "2. juledag",
  };
  if (fixed[`${o.mo}-${o.d}`]) return fixed[`${o.mo}-${o.d}`];
  const [em, ed] = easter(o.y);
  const offset = Math.round((Date.UTC(o.y, o.mo - 1, o.d) - Date.UTC(o.y, em - 1, ed)) / 86400000);
  const moving: Record<number, string> = {
    [-3]: "Skjærtorsdag", [-2]: "Langfredag", 0: "1. påskedag", 1: "2. påskedag",
    39: "Kristi himmelfartsdag", 49: "1. pinsedag", 50: "2. pinsedag",
  };
  return moving[offset] ?? null;
}

// Midnight in Norway `n` days after `day` (a few hours in, so summer time can't shift the date).
export const dayAfter = (day: Date, n: number) => targetDay(new Date(day.getTime() + n * DAY_MS + 3 * 3600 * 1000));

export function at(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return addMin(day, h * 60 + m);
}

const FALLBACK_FIRST = "08:15";
// Only appointments before noon decide when you have to leave in the morning.
const MORNING_ENDS = "12:00";

const inMorning = (day: Date, e: CalEvent) => e.start >= day && e.start < at(day, MORNING_ENDS);

export const morningEvents = (day: Date, events: CalEvent[]) =>
  events.filter(e => !e.off && !e.wake && inMorning(day, e)).sort((a, b) => +a.start - +b.start);

// The earliest «Vekk meg» this morning, if any.
export const wakeEvent = (day: Date, events: CalEvent[]): CalEvent | undefined =>
  events.filter(e => e.wake && !e.cancelled && inMorning(day, e)).sort((a, b) => +a.start - +b.start)[0];

// The all-day «Fri»/«Ferie» event that covers this day, if any.
export const offDay = (day: Date, events: CalEvent[]) => events.find(e => e.off && osloDate(e.start) === osloDate(day));

export function deadlineFor(day: Date, events: CalEvent[], margin: number, lectureCancelled: boolean): Deadline {
  const list = morningEvents(day, events)
    .map((e, i) => ({ ...e, cancelled: e.cancelled || (lectureCancelled && i === 0) }))
    .filter(e => !e.cancelled)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const first = list[0];
  if (!first) return { time: addMin(at(day, FALLBACK_FIRST), -margin), event: { title: "Første avtale", start: at(day, FALLBACK_FIRST) }, fallback: true };
  return { time: addMin(first.start, -margin), event: first, fallback: false };
}

// `base` is the deadline as if nothing were cancelled (the normal alarm); `now` honours cancellations.
export function deadlines(day: Date, events: CalEvent[], settings: Settings, lectureDemo: boolean) {
  return {
    base: deadlineFor(day, events.map(e => ({ ...e, cancelled: false })), settings.margin, false),
    now: deadlineFor(day, events, settings.margin, lectureDemo),
  };
}

// No trip this morning: the calendar says the user is off, it's a public holiday, or nothing is on before noon.
export const isFreeMorning = (day: Date, now: Deadline, settings: Settings, events: CalEvent[]) =>
  !!offDay(day, events) || (!settings.workHolidays && holidayName(day) !== null) || now.fallback;

// No alarm at all: a free morning without a «Vekk meg».
const isQuietMorning = (day: Date, now: Deadline, settings: Settings, events: CalEvent[]) =>
  isFreeMorning(day, now, settings, events) && !wakeEvent(day, events);

// The next morning with an alarm: the first of the coming 7 days with an appointment or a «Vekk meg» before noon.
// When the whole week is free, the coming morning.
export function nextMorning(events: CalEvent[], settings: Settings, now = new Date()): Date {
  const first = targetDay(now);
  for (let i = 0; i < 7; i++) {
    const day = dayAfter(first, i);
    if (!isQuietMorning(day, deadlines(day, events, settings, false).now, settings, events)) return day;
  }
  return first;
}

// A delay can shrink before the train leaves, so only half of it, and at most this much, becomes extra sleep.
// You still make the train as long as it doesn't catch up more than half the delay.
const MAX_EXTRA_SLEEP = 10;
export function extraSleep(p: Pattern): number {
  const late = diffMin(p.expStart, p.aimedStart);
  return late > 0 ? Math.min(MAX_EXTRA_SLEEP, Math.floor(late / 2)) : 0;
}

// Example timetable used when the network is unreachable: a train every 10 minutes, 10 min ride.
export function samplePatterns(deadline: Date): Pattern[] {
  const out: Pattern[] = [];
  for (let i = 0; i < 6; i++) {
    const end = addMin(deadline, -4 - i * 10);
    const start = addMin(end, -10);
    out.push({ aimedStart: start, expStart: start, aimedEnd: end, expEnd: end, lines: i % 2 ? "R13" : "RE10", cancelled: false, realtime: false });
  }
  return out;
}

// Snow (mm water) expected between 22:00 the night before and `until`, counting hours at or below +0.5 °C.
export function snowMm(series: WeatherPoint[] | null, day: Date, until: Date): number {
  if (!series) return 0;
  const from = addMin(day, -120);
  let mm = 0;
  for (const s of series) {
    if (s.time < from || s.time >= until) continue;
    if (s.temp <= 0.5) mm += s.precip;
  }
  return Math.round(mm * 10) / 10;
}

export type DecideInput = {
  day: Date;
  settings: Settings;
  events: CalEvent[];
  scen: Scenario;
  fromName: string;
  toName: string;
  // Live patterns for the normal deadline and for the deadline after a cancelled first lecture; null = offline.
  patterns: Pattern[] | null;
  patternsLater: Pattern[] | null;
  weather: WeatherPoint[] | null;
};

export function decide(inp: DecideInput): Decision {
  const { day, settings, events, scen } = inp;
  const reasons: Reason[] = [];
  const { base, now } = deadlines(day, events, settings, scen.lecture);
  const usingLater = now.time.getTime() > base.time.getTime();
  const live = inp.patterns != null;

  // A «Vekk meg» in the calendar rings even on a day off; otherwise a free morning has no alarm.
  const asked = wakeEvent(day, events);
  const free = (reason: Reason): Decision =>
    asked
      ? {
          status: "asked", wake: asked.start, baselineWake: null, pick: null, patterns: [], deadline: now,
          reasons: [{
            time: hm(asked.start), title: `Vekking kl. ${hm(asked.start)}`,
            detail: `Du har fri, men ba om å bli vekket kl. ${hm(asked.start)} i kalenderen.`, tag: "Kalender", tone: "info",
          }],
        }
      : { status: "free", wake: null, baselineWake: null, pick: null, patterns: [], deadline: now, reasons: [reason] };

  const off = offDay(day, events);
  if (off) return free({ time: "", title: "Fri i kalenderen", detail: `«${off.title}» står i kalenderen, så alarmen er slått av.`, tag: "Fri", tone: "good" });

  const holiday = settings.workHolidays ? null : holidayName(day);
  if (holiday) return free({ time: "", title: `${holiday}: ingen alarm`, detail: "Det er helligdag, så alarmen er slått av.", tag: "Helligdag", tone: "good" });

  // Nothing before noon: let them sleep.
  if (now.fallback) {
    const cancelled = !base.fallback;
    return free({
      time: cancelled ? hm(base.event.start) : "",
      title: cancelled ? `${base.event.title} er avlyst` : "Ingen avtaler før kl. 12",
      detail: cancelled ? "Du har ikke noe mer før kl. 12, så alarmen er slått av. Sov godt." : "Ingen alarm denne morgenen. Sov godt.",
      tag: "Fri", tone: "good",
    });
  }

  const raw = live ? (usingLater ? inp.patternsLater ?? inp.patterns! : inp.patterns!) : samplePatterns(now.time);
  const baseRaw = live ? inp.patterns! : samplePatterns(base.time);
  const patterns = raw.map(p => ({ ...p }));
  const fixed = settings.routine + settings.walk;

  // Planned: what you'd set the alarm to from the timetable alone.
  const plannedPick = baseRaw.filter(p => p.aimedEnd <= base.time).sort((a, b) => +b.aimedStart - +a.aimedStart)[0];
  const baselineWake = plannedPick ? addMin(plannedPick.aimedStart, -fixed) : null;

  // Apply demo events to the departure you would normally take.
  const target = patterns.filter(p => p.aimedEnd <= now.time).sort((a, b) => +b.aimedStart - +a.aimedStart)[0];
  if (target && scen.cancel) target.cancelled = true;
  // Demo delay: as late as the train can run and still get you there in time.
  if (target && scen.delay && !scen.cancel) {
    const late = Math.max(3, diffMin(now.time, target.expEnd));
    target.expStart = addMin(target.expStart, late);
    target.expEnd = addMin(target.expEnd, late);
  }

  // Pick the latest departure that still arrives in time, using live estimates.
  let pick: Pattern | null =
    patterns.filter(p => !p.cancelled && p.expEnd <= now.time).sort((a, b) => +b.expStart - +a.expStart)[0] ?? null;
  // A late train can still be the best choice if nothing earlier works.
  if (!pick) pick = patterns.filter(p => !p.cancelled).sort((a, b) => +a.expEnd - +b.expEnd)[0] ?? null;

  if (usingLater) {
    const first = morningEvents(day, events)[0];
    reasons.push({
      time: first ? hm(first.start) : "",
      title: `${first?.title ?? "Første time"} er avlyst`,
      detail: `Første avtale er nå ${now.event.title} kl. ${hm(now.event.start)}.`,
      tag: "Kalender",
      tone: "info",
    });
  }

  if (target?.cancelled) {
    reasons.push({
      time: hm(target.aimedStart),
      title: `${target.lines} fra ${inp.fromName} er innstilt`,
      detail: pick ? `Ny rute: ${pick.lines} kl. ${hm(pick.expStart)}.` : "Fant ingen annen avgang.",
      tag: "Innstilt",
      tone: "bad",
    });
  } else if (target && diffMin(target.expStart, target.aimedStart) > 0) {
    const late = diffMin(target.expStart, target.aimedStart);
    reasons.push({
      time: hm(target.aimedStart),
      title: `${target.lines} er ${late} min forsinket`,
      detail:
        target !== pick
          ? `Den rekker ikke frem i tide, så du tar ${pick?.lines} kl. ${pick ? hm(pick.expStart) : "?"}.`
          : extraSleep(target) > 0
            ? `Du kan sove ${extraSleep(target)} min lenger: halve forsinkelsen, maks ${MAX_EXTRA_SLEEP} min, i tilfelle toget tar inn tid.`
            : "Du står opp som vanlig, i tilfelle toget tar inn tid.",
      tag: "Forsinket",
      tone: "good",
    });
  }

  if (!pick) {
    return {
      status: "noRoute", wake: asked?.start ?? null, baselineWake, pick: null, patterns, deadline: now,
      reasons: [{
        time: hm(now.event.start),
        title: `Fant ingen reise til ${inp.toName}`,
        detail: `Entur finner ingen buss eller tog fra ${inp.fromName} som rekker ${now.event.title} kl. ${hm(now.event.start)}. Sjekk hjem og reisemål.`,
        tag: "Ingen reise", tone: "bad",
      }],
    };
  }

  // Early trains count in full; a delay only partly (see extraSleep).
  const leave = pick.expStart < pick.aimedStart ? pick.expStart : addMin(pick.aimedStart, extraSleep(pick));
  let wake: Date | null = addMin(leave, -fixed);

  const measured = snowMm(inp.weather, day, wake ?? now.time);
  const snow = scen.snow ? Math.max(4, measured) : measured;
  if (snow >= 2 && wake) {
    wake = addMin(wake, -settings.snowExtra);
    reasons.push({
      time: "i natt",
      title: `Ventet ${snow} mm nedbør som snø`,
      detail: `Vekker ${settings.snowExtra} min før, så du har bedre tid i snøen.`,
      tag: "Snø",
      tone: "info",
    });
  }

  if (pick) {
    reasons.push({
      time: hm(pick.expStart),
      title: `${pick.lines}, ${inp.fromName} → ${inp.toName}`,
      detail: `${settings.walk ? `${settings.walk} min gange og ` : ""}${settings.routine} min morgenrutine før du går. Fremme ${hm(pick.expEnd)}${
        pick.expEnd > now.time ? `, for sent til ${now.event.title}` : ""
      }.`,
      tag: pick.realtime ? "Sanntid" : "Ruteplan",
      tone: pick.realtime ? "good" : "neutral",
    });
  }

  if (reasons.length <= 1) {
    reasons.unshift({ time: "nå", title: "Ingen avvik på reisen din", detail: "Alarmen står på vanlig tid.", tag: "Alt normalt", tone: "good" });
  }

  // Asked in the calendar to be woken earlier than the trip needs: that wins.
  if (asked && asked.start < wake) {
    reasons.push({
      time: hm(asked.start), title: `Vekking kl. ${hm(asked.start)}`,
      detail: `Du ba om å bli vekket i kalenderen. Reisen alene hadde gitt ${hm(wake)}.`, tag: "Kalender", tone: "info",
    });
    wake = asked.start;
  }

  return { status: "ok", wake, baselineWake, pick, patterns, deadline: now, reasons };
}
