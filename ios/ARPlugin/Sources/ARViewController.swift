import UIKit
import ARKit
import SceneKit
import GLTFSceneKit

/// 原生 ARKit 放置页：扫描地面 -> 屏幕中心出现模型虚像 -> 点「放置」固定 -> 可绕行/缩放。
class ARViewController: UIViewController, ARSCNViewDelegate {

    var modelURL: String = ""
    var modelName: String = ""

    private let sceneView = ARSCNView()
    private let coaching = ARCoachingOverlayView()
    private let placeButton = UIButton(type: .system)
    private let hintLabel = UILabel()

    private var modelTemplate: SCNNode?
    private var ghostNode: SCNNode?
    private var placedNode: SCNNode?
    private var modelLoaded = false
    private var placeReady = false
    private var viewCenter = CGPoint.zero

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupScene()
        setupUI()
        loadModel()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        viewCenter = CGPoint(x: sceneView.bounds.midX, y: sceneView.bounds.midY)
    }

    private func setupScene() {
        sceneView.frame = view.bounds
        sceneView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        sceneView.delegate = self
        sceneView.automaticallyUpdatesLighting = true
        sceneView.autoenablesDefaultLighting = true
        view.addSubview(sceneView)

        coaching.frame = view.bounds
        coaching.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        coaching.session = sceneView.session
        coaching.goal = .horizontalPlane
        coaching.activatesAutomatically = true
        sceneView.addSubview(coaching)

        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        sceneView.addGestureRecognizer(pinch)
        let rotate = UIRotationGestureRecognizer(target: self, action: #selector(handleRotate(_:)))
        sceneView.addGestureRecognizer(rotate)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        guard ARWorldTrackingConfiguration.isSupported else {
            hintLabel.text = "此设备不支持 ARKit"
            return
        }
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal]
        config.environmentTexturing = .automatic
        sceneView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
    }

    private func setupUI() {
        let close = UIButton(type: .system)
        close.setTitle("✕ 返回", for: .normal)
        close.setTitleColor(.white, for: .normal)
        close.backgroundColor = UIColor(white: 0, alpha: 0.5)
        close.layer.cornerRadius = 18
        close.frame = CGRect(x: 16, y: 52, width: 88, height: 36)
        close.autoresizingMask = [.flexibleRightMargin, .flexibleBottomMargin]
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(close)

        hintLabel.text = "移动手机扫描地面…"
        hintLabel.textColor = .white
        hintLabel.textAlignment = .center
        hintLabel.font = .systemFont(ofSize: 14)
        hintLabel.numberOfLines = 2
        hintLabel.frame = CGRect(x: 20, y: view.bounds.height - 160,
                                 width: view.bounds.width - 40, height: 44)
        hintLabel.autoresizingMask = [.flexibleWidth, .flexibleTopMargin]
        view.addSubview(hintLabel)

        placeButton.setTitle("放置", for: .normal)
        placeButton.setTitleColor(.white, for: .normal)
        placeButton.titleLabel?.font = .boldSystemFont(ofSize: 18)
        placeButton.backgroundColor = UIColor(red: 0.31, green: 0.49, blue: 1, alpha: 1)
        placeButton.layer.cornerRadius = 28
        placeButton.frame = CGRect(x: (view.bounds.width - 160) / 2, y: view.bounds.height - 104,
                                   width: 160, height: 56)
        placeButton.autoresizingMask = [.flexibleTopMargin, .flexibleLeftMargin, .flexibleRightMargin]
        placeButton.addTarget(self, action: #selector(placeTapped), for: .touchUpInside)
        placeButton.isEnabled = false
        placeButton.alpha = 0.4
        view.addSubview(placeButton)
    }

    private func loadModel() {
        guard let url = URL(string: modelURL) else {
            hintLabel.text = "模型地址无效"; return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let data = try Data(contentsOf: url)
                let tmp = FileManager.default.temporaryDirectory
                    .appendingPathComponent("model_\(UUID().uuidString).glb")
                try data.write(to: tmp)
                let source = try GLTFSceneSource(url: tmp)
                let scene = try source.scene()
                let container = SCNNode()
                for child in scene.rootNode.childNodes { container.addChildNode(child) }
                // 尝试归一化到约 0.5m 高（拿不到包围盒就保持原始大小，可手势缩放）
                let (minB, maxB) = container.boundingBox
                let h = maxB.y - minB.y
                if h > 0.01 && h < 100000 {
                    let s = 0.5 / h
                    container.scale = SCNVector3(s, s, s)
                }
                DispatchQueue.main.async {
                    self.modelTemplate = container
                    self.modelLoaded = true
                    self.makeGhost()
                    self.hintLabel.text = "移动手机扫描地面…"
                }
            } catch {
                DispatchQueue.main.async { self.hintLabel.text = "模型加载失败：\(error.localizedDescription)" }
            }
        }
    }

    private func makeGhost() {
        guard let t = modelTemplate else { return }
        let ghost = t.clone()
        ghost.opacity = 0.45
        ghost.isHidden = true
        sceneView.scene.rootNode.addChildNode(ghost)
        ghostNode = ghost
    }

    // 每帧把虚像放到屏幕中心射线与地面的交点
    func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
        guard modelLoaded, placedNode == nil, let ghost = ghostNode else { return }
        guard let query = sceneView.raycastQuery(from: viewCenter,
                                                 allowing: .estimatedPlane,
                                                 alignment: .horizontal) else { return }
        let results = sceneView.session.raycast(query)
        if let r = results.first {
            let c = r.worldTransform.columns.3
            ghost.simdWorldPosition = simd_float3(c.x, c.y, c.z)
            if ghost.isHidden { ghost.isHidden = false }
            if !placeReady {
                placeReady = true
                DispatchQueue.main.async {
                    self.placeButton.isEnabled = true
                    self.placeButton.alpha = 1
                    self.hintLabel.text = "对准位置，点「放置」"
                }
            }
        } else if !ghost.isHidden {
            ghost.isHidden = true
        }
    }

    @objc private func placeTapped() {
        guard let ghost = ghostNode, let template = modelTemplate, !ghost.isHidden else { return }
        let node = template.clone()
        node.opacity = 1
        node.simdWorldTransform = ghost.simdWorldTransform
        sceneView.scene.rootNode.addChildNode(node)
        placedNode = node
        ghost.isHidden = true
        placeButton.isHidden = true
        coaching.setActive(false, animated: true)
        hintLabel.text = "\(modelName) 已放置 ✓ 绕着走查看 · 双指缩放/旋转"
    }

    @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
        let target = placedNode ?? ghostNode
        guard let node = target, g.state == .changed else { return }
        let s = Float(g.scale)
        node.scale = SCNVector3(node.scale.x * s, node.scale.y * s, node.scale.z * s)
        g.scale = 1
    }

    @objc private func handleRotate(_ g: UIRotationGestureRecognizer) {
        let target = placedNode ?? ghostNode
        guard let node = target, g.state == .changed else { return }
        node.eulerAngles.y -= Float(g.rotation)
        g.rotation = 0
    }

    @objc private func closeTapped() { dismiss(animated: true) }
}
