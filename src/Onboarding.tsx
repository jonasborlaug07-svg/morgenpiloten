// First-run setup. One button connects the calendar (and asks for notifications and position), fills in home from
// the position and the usual destination from the calendar, then shows the first wake-up time.
// The trip screen is only for what it could not find, or what the user wants to change. After that the calendar decides.
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fetchWeather, type Place } from "./api";
import { readDay, requestCalendarAccess } from "./calendar";
import { ensurePermission } from "./alarm";
import { decide, hm, nextMorning, targetDay, type CalEvent, type Decision } from "./logic";
import { currentPlace } from "./location";
import { planDay } from "./plan";
import { placeEvents, suggestDestinations } from "./places";
import type { Prefs } from "./prefs";
import { Button, C, HomePicker, PlacePicker, s, Stepper } from "./ui";

const STEPS = 3;
const DAY_MS = 24 * 3600 * 1000;
const NO_SCEN = { cancel: false, delay: false, snow: false, lecture: false };

export function Onboarding({ prefs, onDone }: { prefs: Prefs; onDone: (p: Prefs) => void }) {
  const [step, setStep] = useState(0);
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  // Trips start at the home address, so Entur counts the walk.
  const [settings, setSettings] = useState({ ...prefs.settings, walk: 0 });

  const [access, setAccess] = useState({ notifOk: true, calendarOk: true });
  const next = () => setStep(n => Math.min(STEPS - 1, n + 1));

  // One tap: ask for everything, fill in what we can find, and jump to the result (or to what's missing).
  const start = async () => {
    const r = await autoSetup();
    setAccess({ notifOk: r.notifOk, calendarOk: r.calendarOk });
    setFrom(r.from);
    setTo(r.to);
    setStep(r.from && r.to ? 2 : 1);
  };
  const back = () => setStep(n => Math.max(0, n - 1));

  return (
    <SafeAreaView style={s.root} edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={[s.scroll, { flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        <View style={[s.header, { minHeight: 36 }]}>
          {step > 0 ? (
            <Pressable onPress={back} hitSlop={12} accessibilityLabel="Tilbake">
              <Text style={[s.body, { color: C.muted }]}>‹ Tilbake</Text>
            </Pressable>
          ) : <View />}
          <Progress step={step} />
        </View>

        {step === 0 && <Welcome onStart={start} />}
        {step === 1 && (
          <TripStep
            from={from} to={to} settings={settings}
            onFrom={setFrom} onTo={setTo} onSettings={setSettings} onNext={next}
          />
        )}
        {step === 2 && from && to && (
          <FirstWake
            from={from} to={to} settings={settings} {...access}
            onEditTrip={() => setStep(1)}
            onDone={() => onDone({ ...prefs, from, to, settings, onboarded: true })}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }} accessibilityLabel={`Steg ${step + 1} av ${STEPS}`}>
      {Array.from({ length: STEPS }, (_, i) => (
        <View key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i <= step ? C.accent : C.line }} />
      ))}
    </View>
  );
}

function Welcome({ onStart }: { onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ flex: 1, gap: 20, justifyContent: "center" }}>
      <Text style={[s.brand, { color: C.accent }]}>MORGENPILOTEN</Text>
      <Text style={s.h1}>Vekkerklokka som vet at toget er innstilt.</Text>
      <View style={{ gap: 12 }}>
        <Point text="Toget er innstilt: du blir vekket tidligere, med en ny rute klar." />
        <Point text="Toget er forsinket: du får sove lenger." />
        <Point text="Snø i natt: du blir vekket 5 minutter før." />
        <Point text="Første time er avlyst: alarmen flyttes." />
      </View>
      <Text style={s.small}>Appen går etter kalenderen din: står det noe før kl. 12, blir du vekket i tide. Står det ingenting, får du sove. Du trenger ikke åpne appen etterpå.</Text>
      <Button primary label={busy ? "Kobler til …" : "Koble til kalenderen"} disabled={busy} onPress={async () => { setBusy(true); await onStart(); }} />
    </View>
  );
}

function Point({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Text style={{ color: C.accent, fontSize: 16 }}>•</Text>
      <Text style={[s.lead, { flex: 1, color: C.fg }]}>{text}</Text>
    </View>
  );
}

