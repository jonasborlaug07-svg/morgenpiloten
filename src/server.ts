// Talks to the Morgenpiloten server in Supabase, which keeps watching the trip overnight.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Stop } from "./api";
import type { CalEvent, Scenario, Settings } from "./logic";

export const SERVER_URL = "https://wworbthbnmdxnwzyqxgd.supabase.co/functions/v1/morgenpiloten";
// The project's public (anon) key. It only lets callers reach the function; the tables are closed to it.
export const SERVER_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3b3JidGhibm1keG53enlxeGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNjA1NDEsImV4cCI6MjEwOTYzNjU0MX0.liPUxrlH7G1y1Pd7aBqOiYhD85TcXOJF-8VbELq0DxU";

const ID_KEY = "morgenpiloten.tripId";

export type ServerAnswer = { id: string; wake: string | null; live: boolean };

export async function syncTrip(input: {
  from: Stop;
  to: Stop;
  settings: Settings;
  events: CalEvent[];
  scenario: Scenario;
}): Promise<ServerAnswer> {
  const id = await AsyncStorage.getItem(ID_KEY).catch(() => null);
  const r = await fetch(`${SERVER_URL}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVER_KEY}` },
    body: JSON.stringify({
      id,
      from: input.from,
      to: input.to,
      settings: input.settings,
      // Only what the server needs to plan mornings: when, where and whether it's cancelled.
      // Titles stay on the phone, and the place text is sent only when the phone couldn't look it up.
      events: input.events
        .filter(e => e.start.getHours() < 12)
        .map(e => ({
          start: e.start.toISOString(),
          title: "Avtale",
          cancelled: e.cancelled,
          ...(e.off ? { off: true } : {}),
          ...(e.wake ? { wake: true } : {}),
          ...(e.place ? { place: e.place } : e.location ? { location: e.location } : {}),
        })),
      scenario: input.scenario,
    }),
  });
  if (!r.ok) throw new Error("Serveren svarte " + r.status);
  const j = await r.json();
  if (j.id && j.id !== id) await AsyncStorage.setItem(ID_KEY, j.id).catch(() => {});
  return { id: j.id, wake: j.wake, live: j.live };
}
