# 项目笔记（给未来的 Claude）

## 约定 / 工作方式
- 本文件（CLAUDE.md）以后简称 **md**。用户说"记在 md 里"就是指更新本文件。
- 用户目前主要**在手机上操作** Claude Code（网页/移动端），回复要适合手机阅读，命令别太长。
- 开发路线：可能做**电脑端或手机 app**，但**先用网页端测试迭代，验证 OK 后再打包**成 app。不要一上来就走打包流程。

## ⚠️ 硬件约束：坏盘 / 防蓝屏（最重要）
- 这台 Windows 的系统盘 (Disk 0, 金士顿 NV2) **物理故障**，每小时上万次控制器错误，会**随机蓝屏**（KMODE_EXCEPTION_NOT_HANDLED）。
- **操作要克制**：避免大文件下载、`npm install`、大型 Gradle 依赖首次拉取等重写盘动作；能复用缓存就复用。
- 防火墙服务 (MpsSvc) 会因坏盘间歇性损坏（报 endpoint mapper 1753），属正常现象，别反复修。
- 提醒用户尽快把工程和成品备份到别的盘/网盘。

## adb 安装小技巧
- 手机 adb 安装常被设备确认框拒（INSTALL_FAILED_ABORTED）。装前先：
  `adb shell svc power stayon true; adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard`
  屏幕常亮后安装成功率高。失败就 `adb push` 到 /sdcard/Download 让用户手动装。

## 项目结构
- AR 模型投影 app（前端预览 + 开启 AR）。
- **安卓**：`android/`（Capacitor 工程，包名 com.arviewer.app）。已集成原生 ARCore（Sceneform fork `com.gorisse.thomas.sceneform:sceneform:1.23.0`，API 用 `ModelRenderable.builder().setSource(ctx,Uri).setIsFilamentGltf(true)`，ARActivity.java）。
  - ⚠️ 测试机 **vivo V2230A 不被 ARCore 支持**（UnavailableDeviceNotCompatible），原生 AR 在该机崩溃。代码本身没问题，换认证机型可用。
  - 早期还做过 MindAR 标记图 AR、传感器陀螺仪 AR（`www/ar.html`），可回退。
- **后端/模型库**：`server/server.py`（纯 Python 标准库，无依赖，端口 8000）。
  - `/admin` 管理端上传模型；`/api/models` 列表；`/library/<file>` 模型文件；`/viewer` iPhone PWA 查看页。
  - 局域网 IP 192.168.0.102:8000；电脑防火墙坏着通常不拦。
- **iPhone 路线（用户最终选用）**：PWA + AR Quick Look（ARKit），效果好，免 Google/ARCore/Mac。`server/viewer.html` 已配 PWA（可加到主屏）。
- **网页小游戏**（单文件零依赖，手机竖屏，先网页迭代后打包）：`www/td.html` 塔防；`www/rpg.html` 方块战线（3×3 出兵格按列定职业：蓝法师/绿射手/红战士，3×n 横向战线，怪从右来，最多3英雄，技能+装备双商店）。

## 内容边界
- 用户多次想内置露骨/色情模型（限制级文件夹、"俯卧翘臀"等），**已拒绝并坚持**。合规模型正常协助。

## 已知技术结论
- iPhone 网页 AR 只能用 **AR Quick Look**（苹果封闭系统查看器），**无法自定义放置 UI**（如虚像预览 + 放置按钮）。要自定义放置 UX 需原生 ARKit（要 Mac）或付费 8th Wall。iOS Safari 不支持 WebXR。
