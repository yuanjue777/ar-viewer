Pod::Spec.new do |s|
  s.name             = 'ARPlugin'
  s.version          = '1.0.0'
  s.summary          = 'Native ARKit placement plugin for the AR viewer app'
  s.description      = 'Custom ARKit placement: detect plane, show ghost preview, tap button to place, walk around.'
  s.homepage         = 'https://example.com/arplugin'
  s.license          = { :type => 'MIT' }
  s.author           = { 'app' => 'app@example.com' }
  s.source           = { :git => 'https://example.com/arplugin.git', :tag => s.version.to_s }
  s.ios.deployment_target = '13.0'
  s.swift_version    = '5.0'
  s.source_files     = 'Sources/**/*.swift'
  s.dependency 'Capacitor'
  s.dependency 'GLTFSceneKit'
end
