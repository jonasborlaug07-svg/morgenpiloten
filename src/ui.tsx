// Shared colours, styles and small components for the main screen and the onboarding.
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { searchPlaces, type Place } from "./api";
import { currentPlace } from "./location";

export const C = {
  bg: "#0b1322",
  surface: "#121d31",
  line: "#24324c",
  fg: "#e8edf6",
  muted: "#92a1bb",
  accent: "#ffb547",
  accentSoft: "#2c2412",
  good: "#5fd39a",
  bad: "#ff7a70",
  info: "#8db4ff",
};
export const TONE = { good: C.good, bad: C.bad, info: C.info, neutral: C.muted };

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.h2}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.listRow}>
      <Text style={[s.body, { flex: 1 }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.accent, false: C.line }} />
    </View>
  );
}

export function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={s.listRow}>
      <Text style={[s.body, { flex: 1 }]}>{label}</Text>
      <Pressable style={s.step} onPress={() => onChange(Math.max(0, value - 5))} accessibilityLabel={`${label} minus 5`}><Text style={s.stepText}>−</Text></Pressable>
      <Text style={[s.mono, { width: 64, textAlign: "center" }]}>{value} min</Text>
      <Pressable style={s.step} onPress={() => onChange(Math.min(180, value + 5))} accessibilityLabel={`${label} pluss 5`}><Text style={s.stepText}>+</Text></Pressable>
    </View>
  );
}

export function Button({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, primary && { backgroundColor: C.accent, borderColor: C.accent }, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 }]}
    >
      <Text style={[s.btnText, primary && { color: C.bg }]}>{label}</Text>
    </Pressable>
  );
}

export function PlacePicker({ label, place, onPick, near, placeholder = "Søk etter adresse eller holdeplass", children }: {
  label: string;
  place: Place | null;
  onPick: (p: Place) => void;
  near?: { lat: number; lon: number };
  placeholder?: string;
  children?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Place[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChange = (t: string) => {
    setText(t);
    if (timer.current) clearTimeout(timer.current);
    if (t.length < 2) return setHits([]);
    timer.current = setTimeout(() => searchPlaces(t, near).then(setHits).catch(() => setHits([])), 250);
  };
  return (
    <View style={{ gap: 6, marginBottom: 12 }}>
      <Text style={s.muted}>
        {label}: <Text style={{ color: place ? C.fg : C.muted }}>{place ? place.label : "ikke valgt"}</Text>
      </Text>
      {children}
      <TextInput style={s.input} value={text} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.muted} autoCorrect={false} />
      {hits.length > 0 && (
        <View style={s.list}>
          {hits.slice(0, 5).map(h => (
            <Pressable key={h.id} style={s.listRow} onPress={() => { onPick(h); setText(""); setHits([]); }}>
              <Text style={s.body}>{h.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export function HomePicker({ home, onPick }: { home: Place | null; onPick: (p: Place) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const useHere = async () => {
    setBusy(true);
    setErr(null);
    const r = await currentPlace();
    setBusy(false);
    if ("place" in r) onPick(r.place);
    else setErr(r.error);
  };
  return (
    <PlacePicker label="Hjem" place={home} onPick={onPick} placeholder="Eller søk opp adressen din">
      <Button primary label={busy ? "Finner posisjonen …" : "Bruk posisjonen min"} onPress={useHere} disabled={busy} />
      {err && <Text style={[s.small, { color: C.bad }]}>{err}</Text>}
    </PlacePicker>
  );
}

export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, gap: 24, paddingBottom: 48 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { color: C.fg, fontSize: 20, fontWeight: "800", letterSpacing: 1.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  card: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 20, gap: 10 },
  big: { color: C.accent, fontSize: 96, fontWeight: "800", lineHeight: 100, fontVariant: ["tabular-nums"], letterSpacing: -2 },
  pill: { alignSelf: "flex-start", fontSize: 14, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden" },
  h1: { color: C.fg, fontSize: 30, fontWeight: "800", lineHeight: 36 },
  h2: { color: C.muted, fontSize: 12, fontWeight: "600", letterSpacing: 1.4 },
  body: { color: C.fg, fontSize: 15 },
  lead: { color: C.muted, fontSize: 16, lineHeight: 23 },
  muted: { color: C.muted, fontSize: 13 },
  small: { color: C.muted, fontSize: 13, lineHeight: 18 },
  mono: { color: C.fg, fontSize: 13, fontFamily: "Menlo", fontVariant: ["tabular-nums"] },
  list: { borderColor: C.line, borderWidth: 1, borderRadius: 12, overflow: "hidden", backgroundColor: C.line, gap: 1 },
  listRow: { backgroundColor: C.surface, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  tag: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden", textTransform: "uppercase" },
  trip: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, backgroundColor: C.surface },
  input: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 10, color: C.fg, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  btn: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center" },
  btnText: { color: C.fg, fontWeight: "600", fontSize: 15 },
  step: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  stepText: { color: C.fg, fontSize: 20, lineHeight: 22 },
});
