import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { distanceKm, fetchWeather, reversePlace, type Place } from "./src/api";
import { readDay, type CalendarState } from "./src/calendar";
import { ensurePermission, ringNow, scheduleAlarms } from "./src/alarm";
import { registerBackgroundRefresh } from "./src/background";
import { planWeek, whyText, type PlannedMorning } from "./src/week";
import { syncTrip } from "./src/server";
import { addMin, at, dayAfter, decide, diffMin, hm, nextMorning, osloWeekday, startPoint, targetDay, type CalEvent, type Pattern, type Reason, type Scenario, type Settings, type WeatherPoint } from "./src/logic";
import { FEEDBACK_MORNINGS, ROUTINE_STEP, shouldAskFeedback, usePrefs, type Prefs } from "./src/prefs";
import { planDay } from "./src/plan";
import { placeEvents, suggestDestinations } from "./src/places";
import { quietPosition } from "./src/location";
import { Onboarding } from "./src/Onboarding";
import { Button, C, HomePicker, PlacePicker, s, Section, Stepper, Toggle, TONE } from "./src/ui";

export default function App() {
  const { prefs, setPrefs, loaded } = usePrefs();
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {!loaded ? (
        <View style={s.root} />
      ) : prefs.onboarded ? (
        <Main prefs={prefs} setPrefs={setPrefs} />
      ) : (
        <Onboarding prefs={prefs} onDone={setPrefs} />
      )}
    </SafeAreaProvider>
  );
}

