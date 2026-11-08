// Real alarms with AlarmKit, when the app is built with Xcode for iOS 26 or later.
// In Expo Go the native part is missing, so `realAlarm` is null and the app uses notifications.
import { requireOptionalNativeModule } from "expo";

type MorgenAlarm = {
  isAvailable(): boolean;
  authorizationStatus(): "authorized" | "denied" | "notDetermined" | "unavailable";
  requestAuthorization(): Promise<"authorized" | "denied" | "notDetermined" | "unavailable">;
  replaceAll(times: number[], titles: string[]): Promise<number>;
  scheduleOne(time: number, title: string): Promise<void>;
  cancelAll(): Promise<void>;
  scheduledTimes(): number[];
};

const native = requireOptionalNativeModule<MorgenAlarm>("MorgenAlarm");

export const realAlarm: MorgenAlarm | null = native?.isAvailable() ? native : null;
