// Morgenpiloten server. Watches each saved trip overnight and answers "when should I wake up?".
// logic.ts and api.ts are copies of ../../../src/ (with .ts import suffixes) so the phone and server decide the same way.
//
// Routes (all under /functions/v1/morgenpiloten):
//   POST /sync          body {id?, from, to, settings, events, scenario} -> {id, ...decision}   (called by the app)
//   GET  /wake?id=...   -> "06:54" as plain text; add &format=json for details             (called by iOS Shortcuts)
//   POST /check-all     header x-cron-secret -> recomputes every trip                       (called by pg_cron)
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decide, hm, nextMorning, startPoint, type CalEvent, type Scenario, type Settings, type Spot } from "./logic.ts";
import { fetchWeather, type Stop } from "./api.ts";
import { planDay } from "./plan.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type TripRow = {
  id: string;
  from_stop: Stop;
  to_stop: Stop;
  settings: Settings;
  events: { start: string; title: string; cancelled: boolean; location?: string; place?: Spot; off?: boolean; wake?: boolean }[];
  scenario: Partial<Scenario>;
};

const NO_SCEN: Scenario = { cancel: false, delay: false, snow: false, lecture: false };
const DAY_MS = 24 * 3600 * 1000;

async function compute(trip: TripRow) {
  // The next morning with something in the calendar, like the app.
  const week: CalEvent[] = trip.events.map(e => ({
    start: new Date(e.start), title: e.title, cancelled: e.cancelled, location: e.location, place: e.place, off: e.off, wake: e.wake,
  }));
  const day = nextMorning(week, trip.settings);
  const scen = { ...NO_SCEN, ...trip.scenario };
  const events = week.filter(e => e.start >= day && e.start.getTime() < day.getTime() + DAY_MS);
  // From home (or tonight's place) to wherever the first appointment is, or the usual destination.
  const home = startPoint(trip.from_stop, trip.settings);
  const plan = await planDay({ home, fallbackTo: trip.to_stop, day, events, settings: trip.settings, lectureDemo: scen.lecture });
  const { patterns, patternsLater } = plan;
  const weather = await fetchWeather(home).catch(() => null);

  const d = decide({
    day, settings: trip.settings, events, scen,
    fromName: home.name, toName: plan.destination.name,
    patterns, patternsLater, weather,
  });

  await db.from("checks").insert({
    trip_id: trip.id,
    day: hmDate(day),
    wake: d.wake?.toISOString() ?? null,
    baseline: d.baselineWake?.toISOString() ?? null,
    live: patterns != null,
    reasons: d.reasons,
  });

  return {
    day: hmDate(day),
    status: d.status,
    wake: d.wake ? hm(d.wake) : null,
    baseline: d.baselineWake ? hm(d.baselineWake) : null,
    departure: d.pick ? hm(d.pick.expStart) : null,
    arrival: d.pick ? hm(d.pick.expEnd) : null,
    destination: plan.destination.label,
    live: patterns != null,
    reasons: d.reasons,
  };
}

// Calendar date in Norway, e.g. "2026-11-09".
function hmDate(d: Date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(d);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async req => {
  const url = new URL(req.url);
  const route = url.pathname.split("/").pop();

  try {
    if (route === "sync" && req.method === "POST") {
      const b = await req.json();
      if (!b.from?.id || !b.to?.id || !b.settings) return json({ error: "from, to og settings mangler" }, 400);
      const row = {
        from_stop: b.from,
        to_stop: b.to,
        settings: b.settings,
        events: Array.isArray(b.events) ? b.events.slice(0, 200) : [],
        scenario: b.scenario ?? {},
        updated_at: new Date().toISOString(),
      };
      let trip: TripRow | null = null;
      if (typeof b.id === "string" && UUID.test(b.id)) {
        const { data } = await db.from("trips").update(row).eq("id", b.id).select().maybeSingle();
        trip = data;
      }
      if (!trip) {
        const { data, error } = await db.from("trips").insert(row).select().single();
        if (error) throw error;
        trip = data;
      }
      return json({ id: trip!.id, ...(await compute(trip!)) });
    }

    if (route === "wake" && req.method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      if (!UUID.test(id)) return text("Ugyldig id", 400);
      const { data: trip } = await db.from("trips").select().eq("id", id).maybeSingle();
      if (!trip) return text("Fant ikke reisen. Åpne Morgenpiloten-appen én gang.", 404);
      const r = await compute(trip);
      return url.searchParams.get("format") === "json" ? json(r) : text(r.wake ?? "");
    }

    if (route === "check-all" && req.method === "POST") {
      const { data: cfg } = await db.from("app_config").select("value").eq("key", "cron_secret").single();
      if (!cfg || req.headers.get("x-cron-secret") !== cfg.value) return text("Ingen tilgang", 401);
      // Only trips the app has touched in the last two weeks.
      const since = new Date(Date.now() - 14 * DAY_MS).toISOString();
      const { data: trips } = await db.from("trips").select().gte("updated_at", since).limit(200);
      const results = [];
      for (const t of trips ?? []) results.push({ id: t.id, wake: (await compute(t)).wake });
      return json({ checked: results.length, results });
    }

    return text("Ukjent adresse", 404);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
