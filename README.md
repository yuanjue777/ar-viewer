# AR 模型投影 App

把 3D 模型以 AR 形式投射到现实中，模型**站在地面上、不会乱动**（地面锚定由系统
ARCore / ARKit 完成）。

- **第一页**：模型预览 + 「开启 AR」按钮
- **第二页**：模型列表，点选后回到首页加载该模型

## 技术说明

纯静态网页，**零构建、零 npm 安装**。核心是 Google 的
[`<model-viewer>`](https://modelviewer.dev/) 组件，通过 CDN 引入：

- 安卓：调用 **Scene Viewer (ARCore)**
- iOS：调用 **AR Quick Look (ARKit)**
- 支持 WebXR 的浏览器：走 **WebXR**

`ar-placement="floor"` 让模型放在检测到的地面上，原生平面追踪保证它钉在原地不漂移。

## 文件

| 文件 | 作用 |
|------|------|
| `index.html` | 页面结构（两个视图） |
| `styles.css` | 移动端样式 |
| `app.js` | 模型目录 + 页面逻辑 + AR 触发 |

## 运行

### 桌面预览（只看模型，不能 AR）
直接用浏览器打开 `index.html` 即可旋转查看模型。
> ⚠️ AR 是手机功能，电脑上没有「开启 AR」效果，只能预览 3D。

### 手机上体验 AR（需要 HTTPS）
WebXR / AR 需要**安全上下文 (HTTPS)**，几种方式任选其一：

1. **静态托管**（最简单）：把这几个文件传到 GitHub Pages / Netlify / Vercel，
   手机浏览器打开链接即可。
2. **本地 + 内网穿透**：本机起静态服务器再用 ngrok/localtunnel 暴露成 https。
   ```bash
   # 任选一个静态服务器
   npx serve .          # 或 python -m http.server 8080
   # 再开 https 隧道
   npx localtunnel --port 8080
   ```
   然后用**手机 Chrome(安卓) / Safari(iOS)** 打开 https 链接 →「开启 AR」。

## 加自己的模型

把 `.glb` 文件放进本目录，编辑 `app.js` 顶部的 `MODELS` 数组加一条：

```js
{
  id: 'mychair',
  name: '我的椅子',
  desc: '一句话描述',
  glb: 'mychair.glb',     // 安卓 / WebXR
  usdz: 'mychair.usdz',   // 可选，iOS Quick Look 才需要
}
```

> iOS 的 AR Quick Look 只认 `.usdz`。只给 `.glb` 时，安卓能 AR，iOS 只能预览。
> 转换工具：Apple `usdzconvert`，或在线 glb→usdz 转换器。
