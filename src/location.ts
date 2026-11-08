// "Use my position" for the home address.
import * as Location from "expo-location";
import { reversePlace, type Place } from "./api";

// Where the phone is now, without asking for permission. Null if not allowed or unknown.
export async function quietPosition(): Promise<{ lat: number; lon: number } | null> {
  try {
    if ((await Location.getForegroundPermissionsAsync()).status !== "granted") return null;
    const pos = await Location.getLastKnownPositionAsync({ maxAge: 15 * 60000 });
    return pos ? { lat: pos.coords.latitude, lon: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}

export async function currentPlace(): Promise<{ place: Place } | { error: string }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return { error: "Appen fikk ikke bruke posisjonen. Søk opp adressen din i stedet." };
    const pos =
      (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    const { latitude: lat, longitude: lon } = pos.coords;
    const place = await reversePlace(lat, lon);
    return { place: place ?? { id: `pos:${lat.toFixed(5)},${lon.toFixed(5)}`, name: "Hjemme", label: "Posisjonen din", lat, lon } };
  } catch {
    return { error: "Fant ikke posisjonen. Søk opp adressen din i stedet." };
  }
}
