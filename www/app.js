/* 首页 + 列表 + 模型库（从后端拉取） */
const $ = (s) => document.querySelector(s);
const viewer = $('#viewer');
const nameEl = $('#model-name');
const descEl = $('#model-desc');
const arBtn = $('#ar-btn');
const arHint = $('#ar-hint');
const listEl = $('#model-list');

/* 模型库服务器地址（可在列表页修改并保存） */
let SERVER = (localStorage.getItem('serverUrl') || 'http://192.168.0.102:8000').replace(/\/+$/, '');
let serverModels = [];
function allModels() { return MODELS.concat(serverModels); }

let currentId = MODELS[0].id;

/* 视图切换 */
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('view--active'));
  $(name === 'list' ? '#view-list' : '#view-home').classList.add('view--active');
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.go)));

/* 加载模型到首页预览 */
function loadModel(id) {
  const m = allModels().find((x) => x.id === id);
  if (!m) return;
  currentId = id;
  viewer.src = m.glb;
  nameEl.textContent = m.name;
  descEl.textContent = m.desc || '';
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('card--current', c.dataset.id === id));
}

/* 开启 AR：调起 Scene Viewer（ARCore 真地面，可环绕；需联网/VPN） */
arBtn.addEventListener('click', () => {
  const m = allModels().find((x) => x.id === currentId);
  if (!m) return;
  const url = m.remote || (/^https?:/i.test(m.glb || '') ? m.glb : null);
  if (!url) {
    arHint.textContent = '⚠️ 此模型为本地内置无网络地址，请用「模型库」里的模型（它们有地址）。';
    return;
  }
  if (window.AndroidAR && window.AndroidAR.nativeAR) {
    window.AndroidAR.nativeAR(url, m.name);   // 原生 ARCore 相机放置
  } else {
    arHint.textContent = '原生 AR 接口不可用（请在 APP 内打开）。';
  }
});

viewer.addEventListener('load', () => {
  arBtn.disabled = false;
  arHint.textContent = '点击进入 AR（原生 ARCore：开相机→识别地面→点击放置，可环绕；免 VPN）。';
});

/* 列表渲染（内置 + 模型库） */
function makeThumb(m) {
  const t = document.createElement('model-viewer');
  t.className = 'card__thumb';
  t.setAttribute('src', m.glb);
  t.setAttribute('camera-controls', '');
  t.setAttribute('auto-rotate', '');
  t.setAttribute('disable-zoom', '');
  t.setAttribute('interaction-prompt', 'none');
  t.setAttribute('loading', 'lazy');
  t.setAttribute('shadow-intensity', '0.6');
  return t;
}
function renderList() {
  listEl.innerHTML = '';
  allModels().forEach((m) => {
    const card = document.createElement('div');
    card.className = 'card' + (m.id === currentId ? ' card--current' : '');
    card.dataset.id = m.id;
    card.appendChild(makeThumb(m));
    const body = document.createElement('div');
    body.className = 'card__body';
    body.innerHTML =
      '<div class="card__name">' + m.name + (m.fromServer ? ' <span class="tag">库</span>' : '') + '</div>' +
      '<div class="card__desc">' + (m.desc || '') + '</div>';
    card.appendChild(body);
    card.addEventListener('click', () => { loadModel(m.id); showView('home'); });
    listEl.appendChild(card);
  });
}

/* 从后端拉取模型库 */
async function loadLibrary() {
  const status = $('#lib-status');
  if (status) status.textContent = '连接模型库…';
  try {
    const items = await (await fetch(SERVER + '/api/models')).json();
    serverModels = items.map((m) => ({
      id: 'srv_' + m.id,
      name: m.name,
      desc: '模型库 · ' + (m.size / 1048576).toFixed(1) + ' MB',
      glb: SERVER + '/library/' + m.file,
      remote: SERVER + '/library/' + m.file,
      ar: { autofit: 1.6, rot: '0 0 0' },
      fromServer: true,
    }));
    if (status) status.textContent = '✅ 模型库：' + serverModels.length + ' 个（' + SERVER + '）';
  } catch (e) {
    serverModels = [];
    if (status) status.textContent = '⚠️ 连不上模型库：' + SERVER;
  }
  renderList();
}

/* 模型库地址设置 */
const urlInput = $('#server-url');
if (urlInput) {
  urlInput.value = SERVER;
  $('#save-server').addEventListener('click', () => {
    SERVER = urlInput.value.trim().replace(/\/+$/, '');
    localStorage.setItem('serverUrl', SERVER);
    loadLibrary();
  });
}
const refreshBtn = $('#refresh-lib');
if (refreshBtn) refreshBtn.addEventListener('click', loadLibrary);

/* 启动 */
renderList();
loadModel(currentId);
loadLibrary();
