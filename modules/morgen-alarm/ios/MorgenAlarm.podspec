Pod::Spec.new do |s|
  s.name           = 'MorgenAlarm'
  s.version        = '1.0.0'
  s.summary        = 'Real iOS alarms (AlarmKit) for Morgenpiloten'
  s.description    = 'Schedules and cancels AlarmKit alarms, which ring like the Clock app, also in silent mode.'
  s.license        = 'MIT'
  s.author         = 'Morgenpiloten'
  s.homepage       = 'https://github.com/morgenpiloten'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # AlarmKit only exists on iOS 26 and later; older systems fall back to notifications.
  s.weak_frameworks = 'AlarmKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