function Main({ prefs, setPrefs }: { prefs: Prefs; setPrefs: React.Dispatch<React.SetStateAction<Prefs>> }) {
  const [cal, setCal] = useState<CalendarState | null>(null);
  const [scen, setScen] = useState<Scenario>({ cancel: false, delay: false, snow: false, lecture: false });
  const [trips, setTrips] = useState<{ base: Pattern[]; later: Pattern[] } | null>(null);
  const [weather, setWeather] = useState<WeatherPoint[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifOk, setNotifOk] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [dest, setDest] = useState<{ place: Place; fromCalendar: boolean } | null>(null);
  const [forceFeedback, setForceFeedback] = useState(false);
  const [showTrips, setShowTrips] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [awayAuto, setAwayAuto] = useState(false);
  const [demoEvent, setDemoEvent] = useState(false);
  // Any demo switch on: the screen shows the demo, but the real alarms stay as the calendar and Entur say.
  const demoOn = demoEvent || scen.cancel || scen.delay || scen.snow || scen.lecture;

  // Tonight's place if the user is sleeping elsewhere, otherwise home.
  const start = startPoint(prefs.from, prefs.settings);

  // The whole coming week goes to the server; the screen shows the next morning with something in the calendar.
  const weekEvents = useMemo<CalEvent[]>(() => (cal?.status === "granted" ? cal.events : []), [cal]);
  // On stage the calendar may be empty, so the demo can add a first lecture to the usual destination.
  const shownEvents = useMemo(() => (demoEvent ? [...weekEvents, demoAppointment(prefs.to)] : weekEvents), [demoEvent, weekEvents, prefs.to]);
  const day = useMemo(() => nextMorning(shownEvents, prefs.settings), [shownEvents, prefs.settings]);
  const dayName = day.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" });
  const events = useMemo(
    () => shownEvents.filter(e => e.start >= day && e.start.getTime() < day.getTime() + 24 * 3600 * 1000),
    [shownEvents, day],
  );

  // Keep the server's copy of the trip current; it rechecks every 5 minutes overnight.
  const [server, setServer] = useState<{ id: string; wake: string | null } | null>(null);
  useEffect(() => {
    if (!cal) return;
    const t = setTimeout(() => {
      syncTrip({ from: prefs.from, to: prefs.to, settings: prefs.settings, events: weekEvents, scenario: scen })
        .then(setServer)
        .catch(() => setServer(null));
    }, 800);
    return () => clearTimeout(t);
  }, [cal, prefs.from, prefs.to, prefs.settings, weekEvents, scen]);

  // The whole week, so every morning has an alarm even if the app isn't opened again.
  const [week, setWeek] = useState<PlannedMorning[] | null>(null);
  const [background, setBackground] = useState<boolean | null>(null);
  useEffect(() => {
    if (!cal) return;
    const t = setTimeout(() => planWeek(prefs).then(w => setWeek(w.mornings)).catch(() => {}), 1200);
    return () => clearTimeout(t);
    // Bookkeeping fields (lastWake, feedback) don't change the plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal, prefs.from, prefs.to, prefs.settings]);
  useEffect(() => {
    registerBackgroundRefresh().then(setBackground);
  }, []);

  // A week from the coming morning.
  const loadCalendar = useCallback(async () => {
    const c = await readDay(targetDay());
    setCal(c.status === "granted" ? { ...c, events: await placeEvents(c.events, prefs.from) } : c);
  }, [prefs.from]);

  // Sleeping somewhere else only lasts the night: until noon on the coming morning.
  const awayUntil = () => at(targetDay(), "12:00").toISOString();

  // Late in the evening, when the phone is somewhere else than home, start tomorrow's trip there. No question, just an undo.
  const checkAway = useCallback(async () => {
    const h = new Date().getHours();
    if (h >= 4 && h < 22) return;
    if (prefs.settings.away && new Date() < new Date(prefs.settings.away.until)) return;
    if (prefs.awayDismissedUntil && new Date() < new Date(prefs.awayDismissedUntil)) return;
    const here = await quietPosition();
    if (!here || distanceKm(here, prefs.from) <= 2) return;
    const place = (await reversePlace(here.lat, here.lon)) ?? { id: `pos:${here.lat},${here.lon}`, name: "Her", label: "Der du er nå", ...here };
    setPrefs(p => ({ ...p, settings: { ...p.settings, away: { place, until: awayUntil() } } }));
    setAwayAuto(true);
  }, [prefs.from, prefs.settings.away, prefs.awayDismissedUntil, setPrefs]);
  // "Start from home" also stops the app from switching again tonight.
  const clearAway = () => {
    setAwayAuto(false);
    setPrefs(p => ({ ...p, awayDismissedUntil: awayUntil(), settings: { ...p.settings, away: undefined } }));
  };

  // Plans from home to wherever the first appointment is, so neither stops nor walking time need setting.
  const loadLive = useCallback(async () => {
    const plan = await planDay({ home: start, fallbackTo: prefs.to, day, events, settings: prefs.settings, lectureDemo: scen.lecture });
    if (plan.patterns) {
      setTrips({ base: plan.patterns, later: plan.patternsLater ?? plan.patterns });
      setError(null);
    } else {
      setTrips(null);
      setError("Entur svarer ikke");
    }
    setDest({ place: plan.destination, fromCalendar: plan.fromCalendar });
    fetchWeather(start).then(setWeather).catch(() => setWeather(null));
    setCheckedAt(new Date());
  }, [day, events, start, prefs.to, prefs.settings, scen.lecture]);

  useEffect(() => {
    Promise.resolve().then(() => {
      loadCalendar();
      checkAway();
    });
    ensurePermission().then(setNotifOk);
  }, [loadCalendar, checkAway]);

  // Recheck when the calendar or trip changes, every 2 minutes, and whenever the app comes back to the front.
  useEffect(() => {
    if (!cal) return;
    Promise.resolve().then(loadLive);
    const t = setInterval(loadLive, 120000);
    return () => clearInterval(t);
  }, [cal, loadLive]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") {
        loadCalendar();
        checkAway();
      }
    });
    return () => sub.remove();
  }, [loadCalendar, checkAway]);

  const decision = useMemo(
    () =>
      decide({
        day,
        settings: prefs.settings,
        events,
        scen,
        fromName: start.name,
        toName: dest?.place.name ?? prefs.to.name,
        patterns: trips?.base ?? null,
        patternsLater: trips?.later ?? null,
        weather,
      }),
    [day, prefs.settings, start.name, prefs.to.name, dest, events, scen, trips, weather],
  );

  const why = decision.reasons.map(r => r.title).join(" · ");
  useEffect(() => {
    if (!notifOk || !cal) return;
    // The shown morning from the live screen; the rest of the week from the week plan.
    // During a demo the whole week comes from the plan, so a switch left on can't move a real alarm.
    const planned = (week ?? []).filter(m => demoOn || +m.day !== +day).map(m => ({ wake: m.decision.wake, why: whyText(m.decision) }));
    scheduleAlarms(demoOn ? planned : [{ wake: decision.wake, why }, ...planned]).catch(() => {});
    // Remember a trip alarm so the app can ask how the morning went once it has rung.
    const iso = !demoOn && decision.status === "ok" ? decision.wake?.toISOString() : undefined;
    if (iso) setPrefs(p => (p.lastWake === iso ? p : { ...p, lastWake: iso }));
  }, [notifOk, decision.wake, decision.status, why, cal, setPrefs, week, day, demoOn]);

  const askFeedback = forceFeedback || shouldAskFeedback(prefs);
  const answerFeedback = (delta: number) => {
    setForceFeedback(false);
    setPrefs(p => ({
      ...p,
      lastFeedbackFor: p.lastWake,
      feedbackCount: (p.feedbackCount ?? 0) + 1,
      settings: { ...p.settings, routine: Math.min(120, Math.max(10, p.settings.routine + delta)) },
    }));
  };

  const d = decision.wake && decision.baselineWake ? diffMin(decision.wake, decision.baselineWake) : 0;
  const deltaText = decision.status === "noRoute" ? "Ingen reise funnet" : decision.status === "asked" ? "Fri, men du ba om vekking" : !decision.wake ? "Ingen alarm" : d > 0 ? `${d} min lenger søvn` : d < 0 ? `${-d} min tidligere` : "Vanlig tid";
  const deltaColor = decision.status === "noRoute" ? C.bad : decision.status === "asked" ? C.info : d > 0 ? C.good : d < 0 ? C.bad : C.muted;
  // A home address means Entur counts the walk; only an old stop-based home keeps the manual walk time.
  const setHome = (from: Place) => setPrefs(p => ({ ...p, from, settings: { ...p.settings, walk: from.id.startsWith("NSR:") ? p.settings.walk : 0 } }));
  const setSetting = (k: keyof Settings, v: number) => setPrefs(p => ({ ...p, settings: { ...p.settings, [k]: v } }));

  return (
    <SafeAreaView style={s.root} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} tintColor={C.muted} onRefresh={() => { loadCalendar(); loadLive(); }} />}
      >
        <View style={s.header}>
          {/* Long-press the name to show the demo controls for the pitch. */}
          <Pressable onLongPress={() => setDemoOpen(o => !o)} delayLongPress={600}>
            <Text style={s.brand}>MORGENPILOTEN</Text>
          </Pressable>
          <View style={s.row}>
            <View style={[s.dot, { backgroundColor: trips ? C.good : C.accent }]} />
            <Text style={s.small}>
              {trips ? `Live ${checkedAt ? hm(checkedAt) : ""}` : error ? "Eksempelrute" : "Henter …"}
              {server ? " · følges i natt" : ""}
            </Text>
          </View>
        </View>

        {awayAuto && prefs.settings.away && (
          <View style={[s.card, { gap: 12 }]}>
            <Text style={s.body}>Du er ikke hjemme, så morgendagens reise starter fra {prefs.settings.away.place.label}.</Text>
            <View style={s.row}>
              <Button label="Start hjemmefra i stedet" onPress={clearAway} />
            </View>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.muted}>Vekking {dayName}</Text>
          <Text style={s.big}>{decision.wake ? hm(decision.wake) : decision.status === "free" ? "Fri" : "--:--"}</Text>
          <Text style={[s.pill, { color: deltaColor, backgroundColor: deltaColor + "22" }]}>{deltaText}</Text>
          {decision.pick && (
            <Text style={s.mono}>
              Vanlig vekking {decision.baselineWake ? hm(decision.baselineWake) : "--:--"} · går {hm(decision.pick.expStart)} · fremme {hm(decision.pick.expEnd)}
            </Text>
          )}
          {decision.pick && dest && (
            <Text style={s.small}>
              {prefs.settings.away && start !== prefs.from ? `Fra ${start.label} · ` : ""}til {dest.place.label}{dest.fromCalendar ? " (fra kalenderen)" : ""}
            </Text>
          )}
          {!notifOk && <Text style={[s.small, { color: C.bad }]}>Varsler er slått av. Slå dem på i Innstillinger, ellers kan ikke appen vekke deg.</Text>}
        </View>

        {askFeedback && (
          <View style={[s.card, { gap: 12 }]}>
            <Text style={s.body}>Hvordan gikk morgenen?</Text>
            <Text style={s.small}>Svaret justerer morgenrutinen din ({prefs.settings.routine} min). Appen spør bare de {FEEDBACK_MORNINGS} første morgenene.</Text>
            <View style={s.row}>
              <Button label="God tid" onPress={() => answerFeedback(-ROUTINE_STEP)} />
              <Button label="Passe" onPress={() => answerFeedback(0)} />
              <Button label="Ble stress" onPress={() => answerFeedback(ROUTINE_STEP)} />
            </View>
          </View>
        )}

        <Section title="Hvorfor denne tiden">
          <View style={s.list}>
            {decision.reasons.map((r, i) => <ReasonRow key={i} r={r} />)}
          </View>
        </Section>

        {decision.patterns.length > 0 && <Section title="Avganger">
          {error && <Text style={s.small}>Får ikke kontakt med Entur ({error}). Viser en eksempelrute.</Text>}
          <Pressable onPress={() => setShowTrips(v => !v)} style={s.listRow} accessibilityRole="button">
            <Text style={[s.body, { flex: 1 }]}>{showTrips ? "Skjul avgangene" : `Vis ${decision.patterns.length} avganger som rekker frem`}</Text>
            <Text style={s.muted}>{showTrips ? "▴" : "▾"}</Text>
          </Pressable>
          {showTrips && [...decision.patterns].sort((a, b) => +b.aimedStart - +a.aimedStart).map((p, i) => {
            const late = diffMin(p.expStart, p.aimedStart);
            const chosen = p === decision.pick;
            const tag = p.cancelled ? ["Innstilt", C.bad] : late > 0 ? [`+${late} min`, C.info] : chosen ? ["Din avgang", C.good] : [p.realtime ? "I rute" : "Planlagt", C.muted];
            return (
              <View key={i} style={[s.trip, chosen && { borderColor: C.accent, backgroundColor: C.accentSoft }]}>
                <Text style={[s.mono, p.cancelled && { color: C.bad, textDecorationLine: "line-through" }]}>
                  {hm(p.expStart)} → {hm(p.expEnd)} <Text style={{ color: C.muted }}>{p.lines}</Text>
                </Text>
                <Text style={[s.tag, { color: tag[1], backgroundColor: tag[1] + "22" }]}>{tag[0]}</Text>
              </View>
            );
          })}
        </Section>}

        {week && week.length > 1 && (
          <Section title="Uka di">
            <View style={s.list}>
              {week.map((m, i) => {
                const isNext = +m.day === +day;
                const d = isNext ? decision : m.decision;
                const label = d.wake ? hm(d.wake) : d.status === "free" ? "Fri" : "--:--";
                const note = d.status === "ok" ? `Fremme ${d.pick ? hm(d.pick.expEnd) : ""} · ${d.deadline.event.title}` : d.reasons[0]?.title;
                return (
                  <View key={i} style={s.listRow}>
                    <Text style={[s.body, { width: 44, color: isNext ? C.accent : C.fg, fontWeight: isNext ? "700" : "400" }]}>{WEEKDAY_SHORT[osloWeekday(m.day)]}</Text>
                    <Text style={[s.mono, { width: 52, fontSize: 15, color: d.status === "noRoute" ? C.bad : d.wake ? C.fg : C.good }]}>{label}</Text>
                    <Text style={[s.small, { flex: 1 }]} numberOfLines={1}>{note}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={s.small}>
              {background
                ? "Alarmene er satt for hele uka. Du trenger ikke åpne appen: den sjekker Entur og kalenderen selv når iPhone lar den, ofte om natta."
                : "Alarmene er satt for hele uka. Åpne appen innimellom, så får den med seg endringer."}
            </Text>
          </Section>
        )}

        <Section title={`Kalender, ${dayName}`}>
          <CalendarList cal={cal} events={events} demoLecture={scen.lecture} onRetry={loadCalendar} />
          <Text style={s.small}>Alarmen følger kalenderen. Fri en dag? Legg inn «Fri» eller «Ferie» som heldagsavtale. Vil du opp på et bestemt klokkeslett, også en fridag? Legg inn «Vekk meg» på det klokkeslettet.</Text>
        </Section>

        {demoOpen && <Section title="Demo: hva skjer i natt?">
          <View style={s.list}>
            <Toggle label="Demo-avtale kl. 08:15" value={demoEvent} onChange={setDemoEvent} />
            <Toggle label="Toget er innstilt" value={scen.cancel} onChange={v => setScen({ ...scen, cancel: v })} />
            <Toggle label="Toget er forsinket" value={scen.delay} onChange={v => setScen({ ...scen, delay: v })} />
            <Toggle label="Snø i natt" value={scen.snow} onChange={v => setScen({ ...scen, snow: v })} />
            <Toggle label="Første time avlyst" value={scen.lecture} onChange={v => setScen({ ...scen, lecture: v })} />
          </View>
          <Text style={s.small}>Bryterne legger en hendelse oppå de ekte dataene, så dere kan vise hver situasjon på scenen. Demo-avtalen er en første time til vanlig reisemål, for når kalenderen er tom. De ekte alarmene endres ikke. Hold inne navnet øverst for å skjule panelet.</Text>
          <View style={s.row}>
            <Button primary label="Test alarmen" onPress={() => ringNow(why)} />
            <Button label="Vis oppstarten igjen" onPress={() => setPrefs(p => ({ ...p, onboarded: false }))} />
            <Button label="Vis morgenspørsmålet" onPress={() => setForceFeedback(true)} />
          </View>
        </Section>}

        <Pressable onPress={() => setShowSettings(v => !v)} style={[s.listRow, { borderRadius: 12 }]} accessibilityRole="button">
          <Text style={[s.body, { flex: 1 }]}>Innstillinger</Text>
          <Text style={s.small}>{prefs.from.name} · {prefs.settings.routine} min rutine {showSettings ? "▴" : "▾"}</Text>
        </Pressable>

        {showSettings && <Section title="Reisen din">
          {prefs.settings.away && (
            <View style={s.listRow}>
              <Text style={[s.body, { flex: 1 }]}>I morgen starter reisen fra {prefs.settings.away.place.label}</Text>
              <Button label="Hjemmefra" onPress={clearAway} />
            </View>
          )}
          <HomePicker home={prefs.from} onPick={setHome} />
          <PlacePicker label="Vanlig reisemål" place={prefs.to} near={prefs.from} onPick={to => setPrefs(p => ({ ...p, to }))}>
            <Suggestions events={weekEvents} home={prefs.from} current={prefs.to} onPick={to => setPrefs(p => ({ ...p, to }))} />
          </PlacePicker>
          <Text style={[s.small, { marginTop: -6 }]}>Brukes når kalenderavtalen ikke har et sted appen finner.</Text>
          <View style={s.list}>
            <Toggle label="Alarm på helligdager også" value={!!prefs.settings.workHolidays} onChange={v => setPrefs(p => ({ ...p, settings: { ...p.settings, workHolidays: v } }))} />
            <Stepper label="Morgenrutine" value={prefs.settings.routine} onChange={v => setSetting("routine", v)} />
            <Stepper label="Fremme før første time" value={prefs.settings.margin} onChange={v => setSetting("margin", v)} />
            <Stepper label="Ekstra ved snø" value={prefs.settings.snowExtra} onChange={v => setSetting("snowExtra", v)} />
          </View>
        </Section>}

        <Text style={[s.small, { textAlign: "center", marginTop: 8 }]}>Sanntid fra Entur · vær fra MET Norge</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// The day's appointments (`events`); `cal` only tells whether the calendar could be read.
function CalendarList({ cal, events, demoLecture, onRetry }: { cal: CalendarState | null; events: CalEvent[]; demoLecture: boolean; onRetry: () => void }) {
  if (!cal) return <Text style={s.small}>Leser kalenderen …</Text>;
  if (cal.status === "denied")
    return (
      <View style={{ gap: 8 }}>
        <Text style={s.small}>Appen har ikke tilgang til kalenderen, så den vet ikke når du må opp. Gi tilgang i Innstillinger → Expo Go → Kalendere.</Text>
        <Button label="Prøv igjen" onPress={onRetry} />
      </View>
    );
  if (cal.status === "error") return <Text style={s.small}>Kunne ikke lese kalenderen: {cal.message}</Text>;
  if (events.length === 0) return <Text style={s.small}>Ingenting i kalenderen denne uka, så ingen alarm.</Text>;
  const first = events.find(e => !e.off && !e.wake);
  return (
    <View style={s.list}>
      {events.map((e, i) => {
        const cancelled = e.cancelled || (demoLecture && e === first);
        return (
          <View key={i} style={s.listRow}>
            <Text style={[s.mono, { width: 56, color: C.muted }]}>{e.off ? "Hele" : hm(e.start)}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.body, cancelled && { color: C.muted, textDecorationLine: "line-through" }]} numberOfLines={2}>{e.title}</Text>
              {e.location && <Text style={s.small} numberOfLines={1}>{e.location}</Text>}
            </View>
            {cancelled && <Text style={[s.tag, { color: C.info, backgroundColor: C.info + "22" }]}>Avlyst</Text>}
            {e.off && <Text style={[s.tag, { color: C.good, backgroundColor: C.good + "22" }]}>Fri</Text>}
            {e.wake && !e.cancelled && <Text style={[s.tag, { color: C.info, backgroundColor: C.info + "22" }]}>Vekking</Text>}
          </View>
        );
      })}
    </View>
  );
}

function ReasonRow({ r }: { r: Reason }) {
  const color = TONE[r.tone];
  return (
    <View style={s.listRow}>
      <Text style={[s.mono, { width: 56, color: C.muted }]}>{r.time}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.body}>{r.title}</Text>
        <Text style={s.small}>{r.detail}</Text>
      </View>
      <Text style={[s.tag, { color, backgroundColor: color + "22" }]}>{r.tag}</Text>
    </View>
  );
}

// One-tap destinations taken from where the calendar says the user goes.
export function Suggestions({ events, home, current, onPick }: { events: CalEvent[]; home: Place; current: Place | null; onPick: (p: Place) => void }) {
  const list = suggestDestinations(events, home).filter(x => x.place.id !== current?.id);
  if (list.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.small}>Fra kalenderen din:</Text>
      <View style={s.row}>
        {list.map(x => (
          <Button key={x.place.id} label={`${x.place.name} (${x.count})`} onPress={() => onPick(x.place)} />
        ))}
      </View>
    </View>
  );
}

const WEEKDAY_SHORT = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"];

// A made-up first lecture at 08:15 on the coming morning, or the one after if that's less than an hour away.
function demoAppointment(to: Place): CalEvent {
  let day = targetDay();
  if (at(day, "08:15") < addMin(new Date(), 60)) day = dayAfter(day, 1);
  return { start: at(day, "08:15"), title: "Forelesning (demo)", cancelled: false, location: to.label, place: to };
}
