/* 模型目录（首页/列表 与 AR 共用）。
 * glb   ：本地路径（打包进 APK，供首页 3D 预览，离线可用）
 * remote：公网地址（jsdelivr，国内可访问）。Scene Viewer 是独立 app，
 *         读不到 APK 内的本地文件，所以地面 AR 用这个公网地址。 */
const KH = 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0';
const MODELS = [
  { id: 'genshin', name: '原神模型',  desc: '原神开源角色模型',
    glb: 'models/genshin.glb',       ar: { autofit: 1.6, rot: '0 0 0' } },
  { id: 'duck',    name: '小黄鸭',   desc: '经典 glTF 小黄鸭',
    glb: 'models/Duck.glb',          remote: KH + '/Duck/glTF-Binary/Duck.glb' },
  { id: 'helmet',  name: '损坏头盔', desc: '高精度 PBR 头盔',
    glb: 'models/DamagedHelmet.glb', remote: KH + '/DamagedHelmet/glTF-Binary/DamagedHelmet.glb' },
  { id: 'avocado', name: '牛油果',   desc: '写实牛油果',
    glb: 'models/Avocado.glb',       remote: KH + '/Avocado/glTF-Binary/Avocado.glb' },
  { id: 'fox',     name: '狐狸',     desc: '带奔跑动画的狐狸',
    glb: 'models/Fox.glb',           remote: KH + '/Fox/glTF-Binary/Fox.glb' },
  { id: 'cesium',  name: '行走的人', desc: '带行走动画的人',
    glb: 'models/CesiumMan.glb',     remote: KH + '/CesiumMan/glTF-Binary/CesiumMan.glb' },
];
