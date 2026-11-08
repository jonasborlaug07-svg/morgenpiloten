// Lets iOS wake the app now and then (often overnight while charging) to check Entur and the calendar
// and move the week's alarms. Must be imported before the app renders.
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { hasPermission, scheduleAlarms } from "./alarm";
import { loadPrefs } from "./prefs";
import { syncTrip } from "./server";
import { planWeek, whyText } from "./week";

const TASK = "morgenpiloten-refresh";
const NO_SCEN = { cancel: false, delay: false, snow: false, lecture: false };

TaskManager.defineTask(TASK, async () => {
  try {
    const prefs = await loadPrefs();
    if (!prefs.onboarded || !(await hasPermission())) return BackgroundTask.BackgroundTaskResult.Success;
    const { mornings, events } = await planWeek(prefs);
    await scheduleAlarms(mornings.map(m => ({ wake: m.decision.wake, why: whyText(m.decision) })));
    await syncTrip({ from: prefs.from, to: prefs.to, settings: prefs.settings, events, scenario: NO_SCEN }).catch(() => {});
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Ask iOS to run the refresh at most every 30 minutes; it decides when.
export async function registerBackgroundRefresh(): Promise<boolean> {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (!(await TaskManager.isTaskRegisteredAsync(TASK))) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 30 });
    return true;
  } catch {
    return false;
  }
}
