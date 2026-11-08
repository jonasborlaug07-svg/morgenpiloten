// Entur (journey planner + stop search) and MET Norway (weather forecast).
import type { Pattern, WeatherPoint } from "./logic";

const CLIENT = "morgenpiloten-hackathon";

// A stop (NSR:StopPlace id) or any address/point. Trips from an address include the walk to the stop.
export type Place = { id: string; name: string; label: string; lat: number; lon: number };
export type Stop = Place;

export const DEFAULT_FROM: Stop = { id: "NSR:StopPlace:62339", name: "Lillestrøm stasjon", label: "Lillestrøm stasjon, Lillestrøm", lat: 59.9527, lon: 11.0451 };
export const DEFAULT_TO: Stop = { id: "NSR:StopPlace:59872", name: "Oslo S", label: "Oslo S, Oslo", lat: 59.9111, lon: 10.7528 };

const TRIP_Q = `query($from:Location!,$to:Location!,$dt:DateTime!){
  trip(from:$from,to:$to,dateTime:$dt,arriveBy:true,numTripPatterns:6,includeRealtimeCancellations:true){
    tripPatterns{ aimedStartTime expectedStartTime aimedEndTime expectedEndTime
      legs{ mode line{publicCode} fromEstimatedCall{cancellation realtime} } } } }`;

type RawLeg = { mode: string; line: { publicCode: string } | null; fromEstimatedCall: { cancellation: boolean; realtime: boolean } | null };
type RawPattern = { aimedStartTime: string; expectedStartTime: string; aimedEndTime: string; expectedEndTime: string; legs: RawLeg[] };

function normalize(p: RawPattern): Pattern {
  const legs = p.legs.filter(l => l.mode !== "foot");
  return {
    aimedStart: new Date(p.aimedStartTime),
    expStart: new Date(p.expectedStartTime),
    aimedEnd: new Date(p.aimedEndTime),
    expEnd: new Date(p.expectedEndTime),
    lines: legs.map(l => l.line?.publicCode || l.mode).join(" → ") || "gange",
    cancelled: p.legs.some(l => l.fromEstimatedCall?.cancellation),
    realtime: p.legs.some(l => l.fromEstimatedCall?.realtime),
  };
}

const location = (p: Place) =>
  p.id.startsWith("NSR:") ? { name: p.name, place: p.id } : { name: p.name, coordinates: { latitude: p.lat, longitude: p.lon } };

// Short-lived caches so repeated recalculations don't hit Entur and MET again.
const tripCache = new Map<string, { at: number; value: Promise<Pattern[]> }>();
const TRIP_TTL = 60 * 1000;
const weatherCache = new Map<string, { at: number; value: Promise<WeatherPoint[]> }>();
const WEATHER_TTL = 30 * 60 * 1000;

function cached<T>(map: Map<string, { at: number; value: Promise<T> }>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = load();
  map.set(key, { at: Date.now(), value });
  value.catch(() => map.delete(key));
  return value;
}

// Trips from `from` to `to` arriving no later than `arriveBy`.
export function fetchTrips(from: Place, to: Place, arriveBy: Date): Promise<Pattern[]> {
  const key = `${from.id}|${from.lat},${from.lon}|${to.id}|${arriveBy.toISOString()}`;
  return cached(tripCache, key, TRIP_TTL, () => loadTrips(from, to, arriveBy));
}

async function loadTrips(from: Place, to: Place, arriveBy: Date): Promise<Pattern[]> {
  const r = await fetch("https://api.entur.io/journey-planner/v3/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "ET-Client-Name": CLIENT },
    body: JSON.stringify({ query: TRIP_Q, variables: { from: location(from), to: location(to), dt: arriveBy.toISOString() } }),
  });
  if (!r.ok) throw new Error("Entur svarte " + r.status);
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return (j.data.trip.tripPatterns as RawPattern[]).map(normalize);
}

const toPlace = (f: any): Place => ({
  id: f.properties.id,
  name: f.properties.name,
  label: f.properties.label,
  lon: f.geometry.coordinates[0],
  lat: f.geometry.coordinates[1],
});

// Stops and addresses matching `text`, nearest to `near` first.
export async function searchPlaces(text: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const focus = near ? `&focus.point.lat=${near.lat.toFixed(4)}&focus.point.lon=${near.lon.toFixed(4)}` : "";
  const url = `https://api.entur.io/geocoder/v1/autocomplete?layers=venue,address&size=8&lang=no${focus}&text=${encodeURIComponent(text)}`;
  const r = await fetch(url, { headers: { "ET-Client-Name": CLIENT } });
  if (!r.ok) throw new Error("Entur svarte " + r.status);
  return (await r.json()).features.map(toPlace);
}

// The nearest address to a point, e.g. the phone's position.
export async function reversePlace(lat: number, lon: number): Promise<Place | null> {
  const url = `https://api.entur.io/geocoder/v1/reverse?point.lat=${lat}&point.lon=${lon}&size=1&layers=address&lang=no`;
  const r = await fetch(url, { headers: { "ET-Client-Name": CLIENT } });
  if (!r.ok) return null;
  const f = (await r.json()).features[0];
  // Keep the exact position; the label is only for showing.
  return f ? { ...toPlace(f), id: `pos:${lat.toFixed(5)},${lon.toFixed(5)}`, lat, lon } : null;
}

// Places further away than this from home can't be a morning commute, so a match there is wrong.
export const MAX_TRIP_KM = 100;

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Turn a calendar location like "Blindern" or "Karl Johans gate 47, Oslo" into a place. Null if Entur doesn't know it.
const resolved = new Map<string, Place | null>();
export async function resolveLocation(text: string, near?: { lat: number; lon: number }): Promise<Place | null> {
  const key = text.trim().toLowerCase();
  if (!key) return null;
  if (resolved.has(key)) return resolved.get(key)!;
  // Entur matches loosely ("Realfagbygget, Aud 1" finds "Aud Schønemanns vei 1"), so the hit's name must
  // start the same way as what the calendar says. Otherwise we fall back to the usual destination.
  const firstWord = (t: string) => t.toLowerCase().split(/[\s,()]+/).find(w => w.length >= 3) ?? "";
  let hit: Place | null = null;
  for (const q of [text, text.split(/[,(]/)[0]]) {
    if (hit || q.trim().length < 3) continue;
    const top = (await searchPlaces(q.trim(), near).catch(() => []))[0];
    if (top && firstWord(top.name) === firstWord(q) && (!near || distanceKm(near, top) <= MAX_TRIP_KM)) hit = top;
  }
  resolved.set(key, hit);
  return hit;
}

export function fetchWeather(stop: Stop): Promise<WeatherPoint[]> {
  return cached(weatherCache, `${stop.lat.toFixed(2)},${stop.lon.toFixed(2)}`, WEATHER_TTL, () => loadWeather(stop));
}

async function loadWeather(stop: Stop): Promise<WeatherPoint[]> {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${stop.lat.toFixed(3)}&lon=${stop.lon.toFixed(3)}`;
  // MET asks every client to identify itself with a User-Agent.
  const r = await fetch(url, { headers: { "User-Agent": `${CLIENT} github.com/morgenpiloten` } });
  if (!r.ok) throw new Error("MET svarte " + r.status);
  const j = await r.json();
  return j.properties.timeseries.map((s: any) => ({
    time: new Date(s.time),
    temp: s.data.instant.details.air_temperature,
    precip:
      s.data.next_1_hours?.details.precipitation_amount ??
      (s.data.next_6_hours ? s.data.next_6_hours.details.precipitation_amount / 6 : 0),
  }));
}