function TripStep(p: {
  from: Place | null; to: Place | null; settings: Prefs["settings"];
  onFrom: (s: Place) => void; onTo: (s: Place) => void; onSettings: (s: Prefs["settings"]) => void; onNext: () => void;
}) {
  const ready = p.from && p.to && p.from.id !== p.to.id;
  const { from, to, onTo } = p;

  // Once home is known, look at the coming week's calendar and suggest where the user usually goes.
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  useEffect(() => {
    if (!from) return;
    let alive = true;
    (async () => {
      const cal = await readDay(targetDay());
      const placed = cal.status === "granted" ? await placeEvents(cal.events, from) : [];
      if (!alive) return;
      setEvents(placed);
      const top = suggestDestinations(placed, from)[0];
      if (top && !to) onTo(top.place);
    })();
    return () => { alive = false; };
  }, [from, to, onTo]);
  const suggestions = from && events ? suggestDestinations(events, from).filter(x => x.place.id !== to?.id) : [];

  return (
    <View style={{ gap: 16 }}>
      <Text style={s.h1}>Hvor bor du?</Text>
      <Text style={s.lead}>Appen planlegger reisen fra døra di, med gåtid, og finner selv beste buss eller tog.</Text>
      <HomePicker home={p.from} onPick={p.onFrom} />
      {p.from && (
        <>
          <Text style={[s.h1, { fontSize: 22, lineHeight: 28 }]}>Hvor skal du vanligvis?</Text>
          <Text style={s.lead}>Brukes bare når kalenderavtalen ikke har et sted. Har den det, reiser appen dit.</Text>
          {from && !events && <Text style={s.small}>Ser i kalenderen etter hvor du pleier å være …</Text>}
          <PlacePicker label="Vanlig reisemål" place={p.to} near={p.from} onPick={p.onTo}>
            {suggestions.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={s.small}>Fra kalenderen din:</Text>
                <View style={s.row}>
                  {suggestions.map(x => <Button key={x.place.id} label={`${x.place.name} (${x.count})`} onPress={() => p.onTo(x.place)} />)}
                </View>
              </View>
            )}
          </PlacePicker>
          {p.to && p.from.id === p.to.id && <Text style={[s.small, { color: C.bad }]}>Hjem og reisemål kan ikke være samme sted.</Text>}
          <View style={s.list}>
            <Stepper label="Fra du står opp til du går" value={p.settings.routine} onChange={v => p.onSettings({ ...p.settings, routine: v })} />
          </View>
        </>
      )}
      <Button primary label="Neste" onPress={p.onNext} disabled={!ready} />
    </View>
  );
}

