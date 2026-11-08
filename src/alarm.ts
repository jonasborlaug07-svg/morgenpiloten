// The alarm. Built with Xcode on iOS 26+, it's a real AlarmKit alarm that rings like the Clock app, also in silent mode.
// In Expo Go (or when the user says no) it's a series of local notifications, which follow silent mode.
import * as Notifications from "expo-notifications";
import { realAlarm } from "../modules/morgen-alarm";
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

// True when the alarms are real AlarmKit alarms.
export const usesRealAlarm = () => realAlarm?.authorizationStatus() === "authorized";

export async function ensurePermission(): Promise<boolean> {
  if (realAlarm && (await realAlarm.requestAuthorization().catch(() => "denied")) === "authorized") return true;
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } });
  return req.granted;
}

let lastKey = "";

// iOS keeps at most 64 pending notifications; a week of mornings with 5 repeats each fits.
const MAX_PENDING = 60;

// The most important reason first, short enough for the alarm screen.
const alarmTitle = (why: string) => why.split(" · ")[0] || "Morgenpiloten";

// Replace all scheduled alarms with these (one entry per morning; null = no alarm that day).
// Skips the work when nothing changed.
export async function scheduleAlarms(mornings: { wake: Date | null; why: string }[]): Promise<void> {
  const future = mornings.filter((m): m is { wake: Date; why: string } => !!m.wake && m.wake.getTime() > Date.now());
  const real = usesRealAlarm();
  const key = (real ? "alarm|" : "") + future.map(m => m.wake.toISOString() + m.why).join("|");
  if (key === lastKey) return;
  lastKey = key;
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (real) {
    await realAlarm!.replaceAll(future.map(m => m.wake.getTime()), future.map(m => alarmTitle(m.why)));
    return;
  }
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

// Whether alarms are allowed, without asking (for the background refresh).
export async function hasPermission(): Promise<boolean> {
  return usesRealAlarm() || (await Notifications.getPermissionsAsync()).granted;
}

// "Test alarmen": a real alarm rings in a few seconds; a notification rings at once.
export async function ringNow(why: string): Promise<void> {
  if (usesRealAlarm()) return realAlarm!.scheduleOne(Date.now() + 5000, alarmTitle(why));
  await Notifications.scheduleNotificationAsync({
    content: { title: "Morgenpiloten", body: why, sound: "default", interruptionLevel: "timeSensitive" },
    trigger: null,
  });
}
