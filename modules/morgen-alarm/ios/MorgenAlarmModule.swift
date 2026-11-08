// Real alarms with AlarmKit (iOS 26+): they ring like the Clock app, also in silent mode.
// The JS side falls back to notifications when this module is missing (Expo Go) or not allowed.
import ExpoModulesCore
import Foundation
#if canImport(AlarmKit)
import AlarmKit
import SwiftUI

@available(iOS 26.0, *)
struct MorgenMetadata: AlarmMetadata {}
#endif

public class MorgenAlarmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MorgenAlarm")

    // Whether this iPhone can use AlarmKit at all.
    Function("isAvailable") { () -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return true }
      #endif
      return false
    }

    // "authorized", "denied", "notDetermined" or "unavailable", without asking.
    Function("authorizationStatus") { () -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return Self.describe(AlarmManager.shared.authorizationState) }
      #endif
      return "unavailable"
    }

    AsyncFunction("requestAuthorization") { () async throws -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return Self.describe(try await AlarmManager.shared.requestAuthorization()) }
      #endif
      return "unavailable"
    }

    // Replaces every alarm this app has with one per time (milliseconds since 1970), each with its title.
    AsyncFunction("replaceAll") { (times: [Double], titles: [String]) async throws -> Int in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let manager = AlarmManager.shared
        for alarm in try manager.alarms { try? manager.cancel(id: alarm.id) }
        var count = 0
        for (i, ms) in times.enumerated() {
          let date = Date(timeIntervalSince1970: ms / 1000)
          if date <= Date() { continue }
          _ = try await manager.schedule(id: UUID(), configuration: Self.configuration(at: date, title: i < titles.count ? titles[i] : "Morgenpiloten"))
          count += 1
        }
        return count
      }
      #endif
      return 0
    }

    // One extra alarm without touching the others, for "Test alarmen".
    AsyncFunction("scheduleOne") { (ms: Double, title: String) async throws in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let date = Date(timeIntervalSince1970: ms / 1000)
        _ = try await AlarmManager.shared.schedule(id: UUID(), configuration: Self.configuration(at: date, title: title))
      }
      #endif
    }

    AsyncFunction("cancelAll") { () throws in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        for alarm in try AlarmManager.shared.alarms { try? AlarmManager.shared.cancel(id: alarm.id) }
      }
      #endif
    }

    // Times (milliseconds since 1970) of the alarms that are waiting, for checking on the phone.
    Function("scheduledTimes") { () -> [Double] in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        return ((try? AlarmManager.shared.alarms) ?? []).compactMap { alarm in
          if case .fixed(let date)? = alarm.schedule { return date.timeIntervalSince1970 * 1000 }
          return nil
        }
      }
      #endif
      return []
    }
  }

  #if canImport(AlarmKit)
  @available(iOS 26.0, *)
  private static func describe(_ state: AlarmManager.AuthorizationState) -> String {
    switch state {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "notDetermined"
    }
  }

  @available(iOS 26.0, *)
  private static func configuration(at date: Date, title: String) -> AlarmManager.AlarmConfiguration<MorgenMetadata> {
    let text = LocalizedStringResource(stringLiteral: title)
    let alert: AlarmPresentation.Alert
    if #available(iOS 26.1, *) {
      alert = AlarmPresentation.Alert(title: text)
    } else {
      alert = AlarmPresentation.Alert(title: text, stopButton: AlarmButton(text: "Stopp", textColor: .white, systemImageName: "stop.circle"))
    }
    let attributes = AlarmAttributes<MorgenMetadata>(presentation: AlarmPresentation(alert: alert), metadata: MorgenMetadata(), tintColor: .orange)
    return .alarm(schedule: .fixed(date), attributes: attributes)
  }
  #endif
}