function FirstWake({ from, to, settings, notifOk, calendarOk, onEditTrip, onDone }: {
  from: Place; to: Place; settings: Prefs["settings"]; notifOk: boolean; calendarOk: boolean;
  onEditTrip: () => void; onDone: () => void;
}) {
  const [result, setResult] = useState<{ day: Date; d: Decision; live: boolean; dest: Place; fromCalendar: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      // The week from the coming morning; the first wake-up is the first morning with something on.
      const cal = await readDay(targetDay());
      const week = cal.status === "granted" ? await placeEvents(cal.events, from) : [];
      const day = nextMorning(week, settings);
      const events = week.filter(e => e.start >= day && e.start.getTime() < day.getTime() + DAY_MS);
      const plan = await planDay({ home: from, fallbackTo: to, day, events, settings, lectureDemo: false });
      const weather = await fetchWeather(from).catch(() => null);
      const d = decide({
        day, settings, events, scen: NO_SCEN, fromName: from.name, toName: plan.destination.name,
        patterns: plan.patterns, patternsLater: plan.patternsLater, weather,
      });
      if (alive) setResult({ day, d, live: plan.patterns != null, dest: plan.destination, fromCalendar: plan.fromCalendar });
    })();
    return () => { alive = false; };
  }, [from, to, settings]);

  if (!result)
    return (
      <View style={{ flex: 1, gap: 16, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={C.accent} />
        <Text style={s.lead}>Sjekker kalenderen og Entur …</Text>
      </View>
    );

  const { day, d, live, dest, fromCalendar } = result;
  const dayName = day.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" });
  const setup = (
    <View style={{ gap: 8 }}>
      <View style={s.list}>
        <Editable label="Hjem" value={from.label} onEdit={onEditTrip} />
        <Editable label="Reisemål" value={to.label} onEdit={onEditTrip} />
      </View>
      {!calendarOk && <Text style={[s.small, { color: C.bad }]}>Appen fikk ikke lese kalenderen, så den vet ikke når du må opp. Slå på Kalendere for Expo Go i Innstillinger.</Text>}
      {!notifOk && <Text style={[s.small, { color: C.bad }]}>Varsler er slått av, så appen kan ikke vekke deg. Slå dem på i Innstillinger.</Text>}
    </View>
  );
  if (d.status === "noRoute")
    return (
      <View style={{ flex: 1, gap: 16, justifyContent: "center" }}>
        <Text style={s.h1}>Fant ingen reise</Text>
        <Text style={s.lead}>{d.reasons[0]?.detail}</Text>
        <Text style={s.small}>Velg et reisemål du kan nå med buss, trikk eller tog fra hjemmet ditt.</Text>
        {setup}
      </View>
    );
  if (!d.wake)
    return (
      <View style={{ flex: 1, gap: 16, justifyContent: "center" }}>
        <Text style={s.lead}>{dayName[0].toUpperCase() + dayName.slice(1)}</Text>
        <Text style={s.big}>Fri</Text>
        <Text style={s.lead}>{d.reasons[0]?.detail}</Text>
        <Text style={s.small}>Ingenting i kalenderen før kl. 12 den neste uka. Appen følger med og setter alarmen av seg selv når du får noe om morgenen.</Text>
        {setup}
        <Button primary label="Ferdig" onPress={onDone} />
      </View>
    );
  return (
    <View style={{ flex: 1, gap: 16, justifyContent: "center" }}>
      <Text style={s.lead}>Du blir vekket {dayName}</Text>
      <Text style={s.big}>{hm(d.wake)}</Text>
      <View style={s.list}>
        {d.status === "asked"
          ? <Fact label="Fra kalenderen" value={d.reasons[0].detail} />
          : <Fact label="Første avtale" value={`${d.deadline.event.title}, ${hm(d.deadline.event.start)}`} />}
        {d.pick && <Fact label="Du går" value={`${hm(d.pick.expStart)}, ${d.pick.lines}`} />}
        {d.pick && <Fact label="Fremme" value={`${hm(d.pick.expEnd)}, ${dest.name}${fromCalendar ? " (fra kalenderen)" : ""}`} />}
      </View>
      <Text style={s.small}>
        {live
          ? "Fra nå av følger Morgenpiloten reisen din hele natta og flytter alarmen hvis noe endrer seg."
          : "Fikk ikke kontakt med Entur akkurat nå, så tiden er et anslag. Appen prøver igjen av seg selv."}
      </Text>
      {setup}
      <Button primary label="Stemmer, ferdig" onPress={onDone} />
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.listRow}>
      <Text style={[s.small, { width: 96 }]}>{label}</Text>
      <Text style={[s.body, { flex: 1 }]}>{value}</Text>
    </View>
  );
}

function Editable({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <View style={s.listRow}>
      <Text style={[s.small, { width: 72 }]}>{label}</Text>
      <Text style={[s.body, { flex: 1 }]} numberOfLines={2}>{value}</Text>
      <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Endre ${label.toLowerCase()}`}>
        <Text style={[s.body, { color: C.info }]}>Endre</Text>
      </Pressable>
    </View>
  );
}

// Asks for notifications, calendar and position in turn, then fills in home from the position
// and the usual destination from where the calendar says the user goes.
async function autoSetup() {
  const notifOk = await ensurePermission();
  const calendarOk = await requestCalendarAccess();
  const here = await currentPlace();
  const from = "place" in here ? here.place : null;
  let to: Place | null = null;
  if (calendarOk && from) {
    const cal = await readDay(targetDay());
    if (cal.status === "granted") to = suggestDestinations(await placeEvents(cal.events, from), from)[0]?.place ?? null;
  }
  return { notifOk, calendarOk, from, to };
}
