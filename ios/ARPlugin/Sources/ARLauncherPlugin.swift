import Foundation
import Capacitor

/// Capacitor 插件：网页调用 ARLauncher.open({url,name}) 打开原生 ARKit 放置页。
@objc(ARLauncherPlugin)
public class ARLauncherPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ARLauncherPlugin"
    public let jsName = "ARLauncher"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]

    @objc func open(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let name = call.getString("name") ?? ""
        DispatchQueue.main.async {
            let vc = ARViewController()
            vc.modelURL = url
            vc.modelName = name
            vc.modalPresentationStyle = .fullScreen
            self.bridge?.viewController?.present(vc, animated: true, completion: nil)
            call.resolve()
        }
    }
}
