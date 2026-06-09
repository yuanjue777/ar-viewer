# iOS 无 Mac 构建（Codemagic 云端 Mac）

## 你需要准备的账号（按顺序）
1. **苹果开发者账号** $99/年 —— https://developer.apple.com/programs/（审批可能 1–2 天，先办）
2. **Git 仓库** —— GitHub 或 Gitee 建一个**私有**仓库，把本工程推上去
3. **Codemagic 账号** —— https://codemagic.io 注册（免费额度 500 分钟/月），连接上面的 Git 仓库
4. **App Store Connect API 密钥** —— 在 https://appstoreconnect.apple.com → 用户和访问 → 集成/密钥 → 生成，
   下载 `.p8`，记下 Key ID、Issuer ID
5. iPhone 装 **TestFlight**（App Store 免费）—— 用来收构建好的 app

## Codemagic 里配置
- Teams → Integrations → **App Store Connect** 添加上一步的 API 密钥，命名（默认示例 `CodemagicApiKey`，
  与 `codemagic.yaml` 里的名字保持一致）
- 在 App Store Connect 里**注册 App**（Bundle ID `com.arviewer.app`），Codemagic 也能用 API 密钥自动注册

## 流程
推代码到 Git → Codemagic 自动用云端 Mac 构建签名 IPA → 自动上 TestFlight → iPhone 装上

## 里程碑
- **M1（先验证管线）**：构建当前 Capacitor app（网页 + AR Quick Look）→ 跑通 TestFlight 安装
- **M2（你要的自定义放置）**：在 iOS 端加一段**原生 Swift ARKit** 放置页（地面虚像 + 放置按钮），重构建

> 注：iOS 的 Swift AR 代码无法在 Windows 本地测试，只能靠云端构建 + 你在 iPhone 上反馈，迭代较慢。
