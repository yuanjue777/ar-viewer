/* ===================================================================
 * AR 模型投影 App —— 纯静态，无构建
 * 第一页：模型 + 开启 AR    第二页：模型列表
 * AR 地面锚定由 model-viewer 调用系统 ARCore/ARKit 完成，模型钉在地面不乱动。
 * =================================================================== */

// 模型目录。glb = 通用格式(安卓/WebXR)；usdz = iOS Quick Look 需要。
// 想加自己的模型：把 .glb 放进同目录，按下面格式加一条即可。
const MODELS = [
  {
    id: 'astronaut',
    name: '宇航员',
    desc: 'NASA 宇航员，约真人大小',
    glb: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb',
    usdz: 'https://modelviewer.dev/shared-assets/models/Astronaut.usdz',
  },
  {
    id: 'robot',
    name: '机器人',
    desc: '可动画的卡通机器人',
    glb: 'https://modelviewer.dev/shared-assets/models/RobotExpressive.glb',
  },
  {
    id: 'horse',
    name: '马',
    desc: '低多边形奔马',
    glb: 'https://modelviewer.dev/shared-assets/models/Horse.glb',
  },
  {
    id: 'shishkebab',
    name: '烤串',
    desc: '经典烧烤串',
    glb: 'https://modelviewer.dev/shared-assets/models/shishkebab.glb',
    usdz: 'https://modelviewer.dev/shared-assets/models/shishkebab.usdz',
  },
  {
    id: 'shoe',
    name: '运动鞋',
    desc: '可换配色的运动鞋',
    glb: 'https://modelviewer.dev/shared-assets/models/MaterialsVariantsShoe.glb',
  },
  {
    id: 'neil',
    name: '复古宇航员',
    desc: '低模复古风宇航员',
    glb: 'https://modelviewer.dev/shared-assets/models/NeilArmstrong.glb',
  },
];

const $ = (sel) => document.querySelector(sel);

const viewer    = $('#viewer');
const nameEl    = $('#model-name');
const descEl    = $('#model-desc');
const arBtn     = $('#ar-btn');
const arHint    = $('#ar-hint');
const listEl    = $('#model-list');

let currentId = MODELS[0].id;

// 是否运行在 Capacitor 原生 APK 中（浏览器里为 false）
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

/* ---------- 视图切换 ---------- */
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('view--active'));
  $(name === 'list' ? '#view-list' : '#view-home').classList.add('view--active');
}

document.querySelectorAll('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.go));
});

/* ---------- 加载某个模型到首页 ---------- */
function loadModel(id) {
  const m = MODELS.find((x) => x.id === id);
  if (!m) return;
  currentId = id;

  viewer.src = m.glb;
  if (m.usdz) viewer.setAttribute('ios-src', m.usdz);
  else viewer.removeAttribute('ios-src');

  nameEl.textContent = m.name;
  descEl.textContent = m.desc;
  arHint.textContent = '';

  // 同步列表里的高亮
  document.querySelectorAll('.card').forEach((c) =>
    c.classList.toggle('card--current', c.dataset.id === id)
  );
}

/* ---------- 开启 AR ---------- */
async function launchAR() {
  const m = MODELS.find((x) => x.id === currentId);
  if (!m) return;
  // 原生 APK：调起 Google Scene Viewer（系统级 AR，地面锚定最稳）
  if (isNative) {
    const url =
      'https://arvr.google.com/scene-viewer/1.0?file=' + encodeURIComponent(m.glb) +
      '&mode=ar_preferred&title=' + encodeURIComponent(m.name) + '&resizable=false';
    try {
      await window.Capacitor.Plugins.Browser.open({ url });
      arHint.textContent = '已调起 AR，请把手机对准地面。';
    } catch (e) {
      arHint.textContent = '调起 AR 失败：' + (e && e.message ? e.message : e);
    }
    return;
  }
  // 浏览器：用 model-viewer 内置 AR
  if (viewer.canActivateAR) {
    viewer.activateAR();
  } else {
    arHint.textContent = '当前设备/浏览器不支持 AR，请用手机的 Chrome(安卓) 或 Safari(iOS) 打开。';
  }
}

arBtn.addEventListener('click', launchAR);

// 模型加载完后，根据设备能力更新按钮状态
viewer.addEventListener('load', () => {
  arBtn.disabled = false;
  arBtn.textContent = '开启 AR';
  if (isNative || viewer.canActivateAR) {
    arHint.textContent = '点击后把手机对准地面，模型会站在地面上。';
  } else {
    arHint.textContent = '提示：AR 需在手机上打开（安卓 Chrome / iPhone Safari）。';
  }
});

// AR 会话状态反馈
viewer.addEventListener('ar-status', (e) => {
  const map = {
    'session-started': '已进入 AR，移动手机扫描地面…',
    'object-placed': '模型已放置在地面 ✓',
    'not-presenting': '',
    'failed': 'AR 启动失败，请重试或检查相机权限。',
  };
  if (map[e.detail.status] !== undefined) arHint.textContent = map[e.detail.status];
});

/* ---------- 渲染模型列表（第二页） ---------- */
function renderList() {
  listEl.innerHTML = '';
  MODELS.forEach((m) => {
    const card = document.createElement('div');
    card.className = 'card' + (m.id === currentId ? ' card--current' : '');
    card.dataset.id = m.id;

    const thumb = document.createElement('model-viewer');
    thumb.className = 'card__thumb';
    thumb.setAttribute('src', m.glb);
    thumb.setAttribute('camera-controls', '');
    thumb.setAttribute('auto-rotate', '');
    thumb.setAttribute('disable-zoom', '');
    thumb.setAttribute('interaction-prompt', 'none');
    thumb.setAttribute('shadow-intensity', '0.6');
    thumb.setAttribute('loading', 'lazy');

    const body = document.createElement('div');
    body.className = 'card__body';
    body.innerHTML =
      `<div class="card__name">${m.name}</div>` +
      `<div class="card__desc">${m.desc}</div>` +
      (m.usdz ? `<span class="card__badge">iOS AR ✓</span>` : '');

    card.appendChild(thumb);
    card.appendChild(body);
    card.addEventListener('click', () => {
      loadModel(m.id);
      showView('home');
    });
    listEl.appendChild(card);
  });
}

/* ---------- 启动 ---------- */
renderList();
loadModel(currentId);
