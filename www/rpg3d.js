/* ============================================================
   rpg3d.js —— 方块战线 3D 渲染层（Three.js，俯视角）
   ------------------------------------------------------------
   坐标契约：游戏格子坐标 (x, y) → 世界坐标 (x, 高度, y)
             也就是 世界X=格子X，世界Z=格子Y，世界Y=离地高度
   对外只有三个入口：R3.resize() / R3.draw() / R3.pick(ev)
   逻辑层(rpg.js)不需要知道 3D 的任何事。
   ============================================================ */
const R3=(function(){
'use strict';
const T=THREE;
const PI=Math.PI, sin=Math.sin, cos=Math.cos, min=Math.min, max=Math.max, abs=Math.abs;

let ren,scene,cam,ocv,octx,inited=false;
let W=1,H=1,PR=1;                    // 覆盖层 CSS 尺寸 / 像素比
let dirLight,selGroup,frontier;
let shadowOn=true,ftAcc=0,ftN=0;     // 帧时统计（用于低端机自动降级）

/* 相机：正交投影。战场是 16×3 的超宽比例，用透视会把两端格子拉变形，
   正交则格子等大、战线清楚，立体感交给模型高度和阴影。 */
const TILT=55*PI/180;                // 俯角
const CAM_D=26;                      // 相机距离（正交下只影响裁剪，不影响大小）

/* ================= 几何 / 材质小工具 ================= */
const GEO={};
const g_box =(w,h,d)=>GEO['b'+w+'|'+h+'|'+d]||(GEO['b'+w+'|'+h+'|'+d]=new T.BoxGeometry(w,h,d));
const g_sph =(r,s)=>GEO['s'+r+'|'+(s||8)]||(GEO['s'+r+'|'+(s||8)]=new T.SphereGeometry(r,s||8,(s||8)>>1));
const g_cyl =(a,b,h,s)=>GEO['c'+a+'|'+b+'|'+h+'|'+(s||8)]||(GEO['c'+a+'|'+b+'|'+h+'|'+(s||8)]=new T.CylinderGeometry(a,b,h,s||8));
const g_cone=(r,h,s)=>GEO['n'+r+'|'+h+'|'+(s||7)]||(GEO['n'+r+'|'+h+'|'+(s||7)]=new T.ConeGeometry(r,h,s||7));
const g_oct =(r)=>GEO['o'+r]||(GEO['o'+r]=new T.OctahedronGeometry(r));
const g_tet =(r)=>GEO['t'+r]||(GEO['t'+r]=new T.TetrahedronGeometry(r));
const g_ring=(a,b)=>GEO['r'+a+'|'+b]||(GEO['r'+a+'|'+b]=new T.RingGeometry(a,b,28));
const g_disc=()=>GEO.disc||(GEO.disc=new T.CircleGeometry(1,28));
const g_torus=(arc)=>GEO['T'+arc]||(GEO['T'+arc]=new T.TorusGeometry(1,.055,6,20,arc));

/* 建组：userData 存材质与基础色，方便整体染色（受击闪白/死亡变灰/冰霜） */
function mk(){const g=new T.Group();g.userData={mats:[],base:[]};return g;}
function add(g,geo,color,x,y,z,o){
  o=o||{};
  const mtl=o.glow
    ? new T.MeshBasicMaterial({color,transparent:o.op!=null,opacity:o.op!=null?o.op:1})
    : new T.MeshLambertMaterial({color,transparent:o.op!=null,opacity:o.op!=null?o.op:1,
        emissive:o.em||0x000000});
  const m=new T.Mesh(geo,mtl);
  m.position.set(x,y,z);
  if(o.rx)m.rotation.x=o.rx;
  if(o.ry)m.rotation.y=o.ry;
  if(o.rz)m.rotation.z=o.rz;
  if(o.s)m.scale.set(o.s[0],o.s[1],o.s[2]);
  m.castShadow=!o.noSh;
  g.add(m);
  if(!o.glow&&!o.noTint){g.userData.mats.push(m);g.userData.base.push(new T.Color(color));}
  return m;
}
const _grey=new T.Color(0x39424f), _frost=new T.Color(0x9fe4ff);
function tint(g,flash,dead,frost){
  const u=g.userData,n=u.mats.length;
  for(let i=0;i<n;i++){
    const m=u.mats[i].material;
    m.emissive.setScalar(flash?.6:0);
    if(dead)m.color.copy(_grey);
    else if(frost)m.color.copy(u.base[i]).lerp(_frost,.45);
    else m.color.copy(u.base[i]);
  }
}

/* ================= 对象池（按 key 复用，避免每帧 new/GC） ================= */
const pools={},bound=new Map(),seen=new Set();
function bind(ent,key,make){
  let g=bound.get(ent);
  if(!g||g.userData.key!==key){
    if(g)free(g);
    const p=pools[key]||(pools[key]=[]);
    g=p.pop();
    if(!g){g=make();g.userData.key=key;scene.add(g);}
    bound.set(ent,g);
  }
  g.visible=true;seen.add(ent);
  return g;
}
function free(g){g.visible=false;(pools[g.userData.key]||(pools[g.userData.key]=[])).push(g);}
function sweep(){
  for(const [e,g] of bound)if(!seen.has(e)){free(g);bound.delete(e);}
  seen.clear();
}
/* 一次性用完即弃的（特效/弹道）：每帧计数取用，剩下的隐藏 */
const tmp={};
function take(key,make){
  let p=tmp[key];
  if(!p)p=tmp[key]={list:[],n:0};
  let o=p.list[p.n];
  if(!o){o=make();o.userData.key=key;scene.add(o);p.list.push(o);}
  p.n++;o.visible=true;
  return o;
}
function tmpReset(){for(const k in tmp)tmp[k].n=0;}
function tmpHide(){for(const k in tmp){const p=tmp[k];for(let i=p.n;i<p.list.length;i++)p.list[i].visible=false;}}

/* 把一个 z 轴长度为1的物体拉成从 A 到 B 的光束 */
const _a=new T.Vector3(),_b=new T.Vector3();
function beam(m,x1,y1,z1,x2,y2,z2,th){
  _a.set(x1,y1,z1);_b.set(x2,y2,z2);
  m.position.copy(_a).add(_b).multiplyScalar(.5);
  m.lookAt(_b);
  m.scale.set(th,th,max(_a.distanceTo(_b),.001));
}

/* ================= 单位模型 ================= */
/* 英雄：面向 +X（敌人从右来）。整体高约 0.95，宽约 0.5 */
function buildHero(cls){
  const g=mk(),c=CLASSES[cls].color;
  const dark=shade3(c,.55),lite=shade3(c,1.35);
  if(cls==='mage'){
    add(g,g_cone(.25,.56,10),c,0,.28,0);                       // 长袍
    add(g,g_cyl(.13,.16,.16,8),lite,0,.56,0);                  // 领口
    add(g,g_sph(.105,8),0xe8d3b0,0,.66,0);                     // 头
    add(g,g_cone(.17,.36,9),dark,0,.88,0);                     // 尖帽
    add(g,g_sph(.05,6),0xffe9a8,0,1.06,0,{glow:1});            // 帽尖
    const st=add(g,g_cyl(.022,.022,.9,6),0x8a6a44,.2,.45,.02,{rz:-.12});
    const orb=add(g,g_sph(.075,8),0x9fd4ff,.24,.93,.02,{glow:1});
    add(g,g_sph(.13,8),0x4fa8ff,.24,.93,.02,{glow:1,op:.28,noSh:1});
    g.userData.wep=st;g.userData.orb=orb;
  }else if(cls==='archer'){
    add(g,g_cone(.24,.5,9),dark,0,.25,0);                      // 披风
    add(g,g_cyl(.135,.155,.34,8),c,0,.42,0);                   // 身体
    add(g,g_sph(.1,8),0xe8d3b0,0,.63,0);                       // 头
    add(g,g_cone(.155,.28,8),c,0,.72,0);                       // 兜帽
    const bow=add(g,g_torus(2.3),0xb98a4e,.2,.5,0,{rx:PI/2,ry:0,s:[.24,.24,.24]});
    bow.rotation.set(0,-PI/2,0);bow.scale.set(.26,.26,.26);
    add(g,g_cyl(.05,.05,.26,6),0x6b4a2c,-.13,.55,.1,{rz:.5});  // 箭袋
    add(g,g_cone(.02,.1,5),0xd8c9a8,-.15,.7,.1,{rz:.5});
    g.userData.wep=bow;
  }else{
    add(g,g_box(.11,.24,.12),dark,-.02,.12,-.09);              // 腿
    add(g,g_box(.11,.24,.12),dark,-.02,.12,.09);
    add(g,g_box(.3,.34,.26),c,0,.41,0);                        // 胸甲
    add(g,g_sph(.1,7),lite,0,.53,-.16);                        // 护肩
    add(g,g_sph(.1,7),lite,0,.53,.16);
    add(g,g_box(.19,.17,.19),0xdbe6f3,0,.67,0);                // 头盔
    add(g,g_box(.05,.11,.16),0xf0c46a,.02,.78,0);              // 盔冠
    add(g,g_box(.05,.3,.26),0xb9c6d6,-.1,.45,-.24);            // 盾
    add(g,g_box(.03,.24,.2),shade3(c,.8),-.13,.45,-.24);
    const sw=mk();                                             // 剑（绕肩挥砍）
    add(sw,g_box(.045,.46,.09),0xe6eef8,0,.24,0);
    add(sw,g_box(.05,.05,.2),0xf0c46a,0,.02,0);
    sw.position.set(.1,.5,.22);
    g.add(sw);g.userData.mats.push(...sw.userData.mats);g.userData.base.push(...sw.userData.base);
    g.userData.wep=sw;
  }
  return g;
}
/* 怪物：面向 -X（往左推进）。单位空间半径≈1，绘制时按 m.r 缩放 */
function buildMob(type){
  const g=mk(),c=MOBS[type].color,dk=shade3(c,.55),lt=shade3(c,1.4);
  if(type==='normal'){                                          // 驼背小鬼
    add(g,g_cyl(.15,.18,.5,6),dk,.28,.25,-.3);
    add(g,g_cyl(.15,.18,.5,6),dk,.28,.25,.3);
    add(g,g_sph(.62,9),c,0,.92,0,{s:[1,.92,.88]});              // 躯干
    add(g,g_sph(.44,9),lt,-.22,1.6,0);                          // 头
    add(g,g_sph(.19,8),0xffffff,-.55,1.62,0,{glow:1});          // 大眼
    add(g,g_sph(.09,6),0x1a1020,-.68,1.62,0,{glow:1});
    add(g,g_cone(.1,.42,6),dk,.02,1.98,-.24,{rz:.3});           // 双角
    add(g,g_cone(.1,.42,6),dk,.02,1.98,.24,{rz:.3});
  }else if(type==='fast'){                                      // 前倾尖头
    add(g,g_cyl(.1,.12,.46,6),dk,.2,.23,-.2);
    add(g,g_cyl(.1,.12,.46,6),dk,.2,.23,.2);
    add(g,g_cone(.42,1.25,8),c,-.05,.95,0,{rz:PI/2});           // 锥体躯干朝 -X
    add(g,g_cone(.2,.5,7),lt,-.6,.95,0,{rz:PI/2});              // 尖头
    add(g,g_sph(.11,7),0xfff0c0,-.5,1.06,-.14,{glow:1});
    add(g,g_sph(.11,7),0xfff0c0,-.5,1.06,.14,{glow:1});
    add(g,g_box(.5,.05,.04),lt,.55,1.15,-.18,{op:.6});          // 速度鳍
    add(g,g_box(.5,.05,.04),lt,.55,1.15,.18,{op:.6});
  }else if(type==='tank'){                                      // 重甲方体
    add(g,g_box(.28,.5,.3),dk,.1,.25,-.34);
    add(g,g_box(.28,.5,.3),dk,.1,.25,.34);
    add(g,g_box(1.05,1,1.02),c,0,1.02,0);                       // 躯干
    add(g,g_box(.16,.72,.86),lt,-.5,1.02,0);                    // 前甲
    add(g,g_box(.66,.4,.68),0xcfd8e8,-.12,1.7,0);               // 头盔
    add(g,g_box(.5,.12,.16),0x22283a,-.42,1.66,0,{glow:1});     // 面甲缝
    for(let i=-1;i<2;i++)add(g,g_cone(.12,.34,5),0xcfd8e8,.3,1.62,i*.32);
    add(g,g_sph(.2,7),lt,-.2,1.42,-.56);                        // 护肩
    add(g,g_sph(.2,7),lt,-.2,1.42,.56);
  }else{                                                        // Boss 巨体恶魔
    add(g,g_cyl(.2,.26,.56,7),dk,.16,.28,-.36);
    add(g,g_cyl(.2,.26,.56,7),dk,.16,.28,.36);
    add(g,g_sph(.72,10),c,0,1.15,0,{s:[1,1.05,.92]});           // 躯干
    add(g,g_box(.5,.6,.8),dk,-.42,1.2,0);                       // 胸甲
    add(g,g_sph(.42,9),lt,-.25,2.02,0);                         // 头
    add(g,g_sph(.12,7),0xffe07a,-.55,2.06,-.17,{glow:1});       // 发光眼
    add(g,g_sph(.12,7),0xffe07a,-.55,2.06,.17,{glow:1});
    add(g,g_cone(.07,.34,6),0xf3f0e0,-.5,1.82,-.1,{rz:-1.9});   // 尖牙
    add(g,g_cone(.07,.34,6),0xf3f0e0,-.5,1.82,.1,{rz:-1.9});
    add(g,g_cone(.15,.72,6),0xe8e0d0,.02,2.35,-.3,{rz:.62});    // 弯角
    add(g,g_cone(.15,.72,6),0xe8e0d0,.02,2.35,.3,{rz:.62});
    add(g,g_sph(.26,7),lt,-.1,1.6,-.68);
    add(g,g_sph(.26,7),lt,-.1,1.6,.68);
  }
  return g;
}
/* 召唤物：单位空间半径≈1，按 MINIONS[kind].r 缩放 */
function buildMinion(kind){
  const g=mk(),c=MINIONS[kind].color,dk=shade3(c,.6),lt=shade3(c,1.4);
  if(kind==='bear'){
    for(const [x,z] of [[.4,-.34],[.4,.34],[-.3,-.34],[-.3,.34]])
      add(g,g_cyl(.19,.21,.45,6),dk,x,.22,z);
    add(g,g_sph(.62,9),c,.05,.85,0,{s:[1.2,.9,.95]});
    add(g,g_sph(.4,9),lt,-.68,1.02,0);
    add(g,g_sph(.16,6),dk,-.6,1.35,-.26);
    add(g,g_sph(.16,6),dk,-.6,1.35,.26);
    add(g,g_sph(.12,6),0x2a1a10,-1.02,.96,0,{glow:1});
  }else if(kind==='fire'){
    add(g,g_cone(.5,1.5,8),c,0,.72,0,{glow:1,op:.85});
    add(g,g_cone(.32,1,7),0xffc24d,0,1.05,0,{glow:1,op:.9});
    add(g,g_sph(.3,8),0xfff0b0,0,.62,0,{glow:1});
    add(g,g_cone(.16,.6,6),0xff8a3d,-.42,.85,.2,{glow:1,op:.7});
    add(g,g_cone(.16,.6,6),0xff8a3d,.42,.85,-.2,{glow:1,op:.7});
  }else if(kind==='water'){
    add(g,g_sph(.6,10),c,0,.72,0,{op:.62,s:[1,1.15,1]});
    add(g,g_sph(.38,9),lt,0,1.45,0,{op:.7});
    add(g,g_sph(.13,7),0xffffff,-.3,1.5,-.14,{glow:1});
    add(g,g_sph(.13,7),0xffffff,-.3,1.5,.14,{glow:1});
    add(g,g_sph(.26,8),lt,-.5,.7,0,{op:.5});
    add(g,g_sph(.26,8),lt,.5,.7,0,{op:.5});
  }else{                                                        // 地狱火
    add(g,g_cyl(.26,.3,.6,6),0x3a2a26,.2,.3,-.36);
    add(g,g_cyl(.26,.3,.6,6),0x3a2a26,.2,.3,.36);
    add(g,g_oct(.85),0x4a3330,0,1.2,0,{s:[.95,1.1,.9]});        // 岩石躯干
    add(g,g_sph(.42,8),0x3a2a26,-.3,2,0);
    add(g,g_sph(.16,7),c,-.6,2.02,-.18,{glow:1});               // 熔岩眼
    add(g,g_sph(.16,7),c,-.6,2.02,.18,{glow:1});
    add(g,g_box(.12,.5,.12),c,-.4,1.25,-.5,{glow:1,op:.85});    // 裂缝
    add(g,g_box(.12,.44,.12),c,.3,1.35,.48,{glow:1,op:.85});
    add(g,g_sph(.3,7),0x4a3330,-.15,1.75,-.75);
    add(g,g_sph(.3,7),0x4a3330,-.15,1.75,.75);
  }
  return g;
}
function buildChest(){
  const g=mk();
  add(g,g_box(.4,.24,.3),0x6b4a2c,0,.12,0);
  add(g,g_box(.42,.16,.32),0x8a5f38,0,.3,0);
  add(g,g_box(.44,.05,.06),0xf0c46a,0,.24,0);
  add(g,g_box(.06,.05,.34),0xf0c46a,0,.3,0);
  add(g,g_sph(.05,6),0xffe9a8,-.21,.24,0,{glow:1});
  add(g,g_disc(),0xf0c46a,0,.02,0,{rx:-PI/2,glow:1,op:.22,noSh:1,s:[.5,.5,.5]});
  return g;
}
function buildShot(kind){
  const g=mk();
  if(kind==='orb'){
    add(g,g_sph(.085,8),0xcfe6ff,0,0,0,{glow:1});
    add(g,g_sph(.17,8),0x4f8dff,0,0,0,{glow:1,op:.32,noSh:1});
    add(g,g_cone(.1,.34,6),0x4f8dff,-.17,0,0,{rz:PI/2,glow:1,op:.3,noSh:1});
  }else{
    add(g,g_cyl(.018,.018,.34,5),0xd8c9a8,-.03,0,0,{rz:PI/2});
    add(g,g_cone(.045,.12,5),0xdfe8f5,.18,0,0,{rz:-PI/2});
    add(g,g_box(.09,.06,.005),0xc8d4e4,-.2,.03,0,{op:.9});
    add(g,g_box(.09,.005,.06),0xc8d4e4,-.2,0,.03,{op:.9});
  }
  return g;
}
/* 色阶（3D 层自带一份，rpg.js 不再需要 shade） */
function shade3(hex,f){
  const n=parseInt(hex.slice(1),16);
  const r=min(255,(n>>16)*f)|0,g=min(255,(n>>8&255)*f)|0,b=min(255,(n&255)*f)|0;
  return (r<<16)|(g<<8)|b;
}

/* ================= 初始化 ================= */
/* ================= 程序化贴图（不用任何外部图片，Artifact 的 CSP 也不许外链） ================= */
let _sd=12345;
function srand(){_sd=(_sd*1664525+1013904223)&0x7fffffff;return _sd/0x7fffffff;}
function makeTex(size,fn,rep){
  const c=document.createElement('canvas');c.width=c.height=size;
  fn(c.getContext('2d'),size);
  const t=new T.CanvasTexture(c);
  t.wrapS=t.wrapT=T.RepeatWrapping;
  if(rep)t.repeat.set(rep[0],rep[1]);
  t.colorSpace=T.SRGBColorSpace;
  return t;
}
/* 草地：暗绿基底 + 噪点 + 草簇斑块。四角重画保证无缝平铺 */
function texGrass(){
  return makeTex(256,(x,S)=>{
    x.fillStyle='#16251c';x.fillRect(0,0,S,S);
    const blob=(px,py,r,col,a)=>{
      x.globalAlpha=a;
      for(let dx=-1;dx<2;dx++)for(let dy=-1;dy<2;dy++){
        const g=x.createRadialGradient(px+dx*S,py+dy*S,0,px+dx*S,py+dy*S,r);
        g.addColorStop(0,col);g.addColorStop(1,'rgba(0,0,0,0)');
        x.fillStyle=g;x.beginPath();x.arc(px+dx*S,py+dy*S,r,0,7);x.fill();
      }
      x.globalAlpha=1;
    };
    for(let i=0;i<26;i++)blob(srand()*S,srand()*S,18+srand()*30,'#233a2a',.5);
    for(let i=0;i<18;i++)blob(srand()*S,srand()*S,14+srand()*22,'#0f1a14',.45);
    for(let i=0;i<10;i++)blob(srand()*S,srand()*S,10+srand()*16,'#2d4632',.35);
    for(let i=0;i<2600;i++){                       // 草纹噪点
      const v=srand();
      x.fillStyle=v>.72?'#2b4331':v>.42?'#1b2c21':'#111d16';
      x.fillRect(srand()*S,srand()*S,1+(v>.9?1:0),1+(v>.85?2:0));
    }
  },[9,5.5]);
}
/* 石板路：4×4 块，块与块之间有缝，每块亮度随机 */
function texStone(){
  return makeTex(256,(x,S)=>{
    const N=4,u=S/N;
    x.fillStyle='#161f2e';x.fillRect(0,0,S,S);
    for(let i=0;i<N;i++)for(let j=0;j<N;j++){
      const v=srand(),o=(j%2)*u*.5;                // 错缝
      const px=(i*u+o)%S,py=j*u,pad=1.6;
      const lum=.82+v*.36;
      const col=(n)=>'#'+[0x22,0x2d,0x40].map((b,k)=>Math.min(255,(b*n)|0).toString(16).padStart(2,'0')).join('');
      for(const dx of [0,-S]){
        x.fillStyle=col(lum);
        x.fillRect(px+dx+pad,py+pad,u-pad*2,u-pad*2);
        x.fillStyle='rgba(255,255,255,.05)';       // 上沿高光
        x.fillRect(px+dx+pad,py+pad,u-pad*2,2);
      }
    }
    for(let i=0;i<1400;i++){                       // 石面颗粒
      x.fillStyle=srand()>.5?'rgba(255,255,255,.035)':'rgba(0,0,0,.09)';
      x.fillRect(srand()*S,srand()*S,1,1);
    }
  },[COLS/1.6,ROWS/1.6]);
}
/* 法阵符文环（白色，靠材质染成职业色） */
function texRune(){
  return makeTex(256,(x,S)=>{
    const c=S/2;
    x.strokeStyle='#fff';
    x.lineWidth=4;
    x.beginPath();x.arc(c,c,c*.9,0,7);x.stroke();
    x.lineWidth=3;
    x.beginPath();x.arc(c,c,c*.74,0,7);x.stroke();
    for(let i=0;i<20;i++){                          // 一圈刻度
      const a=i/20*Math.PI*2,l=i%5===0?.16:.09;
      x.lineWidth=i%5===0?7:4;
      x.beginPath();
      x.moveTo(c+cos(a)*c*.74,c+sin(a)*c*.74);
      x.lineTo(c+cos(a)*c*(.74+l),c+sin(a)*c*(.74+l));
      x.stroke();
    }
    x.lineWidth=4;                                  // 内部六芒星
    for(let k=0;k<2;k++){
      x.beginPath();
      for(let i=0;i<3;i++){
        const a=k*Math.PI/3+i/3*Math.PI*2;
        const px=c+cos(a)*c*.6,py=c+sin(a)*c*.6;
        i?x.lineTo(px,py):x.moveTo(px,py);
      }
      x.closePath();x.stroke();
    }
    x.lineWidth=2.5;
    x.beginPath();x.arc(c,c,c*.34,0,7);x.stroke();
  });
}
/* 径向柔光（法阵中心、建筑光晕） */
function texGlow(){
  return makeTex(64,(x,S)=>{
    const g=x.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);
    g.addColorStop(0,'#fff');g.addColorStop(.45,'rgba(255,255,255,.45)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g;x.fillRect(0,0,S,S);
  });
}

/* ================= 商店建筑（原来 dock 上那一行，现在摆进地图） ================= */
const SHOPS=[
  {k:'skill',name:'技能'},
  {k:'item', name:'装备'},
  {k:'mine', name:'金矿'},
  {k:'mill', name:'伐木场'},
];
const SHOP_Z=3.45, SHOP_X0=4.3, SHOP_DX=1.9, SHOP_R=.62;
const SHOP_S=1.15;                                 // 建筑整体缩放
let shopGroups=[],circles=[];
function shopAt(x,z){                              // 供 rpg.js 判断点击
  for(let i=0;i<SHOPS.length;i++){
    if(abs(x-(SHOP_X0+i*SHOP_DX))<SHOP_R&&abs(z-SHOP_Z)<SHOP_R)return SHOPS[i].k;
  }
  return null;
}
function buildShop(kind,glowTex){
  const g=mk();
  /* 圆形石台（参考图里建筑都站在石盘上） */
  const base=new T.Mesh(g_cyl(.5,.54,.11,16),new T.MeshLambertMaterial({color:0x5b6685}));
  base.position.y=.055;base.receiveShadow=true;g.add(base);
  const rim=new T.Mesh(g_ring(.46,.53),
    new T.MeshBasicMaterial({color:0x93a4c6,transparent:true,opacity:.5,depthWrite:false}));
  rim.rotation.x=-PI/2;rim.position.y=.112;g.add(rim);
  const halo=new T.Mesh(new T.PlaneGeometry(1.5,1.5),
    new T.MeshBasicMaterial({map:glowTex,transparent:true,opacity:.18,depthWrite:false}));
  halo.rotation.x=-PI/2;halo.position.y=.012;g.add(halo);
  g.userData.halo=halo;
  if(kind==='skill'){                              // 法师书塔
    add(g,g_cyl(.2,.25,.58,10),0x8e9bbe,0,.4,0);   // 塔身（浅色，压得住深色路面）
    add(g,g_cyl(.28,.28,.06,10),0xb8c4de,0,.71,0);
    add(g,g_cone(.32,.4,10),0x8a6cff,0,.94,0);     // 紫顶（别用蓝，会和石板路撞色）
    add(g,g_sph(.085,8),0xe0d0ff,0,1.19,0,{glow:1});
    const bk=add(g,g_box(.22,.05,.17),0xfff2d0,0,.8,.32,{glow:1});  // 悬浮的书
    add(g,g_box(.025,.06,.18),0x8a5f38,0,.84,.32,{glow:1});
    g.userData.bob=bk;
  }else if(kind==='item'){                         // 铁匠铺
    add(g,g_box(.52,.36,.44),0x8a6a4e,0,.29,0);
    add(g,g_cone(.46,.34,4),0xe0603f,0,.64,0,{ry:PI/4});  // 四坡屋顶（亮红）
    add(g,g_box(.17,.13,.15),0x4a5464,.02,.17,.3);        // 铁砧
    add(g,g_box(.22,.06,.2),0x5e6a7c,.02,.26,.3);
    const fr=add(g,g_sph(.1,7),0xffa040,-.26,.22,.22,{glow:1});      // 炉火
    add(g,g_box(.11,.34,.11),0x6b5340,-.26,.5,0);                     // 烟囱
    g.userData.pulse=fr;
  }else if(kind==='mine'){                         // 矿洞
    add(g,g_oct(.46),0x8a8168,0,.32,0,{s:[1.15,.95,1]});           // 土黄岩体
    add(g,g_oct(.26),0x9c927a,.3,.2,.18);
    add(g,g_box(.28,.28,.1),0x14161c,0,.21,.38,{glow:1});           // 洞口
    add(g,g_box(.055,.34,.055),0x6b5334,-.17,.22,.38);              // 支撑木
    add(g,g_box(.055,.34,.055),0x6b5334,.17,.22,.38);
    add(g,g_box(.44,.055,.055),0x6b5334,0,.39,.38);
    const or1=add(g,g_sph(.09,7),0xffd35c,-.32,.15,.26,{glow:1});   // 金矿石
    add(g,g_sph(.07,7),0xffd35c,-.38,.11,.38,{glow:1});
    g.userData.pulse=or1;
  }else{                                           // 伐木场
    add(g,g_box(.46,.34,.4),0x9c7a4a,0,.28,0);
    add(g,g_cone(.44,.32,4),0x6fa84a,0,.62,0,{ry:PI/4});             // 亮绿顶
    for(let i=0;i<3;i++)                                             // 原木堆
      add(g,g_cyl(.08,.08,.36,7),0xc09660,-.32+(i%2)*.03,.1+i*.15,.32,{rz:PI/2});
    const saw=add(g,g_cyl(.17,.17,.025,14),0xe2ecfa,.32,.28,.14,{rz:PI/2});  // 锯片
    g.userData.spin=saw;
  }
  return g;
}

/* ================= 地图装饰（树/石头/草簇，只摆在战场外围） ================= */
function scatterDecor(){
  const inBattle=(x,z)=>x>-.7&&x<COLS+2.2&&z>-.45&&z<3.2;
  const inShops =(x,z)=>x>3.2&&x<11.4&&z>3.1&&z<4.15;
  let n=0,guard=0;
  while(n<52&&guard++<900){
    const x=-3+srand()*(COLS+8), z=-2.6+srand()*8.4;
    if(inBattle(x,z)||inShops(x,z))continue;
    const t=srand(),g=mk();
    if(t<.3){                                      // 树
      add(g,g_cyl(.07,.09,.5,6),0x4a3a2a,0,.25,0);
      add(g,g_cone(.34,.55,7),0x24422c,0,.68,0);
      add(g,g_cone(.26,.42,7),0x2d5236,0,.98,0);
    }else if(t<.55){                               // 石头
      const s=.7+srand()*.9;
      add(g,g_oct(.22),0x3c4454,0,.14,0,{s:[s*1.2,s*.8,s]});
      add(g,g_oct(.12),0x48505f,.18,.08,.1);
    }else{                                         // 草簇
      for(let i=0;i<4;i++)
        add(g,g_cone(.05,.24,4),i%2?0x2d4a32:0x233a29,
            (srand()-.5)*.3,.12,(srand()-.5)*.3,{noSh:1});
    }
    g.position.set(x,0,z);
    g.rotation.y=srand()*6.28;
    g.scale.setScalar(.8+srand()*.5);
    scene.add(g);n++;
  }
}

function init(){
  const cv=document.getElementById('cv');
  ren=new T.WebGLRenderer({canvas:cv,antialias:true,powerPreference:'high-performance'});
  ren.setClearColor(0x0d1420,1);
  ren.shadowMap.enabled=true;ren.shadowMap.type=T.PCFShadowMap;

  scene=new T.Scene();
  cam=new T.OrthographicCamera(-1,1,1,-1,.5,CAM_D*2.5);

  scene.add(new T.HemisphereLight(0x8fb4e0,0x1a2233,1.15));
  dirLight=new T.DirectionalLight(0xfff0d8,1.6);
  dirLight.position.set(COLS/2-5,13,ROWS/2-5);
  dirLight.castShadow=true;
  dirLight.shadow.mapSize.set(2048,1024);
  dirLight.shadow.bias=-.0012;
  const sc=dirLight.shadow.camera;
  sc.left=-COLS*.62;sc.right=COLS*.62;sc.top=ROWS*2.4;sc.bottom=-ROWS*2.4;sc.near=1;sc.far=34;
  scene.add(dirLight);scene.add(dirLight.target);
  dirLight.target.position.set(COLS/2,0,ROWS/2);
  const fill=new T.DirectionalLight(0x5f7fb8,.5);fill.position.set(6,4,6);scene.add(fill);

  const glowTex=texGlow(), runeTex=texRune();

  /* 连贯的草地大地图（一整张，战斗区只是铺在上面的石板路） */
  const ground=new T.Mesh(new T.PlaneGeometry(COLS+24,ROWS+22),
    new T.MeshLambertMaterial({map:texGrass()}));
  ground.rotation.x=-PI/2;ground.position.set(COLS/2,0,ROWS/2);ground.receiveShadow=true;
  scene.add(ground);

  /* 战斗区：石板路台面（边缘有厚度，和草地区分开） */
  const board=new T.Mesh(new T.BoxGeometry(COLS,.14,ROWS),
    new T.MeshLambertMaterial({color:0x222c3e}));
  board.position.set(COLS/2,-.07,ROWS/2);board.receiveShadow=true;
  scene.add(board);
  const road=new T.Mesh(new T.PlaneGeometry(COLS,ROWS),
    new T.MeshLambertMaterial({map:texStone()}));
  road.rotation.x=-PI/2;road.position.set(COLS/2,.005,ROWS/2);road.receiveShadow=true;
  scene.add(road);

  /* 左侧出兵位：不再是色块，改成职业色法阵光圈 */
  for(let c=0;c<HCOLS;c++){
    const col=CLASSES[COL_CLASS[c]].color;
    for(let r=0;r<ROWS;r++){
      const g=new T.Group();g.position.set(c+.5,0,r+.5);
      const glow=new T.Mesh(new T.PlaneGeometry(1.05,1.05),
        new T.MeshBasicMaterial({color:col,map:glowTex,transparent:true,opacity:.3,depthWrite:false}));
      glow.rotation.x=-PI/2;glow.position.y=.016;g.add(glow);
      const rune=new T.Mesh(new T.PlaneGeometry(.92,.92),
        new T.MeshBasicMaterial({color:col,map:runeTex,transparent:true,opacity:.75,depthWrite:false}));
      rune.rotation.x=-PI/2;rune.position.y=.022;g.add(rune);
      const ring=new T.Mesh(g_ring(.4,.46),
        new T.MeshBasicMaterial({color:col,transparent:true,opacity:.85,depthWrite:false}));
      ring.rotation.x=-PI/2;ring.position.y=.024;g.add(ring);
      g.userData={rune,glow,ring,col,c,r};
      circles.push(g);scene.add(g);
    }
  }

  /* 商店建筑：原来 dock 上那一行，摆到战斗区下方的草地上 */
  for(let i=0;i<SHOPS.length;i++){
    const g=buildShop(SHOPS[i].k,glowTex);
    g.position.set(SHOP_X0+i*SHOP_DX,0,SHOP_Z);
    g.scale.setScalar(SHOP_S);
    g.userData.k=SHOPS[i].k;
    shopGroups.push(g);scene.add(g);
  }
  scatterDecor();
  /* 网格线 */
  const pts=[];
  for(let c=0;c<=COLS;c++)pts.push(c,.014,0, c,.014,ROWS);
  for(let r=0;r<=ROWS;r++)pts.push(0,.014,r, COLS,.014,r);
  const gg=new T.BufferGeometry();
  gg.setAttribute('position',new T.Float32BufferAttribute(pts,3));
  scene.add(new T.LineSegments(gg,new T.LineBasicMaterial({color:0x3c5480,transparent:true,opacity:.85})));

  /* 出兵区/战斗区分界红线 */
  frontier=new T.Mesh(g_box(.06,.02,ROWS),new T.MeshBasicMaterial({color:0xff5d5d,transparent:true,opacity:.55}));
  frontier.position.set(HCOLS,.02,ROWS/2);scene.add(frontier);

  /* 选中格高亮框 */
  selGroup=new T.Group();
  const sm=new T.MeshBasicMaterial({color:0x8ab8d8});
  for(let i=0;i<4;i++){
    const bar=new T.Mesh(i<2?g_box(.9,.03,.05):g_box(.05,.03,.9),sm);
    bar.position.set(i===2?-.44:i===3?.44:0,.02,i===0?-.44:i===1?.44:0);
    selGroup.add(bar);
  }
  selGroup.visible=false;scene.add(selGroup);

  /* 2D 覆盖层：血条/蓝条/经验条/等级/伤害飘字（保持文字清晰、性能好） */
  ocv=document.createElement('canvas');ocv.id='cv2';
  cv.parentNode.appendChild(ocv);
  octx=ocv.getContext('2d');
  inited=true;
}

/* ================= 尺寸 / 相机 ================= */
function resize(){
  if(!inited)init();
  const st=document.getElementById('stage');
  W=max(st.clientWidth,2);H=max(st.clientHeight,2);
  PR=min(window.devicePixelRatio||1,2);
  const cv=document.getElementById('cv');
  cv.style.width=W+'px';cv.style.height=H+'px';
  ocv.style.width=W+'px';ocv.style.height=H+'px';
  ocv.width=W*PR|0;ocv.height=H*PR|0;
  ren.setPixelRatio(PR);ren.setSize(W,H,false);

  const asp=W/H;
  /* 纵向要装下：战场上沿(留点草地) → 商店建筑下沿，外加单位高度。
     相机空间的垂直坐标 v(y,z) = (y-.3)*cos(TILT) - (z-tz)*sin(TILT) */
  const zTop=-.28, zBot=SHOP_Z+.68*SHOP_S, tz=(zTop+zBot)/2;
  const v=(y,z)=>(y-.3)*cos(TILT)-(z-tz)*sin(TILT);
  const needW=(COLS+.5)/2;
  const needH=max(abs(v(.95,.2)),abs(v(0,zBot)))+.06;
  const hh=max(needH,needW/asp), hw=max(needW,hh*asp);
  cam.left=-hw;cam.right=hw;cam.top=hh;cam.bottom=-hh;
  const tx=COLS/2;
  cam.position.set(tx,CAM_D*sin(TILT),tz+CAM_D*cos(TILT));
  cam.lookAt(tx,.3,tz);
  cam.updateProjectionMatrix();
}

/* ================= 屏幕投影（覆盖层用） ================= */
const _pv=new T.Vector3();
function proj(x,y,z){
  _pv.set(x,y,z).project(cam);
  return [(_pv.x*.5+.5)*W,(-_pv.y*.5+.5)*H];
}
/* 该点处 1 个格子 ≈ 多少屏幕像素 */
function ppu(x,y,z){
  const a=proj(x,y,z),b=proj(x+1,y,z);
  return abs(b[0]-a[0])||30;
}

/* ================= 拾取（点击/拖拽 → 格子坐标） ================= */
const _ray=new T.Raycaster(),_nd=new T.Vector2();
const _plane=new T.Plane(new T.Vector3(0,1,0),-.25);
const _hit=new T.Vector3();
function pick(ev){
  if(!inited)return null;
  const r=ocv.getBoundingClientRect();
  _nd.x=((ev.clientX-r.left)/r.width)*2-1;
  _nd.y=-((ev.clientY-r.top)/r.height)*2+1;
  _ray.setFromCamera(_nd,cam);
  if(!_ray.ray.intersectPlane(_plane,_hit))return null;
  return {x:_hit.x,y:_hit.z};
}

/* ================= 条形/文字（2D 覆盖层） ================= */
function bar(cx,top,w,h,ratio,color){
  octx.fillStyle='rgba(0,0,0,.62)';octx.fillRect(cx-w/2,top,w,h);
  octx.fillStyle=color;octx.fillRect(cx-w/2,top,w*max(ratio,0),h);
}

/* ================= 每帧渲染 ================= */
function draw(){
  if(!inited)return;
  const t0=performance.now();
  tmpReset();
  octx.setTransform(PR,0,0,PR,0,0);
  octx.clearRect(0,0,W,H);
  octx.textAlign='center';

  /* --- 选中格 --- */
  if(sel){selGroup.visible=true;selGroup.position.set(sel.col+.5,0,sel.row+.5);}
  else selGroup.visible=false;

  /* --- 出兵法阵：符文环缓慢转，有英雄站着的更亮 --- */
  for(const g of circles){
    const u=g.userData;
    const taken=heroes.some(h=>h.col===u.c&&h.row===u.r);
    const p=.5+.5*sin(gt*1.6+u.c*1.1+u.r*.7);
    u.rune.rotation.z-=(taken?.006:.0022);
    u.rune.material.opacity=taken?.62+.3*p:.4+.14*p;
    u.glow.material.opacity=taken?.34+.2*p:.2;
    u.ring.material.opacity=taken?.85:.4;
    u.ring.scale.setScalar(taken?1+.035*p:1);
  }

  /* --- 商店建筑：待机动画 + 打开中的高亮 --- */
  for(const g of shopGroups){
    const u=g.userData,on=openShop===u.k;
    const p=.5+.5*sin(gt*3+u.k.length);
    u.halo.material.opacity=on?.3+.22*p:.13;
    u.halo.material.color.set(on?0xffd24f:0x8ab8d8);
    if(u.spin)u.spin.rotation.y+=.06;
    if(u.bob){u.bob.position.y=.72+.05*sin(gt*2.2);u.bob.rotation.y+=.012;}
    if(u.pulse)u.pulse.scale.setScalar(.85+.3*p);
    g.position.y=on?.05+.03*p:0;
  }
  /* 建筑名牌（覆盖层，跟着建筑走） */
  for(let i=0;i<SHOPS.length;i++){
    const sx=SHOP_X0+i*SHOP_DX;
    const u=ppu(sx,.9,SHOP_Z), sp=proj(sx,1.12*SHOP_S,SHOP_Z-.12);
    const on=openShop===SHOPS[i].k;
    const fs=max(11,.24*u);
    octx.font='700 '+fs.toFixed(1)+'px -apple-system,sans-serif';
    octx.lineWidth=3.5;octx.strokeStyle='rgba(0,0,0,.75)';
    octx.strokeText(SHOPS[i].name,sp[0],sp[1]);
    octx.fillStyle=on?'#ffd24f':'#dce6f2';
    octx.fillText(SHOPS[i].name,sp[0],sp[1]);
    const k=SHOPS[i].k, sub=k==='mine'?'Lv'+mineLv+' +'+mineLv+'/s'
      :k==='mill'?'Lv'+millLv+' +'+millLv+'/s'
      :k==='skill'?'出4本书':'roll品质';
    octx.font='500 '+(fs*.72).toFixed(1)+'px -apple-system,sans-serif';
    octx.strokeText(sub,sp[0],sp[1]+fs*.95);
    octx.fillStyle='rgba(190,205,225,.9)';
    octx.fillText(sub,sp[0],sp[1]+fs*.95);
  }

  /* --- 地面区域效果：火焰风暴 / 大地震颤 --- */
  for(const s of storms){
    if(s.delay>0)continue;
    const fl=.75+.25*sin(gt*13+s.cx);
    const d=take('sto',()=>{const g=mk();
      add(g,g_disc(),0xff7a2f,0,0,0,{rx:-PI/2,glow:1,op:.2,noSh:1});
      add(g,g_ring(.9,1),0xffb04f,0,.005,0,{rx:-PI/2,glow:1,op:.55,noSh:1});return g;});
    d.position.set(s.cx,.03,s.cy);d.scale.setScalar(s.R);
    d.children[0].material.opacity=.2*fl;d.children[1].material.opacity=.55*fl;
  }
  for(const q of quakes){
    const w=q.x1-q.x0,hh=q.y1-q.y0,fl=.7+.3*sin(gt*17+q.x0);
    const d=take('qk',()=>{const g=mk();
      add(g,new T.PlaneGeometry(1,1),0xa86b32,0,0,0,{rx:-PI/2,glow:1,op:.18,noSh:1});
      for(let i=0;i<5;i++)add(g,g_box(1,.01,.03),0x5a3b22,0,.004,(i-2)*.19,{glow:1,op:.5,noSh:1});
      return g;});
    d.position.set(q.x0+w/2,.028,q.y0+hh/2);
    d.children[0].scale.set(w,hh,1);
    d.children[0].material.opacity=.18*fl;
    for(let i=1;i<d.children.length;i++){
      const cr=d.children[i];cr.scale.set(w*.92,1,hh/3);
      cr.position.z=((i-.5)/5-.5)*hh;cr.material.opacity=.5*fl;
    }
  }

  /* --- 英雄 --- */
  for(const h of heroes){
    const g=bind(h,'H'+h.cls,()=>buildHero(h.cls));
    const dead=!h.alive, sz=(h.sizeMul||1)*1.12;
    const bob=dead?0:sin(gt*2.2+h.row*1.7)*.02;
    g.position.set(h.x,bob,h.row+.5);
    g.scale.setScalar(sz);
    g.rotation.y=dead?0:sin(gt*.8+h.row)*.06;
    tint(g,h.flash>0,dead,false);
    /* 攻击动作 */
    const p=h.anim>0?h.anim/ANIM_T:0;
    const wep=g.userData.wep;
    if(wep){
      if(h.cls==='warrior')wep.rotation.z=-2.1*p+.25;
      else if(h.cls==='archer')wep.position.x=.2-.1*p;
      else wep.rotation.z=-.12-.5*p;
    }
    if(g.userData.orb){
      const s=1+.25*sin(gt*4)+p*.6;
      g.userData.orb.scale.setScalar(s);
    }
    /* 转职：脚下金环 */
    if(h.tier&&!dead){
      const r=take('adv',()=>{const g2=mk();
        add(g2,g_ring(.82,1),0xf0c46a,0,0,0,{rx:-PI/2,glow:1,op:.6,noSh:1});return g2;});
      r.position.set(h.x,.03,h.row+.5);
      r.scale.setScalar(.33+.02*sin(gt*3));
      r.children[0].material.opacity=.3+.2*sin(gt*3);
    }
    /* 忍受：金色护盾罩 */
    if(!dead&&h.endT>0){
      const s=take('shd',()=>{const g2=mk();
        add(g2,g_sph(1,12),0xffd24f,0,0,0,{glow:1,op:.16,noSh:1});
        add(g2,g_ring(.93,1),0xffd24f,0,0,0,{rx:-PI/2,glow:1,op:.5,noSh:1});return g2;});
      s.position.set(h.x,.42,h.row+.5);
      s.scale.setScalar(.46*sz);
      const pp=.75+.25*sin(gt*9);
      s.children[0].material.opacity=.14*pp;s.children[1].material.opacity=.5*pp;
    }
    /* 覆盖层：血条/蓝条/等级/经验 */
    if(!dead){
      const u=ppu(h.x,.9,h.row+.5), sp0=proj(h.x,1.28*sz,h.row+.5);
      const bw=.62*u*sz, lb=.2*u;
      const sp=[sp0[0]+lb/2+1,sp0[1]];
      bar(sp[0],sp[1]-8,bw,.09*u,h.hp/h.maxHp,'#6ee7a0');
      bar(sp[0],sp[1]-8+.11*u,bw,.07*u,h.mp/h.maxMp,'#4f8dff');
      octx.fillStyle='#0a0e16';                         // 等级小框octx.fillRect(sp[0]-bw/2-lb-2,sp[1]-8,lb,.19*u);
      octx.strokeStyle='#f0c46a';octx.lineWidth=1;
      octx.strokeRect(sp[0]-bw/2-lb-2,sp[1]-8,lb,.19*u);
      octx.fillStyle='#f0c46a';octx.font='600 '+(.13*u).toFixed(1)+'px -apple-system,sans-serif';
      octx.fillText(h.lv,sp[0]-bw/2-lb/2-2,sp[1]-8+.14*u);
      const fp=proj(h.x,0,h.row+.5);                    // 经验条（脚下）
      bar(fp[0],fp[1]+2,.7*u,.06*u,
        h.lv>=MAX_HERO_LV?1:min(h.xp/xpNeed(h.lv),1),'#b070ff');
    }
  }

  /* --- 召唤物 --- */
  for(const br of bears){
    const kind=br.kind||'bear', z=br.row+.5+(br.oy||0);
    const g=bind(br,'S'+kind,()=>buildMinion(kind));
    const r=(MINIONS[kind]&&MINIONS[kind].r)||.28;
    g.position.set(br.x,sin(gt*4+br.x)*.015,z);
    g.scale.setScalar(r*1.28);
    tint(g,false,false,false);
    const u=ppu(br.x,.5,z),sp=proj(br.x,r*2.5,z);
    bar(sp[0],sp[1]-6,.6*u,.08*u,br.hp/br.maxHp,'#6ee7a0');
  }

  /* --- 怪物 --- */
  for(const m of mobs){
    const z=m.y+.5;
    const g=bind(m,'M'+m.type,()=>buildMob(m.type));
    const ph=gt*6+m.x*2.2;
    g.position.set(m.x,abs(sin(ph))*.05*m.r,z);
    g.scale.setScalar(m.r*1.32);
    g.rotation.z=sin(ph)*.05;
    tint(g,m.flash>0,false,m.frost>0);
    /* 脚下光环：试炼色环 / 精英金环 */
    if(m.trial||m.elite){
      const col=m.trial?TRIALS[m.trial].color:'#f0c46a';
      const r=take('mr',()=>{const g2=mk();
        add(g2,g_ring(.82,1),0xffffff,0,0,0,{rx:-PI/2,glow:1,op:.5,noSh:1});
        add(g2,g_ring(.6,.72),0xffffff,0,.004,0,{rx:-PI/2,glow:1,op:.35,noSh:1});return g2;});
      r.position.set(m.x,.03,z);r.scale.setScalar(m.r*1.75);
      const a=.35+.3*sin(gt*4+m.x);
      r.children[0].material.color.set(col);r.children[0].material.opacity=a;
      r.children[1].material.color.set(col);r.children[1].material.opacity=m.elite?a*.8:0;
    }
    const u=ppu(m.x,.4,z),sp=proj(m.x,m.r*2.5,z);
    bar(sp[0],sp[1]-5,m.r*2.4*u,.085*u,m.hp/m.maxHp,'#6ee7a0');
  }

  /* --- 宝箱 --- */
  for(const ch of chests){
    if(ch.dead)continue;
    const g=bind(ch,'CH',buildChest);
    const pulse=.5+.5*sin(gt*4+ch.x);
    g.position.set(ch.x,.03+sin(gt*3+ch.x)*.04,ch.y);
    g.rotation.y=sin(gt*1.4+ch.x)*.25;
    g.children[5].scale.setScalar(.5+.1*pulse);
    g.children[5].material.opacity=.16+.18*pulse;
  }

  /* --- 弹道 --- */
  for(const s of shots){
    const g=bind(s,'P'+(s.kind||'arrow'),()=>buildShot(s.kind));
    g.position.set(s.x,.45,s.y);
    g.rotation.y=-(s.a||0);
    if(s.kind!=='orb')g.rotation.z=0;
  }

  /* --- 特效 --- */
  for(const f of fx)drawFx(f);

  /* --- 伤害飘字（覆盖层） --- */
  for(const n of nums){
    const u=ppu(n.x,.9,n.y),sp=proj(n.x,.95,n.y);
    octx.globalAlpha=min(1,n.t/n.max*1.6);
    octx.fillStyle=n.color;
    octx.font='700 '+max(10,.3*u).toFixed(1)+'px -apple-system,sans-serif';
    octx.lineWidth=3;octx.strokeStyle='rgba(0,0,0,.65)';
    octx.strokeText(n.txt,sp[0],sp[1]);
    octx.fillText(n.txt,sp[0],sp[1]);
  }
  octx.globalAlpha=1;

  sweep();tmpHide();
  ren.render(scene,cam);

  /* 低端机自动降级：连续掉帧就关阴影 */
  if(shadowOn){
    ftAcc+=performance.now()-t0;ftN++;
    if(ftN>=120){
      if(ftAcc/ftN>17){shadowOn=false;ren.shadowMap.enabled=false;dirLight.castShadow=false;
        scene.traverse(o=>{if(o.isMesh)o.castShadow=false;});}
      ftAcc=0;ftN=0;
    }
  }
}

/* ================= 特效分支 ================= */
function drawFx(f){
  const k=1-f.t/f.max;                       // 0→1 进度
  const c=f.color;
  if(f.type==='line'){
    const m=take('fl',()=>new T.Mesh(g_box(1,1,1),
      new T.MeshBasicMaterial({color:0xffffff,transparent:true})));
    beam(m,f.x1,.45,f.y1,f.x2,.45,f.y2,.07);
    m.material.color.set(c);m.material.opacity=1-k;
  }else if(f.type==='aoe'){
    const g=take('fa',()=>{const g2=mk();
      add(g2,g_disc(),0xffffff,0,0,0,{rx:-PI/2,glow:1,op:.22,noSh:1});
      add(g2,g_ring(.93,1),0xffffff,0,.004,0,{rx:-PI/2,glow:1,op:1,noSh:1});return g2;});
    g.position.set(f.x,.035,f.y);g.scale.setScalar(f.rr);
    g.children[0].material.color.set(c);g.children[0].material.opacity=.22*(1-k);
    g.children[1].material.color.set(c);g.children[1].material.opacity=1-k;
  }else if(f.type==='fall'){                 // 冰棱坠落
    const g=take('ff',()=>{const g2=mk();
      add(g2,g_oct(.11),0xffffff,0,0,0,{glow:1,s:[.5,1.5,.5]});
      add(g2,g_box(.02,.3,.02),0xffffff,0,.28,0,{glow:1,op:.4,noSh:1});return g2;});
    g.position.set(f.x,1.6*(1-k)+.12,f.y);
    g.children[0].material.color.set(c);
    g.children[0].material.opacity=1;g.children[0].material.transparent=false;
  }else if(f.type==='bolt'){                 // 火球飞行 + 落点爆闪
    const fp=min(1,k/.62);
    const g=take('fb',()=>{const g2=mk();
      add(g2,g_sph(.1,8),0xffffff,0,0,0,{glow:1});
      add(g2,g_sph(.2,8),0xffffff,0,0,0,{glow:1,op:.4,noSh:1});return g2;});
    if(fp<1){
      g.position.set(f.x1+(f.x2-f.x1)*fp,.5,f.y1+(f.y2-f.y1)*fp);
      g.scale.setScalar(1);
      g.children[0].material.color.set(0xfff4c0);
      g.children[1].material.color.set(c);g.children[1].material.opacity=.45;
    }else{
      const e=(k-.62)/.38;
      g.position.set(f.x2,.4,f.y2);
      g.scale.setScalar(1.2+e*3.4);
      g.children[0].material.color.set(c);
      g.children[1].material.color.set(c);g.children[1].material.opacity=(1-e)*.5;
    }
  }else if(f.type==='zap'){                  // 闪电链：折线电弧
    const N=6,dx=(f.x2-f.x1)/N,dz=(f.y2-f.y1)/N;
    let nx=-(f.y2-f.y1),nz=(f.x2-f.x1);
    const nl=Math.hypot(nx,nz)||1;nx/=nl;nz/=nl;
    let px=f.x1,pz=f.y1;
    for(let i=1;i<=N;i++){
      const o=i<N?sin(f.seed+i*2.3)*.2*(1-abs(i/N-.5)*1.2):0;
      const qx=i<N?f.x1+dx*i+nx*o:f.x2, qz=i<N?f.y1+dz*i+nz*o:f.y2;
      const m=take('fz',()=>new T.Mesh(g_box(1,1,1),
        new T.MeshBasicMaterial({color:0xffffff,transparent:true})));
      beam(m,px,.5,pz,qx,.5,qz,.075);
      m.material.color.set(c);m.material.opacity=(1-k)*(.75+.25*Math.random());
      px=qx;pz=qz;
    }
  }else if(f.type==='slash'){                // 战士弧形刀光
    const g=take('fs',()=>new T.Mesh(g_torus(2.1),
      new T.MeshBasicMaterial({color:0xffffff,transparent:true})));
    g.position.set(f.x,.42,f.y);
    g.rotation.set(-PI/2,0,0);
    g.rotateZ(-f.a-1.05);
    const r=f.rr*(.7+.5*k);
    g.scale.set(r,r,1+(1-k)*1.2);
    g.material.color.set(c);g.material.opacity=1-k;
  }else if(f.type==='flame'){                // 火焰风暴火舌
    const m=take('fm',()=>new T.Mesh(g_cone(.13,.42,6),
      new T.MeshBasicMaterial({color:0xffffff,transparent:true})));
    const s=f.sz*(1-k*.55);
    m.position.set(f.x,.16+.55*k,f.y);
    m.scale.setScalar(s);
    m.material.color.set(c);m.material.opacity=(1-k)*.9;
  }else if(f.type==='sword'){                // 剑雨：剑从天而降
    const g=take('fw',()=>{const g2=mk();
      add(g2,g_box(.035,.4,.035),0xffffff,0,.2,0,{glow:1});
      add(g2,g_box(.14,.035,.035),0xffffff,0,.38,0,{glow:1});return g2;});
    g.position.set(f.x,1.5*(1-k)*(1-k)+.05,f.y);
    const a=k<.85?1:(1-k)/.15;
    g.children[0].material.color.set(c);g.children[0].material.opacity=a;
    g.children[1].material.color.set(c);g.children[1].material.opacity=a;
  }else if(f.type==='rock'){                 // 大地震颤碎石
    const m=take('fr',()=>new T.Mesh(g_tet(.1),
      new T.MeshBasicMaterial({color:0xffffff,transparent:true})));
    const s=f.sz*(1-k*.4);
    m.position.set(f.x+f.vx*k*.5,(.5-abs(k-.5))*.9+.05,f.y);
    m.scale.setScalar(s);
    m.rotation.set(k*7,k*5,k*3);
    m.material.color.set(c);m.material.opacity=1-k*k;
  }else if(f.type==='heal'){                 // 治疗：上浮十字
    const g=take('fh',()=>{const g2=mk();
      add(g2,g_box(.08,.24,.02),0xffffff,0,0,0,{glow:1});
      add(g2,g_box(.24,.08,.02),0xffffff,0,0,0,{glow:1});return g2;});
    g.position.set(f.x,.55+.75*k,f.y);
    g.rotation.x=-TILT;
    const a=(1-k)*.95;
    g.children[0].material.color.set(c);g.children[0].material.opacity=a;
    g.children[1].material.color.set(c);g.children[1].material.opacity=a;
  }else if(f.type==='spark'){                // 升级/命中粒子
    const m=take('fp',()=>new T.Mesh(g_sph(.06,6),
      new T.MeshBasicMaterial({color:0xffffff,transparent:true})));
    const d=.25+k*1.1;
    m.position.set(f.x+f.ax*d,.45+k*.3,f.y+f.ay*d);
    m.scale.setScalar((1-k)+.3);
    m.material.color.set(c);m.material.opacity=1-k;
  }else{                                     // 默认：扩散圆环
    const m=take('fd',()=>new T.Mesh(g_ring(.9,1),
      new T.MeshBasicMaterial({color:0xffffff,transparent:true,side:T.DoubleSide})));
    m.position.set(f.x,.04,f.y);m.rotation.x=-PI/2;
    m.scale.setScalar(f.rr*(.4+.6*k));
    m.material.color.set(c);m.material.opacity=1-k;
  }
}

return {resize,draw,pick,shopAt};
})();
