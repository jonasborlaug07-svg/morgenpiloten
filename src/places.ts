// Looks up calendar locations on the phone: Entur first (gives stops), then Apple Maps, which knows
// shops, buildings and businesses. Results are kept on the phone so each place is looked up once.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { distanceKm, MAX_TRIP_KM, resolveLocation, type Place } from "./api";
import type { CalEvent } from "./logic";

const CACHE_KEY = "morgenpiloten.places.v1";
const MISS_TTL = 3 * 24 * 3600 * 1000; // try unknown places again after a few days

type Entry = { place: Place | null; at: number };
let cache: Record<string, Entry> | null = null;

async function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) ?? "{}");
  } catch {
    cache = {};
  }
  return cache!;
}

async function lookUp(text: string, home: Place): Promise<Place | null> {
  const entur = await resolveLocation(text, home).catch(() => null);
  if (entur) return entur;
  try {
    const hit = (await Location.geocodeAsync(text))[0];
    if (!hit) return null;
    const spot = { lat: hit.latitude, lon: hit.longitude };
    if (distanceKm(home, spot) > MAX_TRIP_KM) return null;
    const name = text.split(",")[0].trim();
    return { id: `pos:${spot.lat.toFixed(5)},${spot.lon.toFixed(5)}`, name, label: text.trim(), ...spot };
  } catch {
    return null;
  }
}

const isMorning = (e: CalEvent) => e.start.getHours() < 12;

// Adds `place` to morning events whose location we can find.
export async function placeEvents(events: CalEvent[], home: Place): Promise<CalEvent[]> {
  const c = await loadCache();
  const texts = [...new Set(events.filter(e => e.location && isMorning(e)).map(e => e.location!.trim().toLowerCase()))];
  let changed = false;
  for (const t of texts) {
    const hit = c[t];
    const fresh = hit && (hit.place || Date.now() - hit.at < MISS_TTL) && (!hit.place || distanceKm(home, hit.place) <= MAX_TRIP_KM);
    if (fresh) continue;
    const original = events.find(e => e.location?.trim().toLowerCase() === t)!.location!;
    c[t] = { place: await lookUp(original, home), at: Date.now() };
    changed = true;
  }
  if (changed) AsyncStorage.setItem(CACHE_KEY, JSON.stringify(c)).catch(() => {});
  return events.map(e => {
    const hit = e.location && isMorning(e) ? c[e.location.trim().toLowerCase()]?.place : null;
    return hit && distanceKm(home, hit) <= MAX_TRIP_KM ? { ...e, place: hit } : e;
  });
}

// The places the user goes to most on weekday mornings, for suggesting the usual destination.
export function suggestDestinations(events: CalEvent[], home: Place, max = 3): { place: Place; count: number }[] {
  const counts = new Map<string, { place: Place; count: number }>();
  for (const e of events) {
    if (!e.place || !isMorning(e) || distanceKm(home, e.place) < 0.3) continue;
    const cur = counts.get(e.place.id) ?? { place: e.place, count: 0 };
    cur.count++;
    counts.set(e.place.id, cur);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, max);
}
