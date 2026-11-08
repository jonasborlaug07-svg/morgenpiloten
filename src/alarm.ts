// The alarm is a series of local notifications. Expo Go cannot use AlarmKit, so this follows silent mode.
import * as Notifications from "expo-notifications";
import { addMin, hm } from "./logic";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const REPEATS = 5; // one notification a minute, like snooze-less ringing

export async function ensurePermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } });
  return req.granted;
}

let lastKey = "";

// iOS keeps at most 64 pending notifications; a week of mornings with 5 repeats each fits.
const MAX_PENDING = 60;

// Replace all scheduled alarms with these (one entry per morning; null = no alarm that day).
// Skips the work when nothing changed.
export async function scheduleAlarms(mornings: { wake: Date | null; why: string }[]): Promise<void> {
  const future = mornings.filter((m): m is { wake: Date; why: string } => !!m.wake && m.wake.getTime() > Date.now());
  const key = future.map(m => m.wake.toISOString() + m.why).join("|");
  if (key === lastKey) return;
  lastKey = key;
  await Notifications.cancelAllScheduledNotificationsAsync();
  let count = 0;
  for (const m of future) {
    for (let i = 0; i < REPEATS && count < MAX_PENDING; i++, count++) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: i === 0 ? `God morgen – klokka er ${hm(m.wake)}` : "Morgenpiloten: på tide å stå opp",
          body: m.why,
          sound: "default",
          interruptionLevel: "timeSensitive",
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: addMin(m.wake, i) },
      });
    }
  }
}

// Whether notifications are allowed, without asking (for the background refresh).
export async function hasPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

export async function ringNow(why: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: "Morgenpiloten", body: why, sound: "default", interruptionLevel: "timeSensitive" },
    trigger: null,
  });
}
