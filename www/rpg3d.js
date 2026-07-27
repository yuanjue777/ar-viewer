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
const TILT=50*PI/180;                // 俯角（5行后放平一点，纵向才装得下）
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
/* 英雄：二头身 chibi 比例（大头在小屏上辨识度最高），面向 +X（敌人从右来）。
   总高约 1.05。tier>0 = 已转职：加披风/肩饰/头饰，武器也升级一档。
   ⚠️ 对象池的 key 里带了 tier/branch，所以转职后模型会自动重建。 */
function buildHero(cls,tier,branch){
  tier=tier|0;branch=branch|0;
  const g=mk(), c=CLASSES[cls].color;
  const dk=shade3(c,.5), lt=shade3(c,1.42);
  const SKIN=0xf6d9bb, EYE=0x2b2436, GOLD=0xf0c46a;
  const HAIR=cls==='mage'?0x7a5a9a:cls==='archer'?0xe8c46a:0xd4713a;
  const CLOAK=branch?shade3(c,1.15):shade3(c,.62);
  const HY=.66;                                   // 头中心高度

  /* ---- 腿 + 鞋（短腿，二头身） ---- */
  for(const z of [-.075,.075]){
    add(g,g_box(.085,.15,.095),dk,0,.075,z);
    add(g,g_box(.115,.055,.125),shade3(c,.34),.014,.028,z);
  }
  /* ---- 脸（三职业共用：大眼 + 高光 + 腮红） ---- */
  const face=()=>{
    add(g,g_sph(.196,12),SKIN,0,HY,0);
    for(const z of [-.073,.073]){
      add(g,g_sph(.034,7),EYE,.171,HY+.012,z,{glow:1});
      add(g,g_sph(.013,6),0xffffff,.188,HY+.045,z+.012,{glow:1});
    }
    add(g,g_sph(.03,6),0xf0a898,.163,HY-.055,-.115,{glow:1,op:.55,noSh:1});
    add(g,g_sph(.03,6),0xf0a898,.163,HY-.055,.115,{glow:1,op:.55,noSh:1});
  };

  if(cls==='mage'){
    add(g,g_cone(.245,.44,10),c,0,.22,0);                    // 长袍下摆
    add(g,g_cyl(.145,.185,.22,10),lt,0,.44,0);               // 上身
    add(g,g_box(.09,.2,.075),c,.02,.46,-.19);                // 袖
    add(g,g_box(.09,.2,.075),c,.02,.46,.19);
    face();
    add(g,g_sph(.21,10),HAIR,-.03,HY+.03,0,{s:[.92,.9,1.04]}); // 头发
    add(g,g_box(.1,.3,.075),HAIR,-.11,HY-.16,-.15);            // 两侧长发
    add(g,g_box(.1,.3,.075),HAIR,-.11,HY-.16,.15);
    add(g,g_cyl(.265,.265,.028,12),dk,0,HY+.21,0);           // 帽檐（抬到头顶之上，不挡脸）
    add(g,g_cone(.2,tier?.46:.36,10),dk,0,HY+(tier?.46:.41),0); // 尖帽
    add(g,g_sph(tier?.06:.045,7),0xffe9a8,0,HY+(tier?.72:.61),0,{glow:1});
    /* 法杖 */
    add(g,g_cyl(.024,.028,.94,7),0x8a6a44,.24,.47,.2,{rz:-.1});
    const orb=add(g,g_sph(tier?.105:.08,10),0xcfe8ff,.29,.97,.2,{glow:1});
    add(g,g_sph(tier?.19:.14,10),0x4fa8ff,.29,.97,.2,{glow:1,op:.3,noSh:1});
    if(tier){
      const ring=add(g,g_torus(6.28),0x9fd4ff,.29,.97,.2,{rx:PI/2,glow:1,op:.7,noSh:1});
      ring.scale.set(.2,.2,.2);
      g.userData.orbit=ring;
    }
    g.userData.wep=null;g.userData.orb=orb;
  }else if(cls==='archer'){
    add(g,g_cone(.235,.3,9),dk,0,.17,0);                     // 短披风下摆
    add(g,g_cyl(.14,.175,.24,10),c,0,.42,0);                 // 身体
    add(g,g_box(.16,.06,.4),shade3(c,.4),0,.34,0);           // 腰带
    add(g,g_box(.085,.19,.07),lt,.02,.46,-.185);
    add(g,g_box(.085,.19,.07),lt,.02,.46,.185);
    face();
    add(g,g_sph(.212,10),HAIR,-.02,HY+.035,0,{s:[.95,.92,1.02]});
    add(g,g_cone(.1,.42,7),HAIR,-.2,HY-.02,0,{rz:1.15});     // 马尾
    add(g,g_sph(.08,7),HAIR,-.13,HY+.1,0);
    if(!tier)add(g,g_cone(.205,.27,9),c,-.11,HY+.17,0,{rz:.32});  // 兜帽（往后戴，露脸）
    else{
      add(g,g_box(.03,.05,.2),GOLD,.15,HY+.15,0);            // 额饰
      add(g,g_cone(.035,.22,5),0xffffff,-.06,HY+.26,-.1,{rz:-.5,glow:1});  // 羽毛
    }
    /* 弓 */
    const bow=add(g,g_torus(2.5),0xb98a4e,.24,.5,0,{});
    bow.rotation.set(0,-PI/2,0);bow.scale.setScalar(tier?.34:.28);
    if(tier)add(g,g_sph(.045,7),GOLD,.24,.5,0,{glow:1});
    add(g,g_cyl(.055,.055,.28,6),0x6b4a2c,-.15,.55,.13,{rz:.45});  // 箭袋
    for(let i=0;i<3;i++)add(g,g_cone(.022,.11,5),0xd8c9a8,-.17,.72,.1+i*.045,{rz:.45});
    g.userData.wep=bow;
  }else{
    add(g,g_box(.19,.16,.24),shade3(c,.42),0,.19,0);         // 战裙
    add(g,g_box(.29,.26,.25),c,0,.4,0);                      // 胸甲
    add(g,g_box(.3,.05,.26),GOLD,0,.29,0);                   // 腰带
    add(g,g_sph(.105,8),lt,0,.52,-.185);                     // 护肩
    add(g,g_sph(.105,8),lt,0,.52,.185);
    face();
    add(g,g_sph(.208,10),HAIR,-.02,HY+.04,0,{s:[.94,.94,1.02]});
    for(let i=0;i<3;i++)                                     // 竖起的短发
      add(g,g_cone(.06,.17,5),HAIR,-.02+i*.045,HY+.22,(i-1)*.1,{rz:-.25});
    add(g,g_box(.035,.045,.34),tier?GOLD:0xb9c6d6,.16,HY+.1,0);  // 额带/头环
    /* 盾 */
    add(g,g_box(.05,.28,.24),0xc3cede,-.11,.44,-.23);
    add(g,g_box(.03,.2,.17),shade3(c,.85),-.145,.44,-.23);
    if(tier)add(g,g_sph(.05,7),GOLD,-.15,.44,-.23,{glow:1});
    /* 剑（绕肩挥砍） */
    const sw=mk();
    add(sw,g_box(.05,tier?.56:.46,.1),0xeef4fc,0,tier?.29:.24,0);
    add(sw,g_box(.055,.055,.22),GOLD,0,.02,0);
    if(tier)add(sw,g_box(.075,.5,.13),0xffd98a,0,.3,0,{glow:1,op:.32,noSh:1});
    sw.position.set(.11,.5,.23);sw.rotation.z=.25;
    g.add(sw);
    g.userData.mats.push(...sw.userData.mats);g.userData.base.push(...sw.userData.base);
    g.userData.wep=sw;
  }

  /* ---- 转职通用：披风 + 肩章 ---- */
  if(tier){
    const cl=add(g,g_cone(.3,.7,7),CLOAK,-.14,.36,0,{rz:-.1});
    cl.scale.set(.5,1,1.2);
    add(g,g_sph(.055,7),GOLD,-.06,.56,-.2);
    add(g,g_sph(.055,7),GOLD,-.06,.56,.2);
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
/* 商店广场：暖色土/碎石地（比战斗区石板亮，和草地、石板都分得开） */
function texDirt(){
  return makeTex(256,(x,S)=>{
    x.fillStyle='#59492f';x.fillRect(0,0,S,S);
    for(let i=0;i<40;i++){                         // 土色斑块
      const px=srand()*S,py=srand()*S,r=12+srand()*30;
      const g=x.createRadialGradient(px,py,0,px,py,r);
      g.addColorStop(0,srand()>.5?'#6b5838':'#48391f');
      g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g;x.beginPath();x.arc(px,py,r,0,7);x.fill();
    }
    for(let i=0;i<900;i++){                        // 碎石
      const v=srand(),s=1+(v>.85?2:0);
      x.fillStyle=v>.8?'#8a7b60':v>.5?'#6d5c3d':'#3d3120';
      x.fillRect(srand()*S,srand()*S,s,s);
    }
  },[1,1]);
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
/* 传送门能量幕：竖直流光条纹 + 中间亮芯，水平方向可平铺（用来做滚动动画） */
function texPortal(){
  return makeTex(256,(x,S)=>{
    x.clearRect(0,0,S,S);
    for(let i=0;i<44;i++){
      const px=srand()*S, w=2+srand()*11, a=.12+srand()*.5;
      const g=x.createLinearGradient(0,0,0,S);
      const c=`${(180+srand()*70)|0},${(90+srand()*90)|0},255`;
      g.addColorStop(0,`rgba(${c},0)`);
      g.addColorStop(.5,`rgba(${c},${a})`);
      g.addColorStop(1,`rgba(${c},0)`);
      x.fillStyle=g;x.fillRect(px,0,w,S);
      if(px+w>S)x.fillRect(px-S,0,w,S);          // 跨边界补一笔，保证无缝
    }
    const cg=x.createLinearGradient(0,0,0,S);    // 中间亮芯
    cg.addColorStop(0,'rgba(120,60,200,0)');
    cg.addColorStop(.5,'rgba(232,196,255,.5)');
    cg.addColorStop(1,'rgba(120,60,200,0)');
    x.fillStyle=cg;x.fillRect(0,0,S,S);
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
  {k:'mill', name:'伐木场'},   // 第1排建筑：伐木场|金矿，上有树、下有矿脉，工人两边跑
  {k:'mine', name:'金矿'},
  {k:'skill',name:'技能'},     // 第2排建筑：技能|装备
  {k:'item', name:'装备'},
];
/* 左侧广场从上到下四排（可见地面 z≈-0.5~5.03，四排刚好塞满）：
   ① 5棵树 TREE_Z  ② 伐木场|金矿 INC_Z  ③ 5处矿脉 ORE_Z  ④ 技能|装备 SHOP_Z */
const SHOP_X0B=-3.75, SHOP_DX=1.95, SHOP_R=.9;
const INC_Z=1.30, SHOP_Z=3.95;
/* 宽屏时横向会多出空间：整排商店往左挪(shopShift)，广场跟着变宽，左边就不空了（resize 里算） */
let SHOP_X0=SHOP_X0B, shopShift=0;
const SHIFT_MAX=2.6;                               // 最多往左挪这么多
const shopPos=i=>[SHOP_X0+(i%2)*SHOP_DX, i<2?INC_Z:SHOP_Z];
const SHOP_S=1.4;                                  // 建筑整体缩放（四排要塞下，比 2×2 时略小）
let shopGroups=[],circles=[],yard=null;
/* 把商店排 + 脚下广场按当前 shopShift 摆好（init 和 resize 都调） */
function layoutShops(){
  SHOP_X0=SHOP_X0B-shopShift;
  for(let i=0;i<shopGroups.length;i++){
    const [px,pz]=shopPos(i);
    shopGroups[i].position.x=px;shopGroups[i].position.z=pz;
  }
  if(yard){                                        // 广场从商店左侧一直铺到战斗区边上，中间不留空地
    const x0=SHOP_X0-1.35, x1=-.26, w=x1-x0, d=BZ1-BZ0;
    yard.scale.set(w,d,1);
    yard.position.set((x0+x1)/2,.004,(BZ0+BZ1)/2);
    yard.material.map.repeat.set(w/2.1,d/2.1);
  }
  layoutNodes();
}

/* ================= 资源点 + 工人 =================
   上排 5 棵树（伐木工砍）/ 下排 5 处金矿脉（矿工挖），横向跟着广场一起铺开。
   工人数 = rpg.js 的 mineW/millW（最多 5），从离本建筑最近的资源点开始往外占。
   一趟 TRIP 秒，落一个 “+等级×TRIP” 的飘字 —— 正好等于 每秒 工人数×等级 的真实产出。 */
const NODE_N=5, TRIP=3;
const TREE_Z=.2, ORE_Z=2.62;         // 树在最上面一排、矿脉夹在两排建筑之间
/* ⚠️ 树高别超过 .89：z=.2 处树梢投影 v=(H-.31)·cos50°+2.3·sin50°，相机上沿 hh≈2.134 */
let treeG=[],oreG=[],nodeX=[];
function layoutNodes(){
  const x0=SHOP_X0-1.0, x1=-.62;
  for(let i=0;i<NODE_N;i++){
    nodeX[i]=x0+(x1-x0)*i/(NODE_N-1);
    if(treeG[i])treeG[i].position.x=nodeX[i];
    if(oreG[i]) oreG[i].position.x=nodeX[i];
  }
}
function buildTree(){                // 高约 .76
  const g=mk();
  add(g,g_cyl(.065,.085,.3,6),0x4a3a2a,0,.15,0);
  add(g,g_cone(.29,.38,7),0x24422c,0,.42,0);
  add(g,g_cone(.21,.28,7),0x2d5236,0,.62,0);
  return g;
}
function buildOre(){                 // 金矿脉：碎石堆 + 露出来的金块
  const g=mk();
  add(g,g_oct(.26),0x4a5164,0,.17,0,{s:[1.25,.85,1]});
  add(g,g_oct(.15),0x565f74,.24,.1,.13);
  add(g,g_oct(.09),0xf0c46a,-.05,.31,.11,{em:0x6b4d12});
  add(g,g_oct(.07),0xf0c46a,.2,.19,-.12,{em:0x6b4d12});
  return g;
}
/* 工人：矮胖小人（约英雄一半高），模型面朝 +X，挥动的工具挂在 userData.tool 上 */
function buildWorker(kind){
  const isM=kind==='mine', g=mk();
  add(g,g_cyl(.05,.05,.16,6),0x39415a,0,.08,.06);
  add(g,g_cyl(.05,.05,.16,6),0x39415a,0,.08,-.06);
  add(g,g_box(.2,.24,.19),isM?0x4f6a9a:0xb04a3a,0,.28,0);
  add(g,g_sph(.145,10),0xf3c9a0,0,.52,0);
  add(g,g_sph(.155,10),isM?0xf0c46a:0x7a4a2e,0,.56,0,{s:[1,.6,1]});
  add(g,g_sph(.02,6),0x21252e,.12,.51,.055,{noSh:1});
  add(g,g_sph(.02,6),0x21252e,.12,.51,-.055,{noSh:1});
  const tool=mk();
  add(tool,g_cyl(.022,.022,.42,6),0x6b5236,0,0,0,{rz:PI/2});
  if(isM)add(tool,g_box(.06,.07,.2),0x9aa6bc,.2,.03,0,{rz:.4});
  else   add(tool,g_box(.045,.17,.12),0xc8d2dc,.2,.02,0);
  tool.position.set(.15,.34,.03);
  g.add(tool);g.userData.tool=tool;
  return g;
}
/* 工人循环：出门 → 到资源点砍/挖 → 回家交货（交货那一刻落飘字） */
let wkT=0,_lastGt=0;
const wkCyc={};
function drawWorkers(){
  const d=max(0,min(gt-_lastGt,.1));_lastGt=gt;
  if(started&&!over)wkT+=d*(typeof speed==='number'?speed:1);
  for(let s=0;s<2;s++){
    const isM=s===1;                                   // 0=伐木场(上) 1=金矿(下)
    const key=isM?'mine':'mill';
    const n=min(NODE_N,(isM?mineW:millW)|0);
    const lv=(isM?mineLv:millLv)|0;
    let idx=0;for(let i=0;i<SHOPS.length;i++)if(SHOPS[i].k===key)idx=i;
    // 出门口开在靠资源的那一侧（矿脉在建筑下方、树在建筑上方）
    const hp=shopPos(idx), hx=hp[0], hz=hp[1]+(isM?.45:-.45);
    const nz=isM?ORE_Z:TREE_Z, stand=isM?nz-.38:nz+.38;
    // 就近占点：按离本建筑的横向距离排序
    const order=nodeX.map((v,j)=>j).sort((a,b)=>abs(nodeX[a]-hx)-abs(nodeX[b]-hx));
    for(let i=0;i<n;i++){
      const ph0=wkT/TRIP+i*.37, ph=ph0-Math.floor(ph0), ci=Math.floor(ph0);
      const nx=nodeX[order[i]]||0;
      let x,z,face,swing=0;
      if(ph<.32){                                      // 出门
        const k=ph/.32;x=hx+(nx-hx)*k;z=hz+(stand-hz)*k;
        face=Math.atan2(-(stand-hz),nx-hx);
      }else if(ph<.72){                                // 干活
        x=nx;z=stand;swing=1;
        face=Math.atan2(-(nz-stand),0);
      }else{                                           // 回家交货
        const k=(ph-.72)/.28;x=nx+(hx-nx)*k;z=stand+(hz-stand)*k;
        face=Math.atan2(-(hz-stand),hx-nx);
      }
      const g=take('WK'+key,()=>buildWorker(key));
      const walk=swing?0:abs(sin(wkT*9+i));
      g.position.set(x,walk*.045,z);
      g.rotation.y=face;
      g.userData.tool.rotation.z=swing?-1.35*(.5+.5*sin(wkT*11+i*2)):-.35;
      // 交货：一趟结算一次，金额 = 等级×TRIP，合起来正好是 每秒 工人数×等级
      const ck=key+i;
      if(wkCyc[ck]===undefined)wkCyc[ck]=ci;
      else if(ci!==wkCyc[ck]){
        wkCyc[ck]=ci;
        if(started&&!over&&lv>0&&nums.length<80)
          nums.push({x:hx,y:hz-.15,txt:'+'+(lv*TRIP),color:isM?'#f0c46a':'#c98f5b',t:1.1,max:1.1});
      }
    }
  }
}
function shopAt(x,z){                              // 供 rpg.js 判断点击
  for(let i=0;i<SHOPS.length;i++){
    const [px,pz]=shopPos(i);
    if(abs(x-px)<SHOP_R&&abs(z-pz)<SHOP_R)return SHOPS[i].k;
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

/* ================= 传送门（怪从这里涌出来） ================= */
/* ⚠️ rpg3d.js 比 rpg.js 先加载，模块顶层拿不到 COLS/ROWS，只能在 init 时赋值 */
let PORTAL_X=0, portalG=null, portalVeil=[];
let BZ0=-1.3, BZ1=0;                 // 石板路纵向范围（init 里按 ROWS 定）
function buildPortal(glowTex){
  PORTAL_X=COLS+.15;
  const g=new T.Group();
  g.position.set(PORTAL_X,0,ROWS/2);
  const W=ROWS+.3, H=2.0;
  const tex=texPortal();
  /* 两层能量幕反向滚动，叠出流动感（加性混合，够亮） */
  for(let i=0;i<2;i++){
    const t2=tex.clone();t2.needsUpdate=true;
    t2.wrapS=t2.wrapT=T.RepeatWrapping;t2.repeat.set(2.2,1);
    const m=new T.Mesh(new T.PlaneGeometry(W,H),
      new T.MeshBasicMaterial({map:t2,transparent:true,depthWrite:false,
        blending:T.AdditiveBlending,side:T.DoubleSide,opacity:i?.72:1}));
    m.rotation.y=-PI/2;m.position.y=H/2;
    g.add(m);portalVeil.push({m,tex:t2,dir:i?-1:1});
  }
  /* 门框：两根石柱 + 顶部横梁 */
  for(const z of [-W/2,W/2]){
    const p1=new T.Mesh(g_cyl(.13,.17,H+.25,8),new T.MeshLambertMaterial({color:0x4a3f66}));
    p1.position.set(0,(H+.25)/2,z);p1.castShadow=true;g.add(p1);
    const cap=new T.Mesh(g_sph(.22,10),new T.MeshBasicMaterial({color:0xd9b6ff}));
    cap.position.set(0,H+.3,z);g.add(cap);
  }
  const bar=new T.Mesh(g_box(.22,.2,W+.3),new T.MeshLambertMaterial({color:0x4a3f66}));
  bar.position.y=H+.1;bar.castShadow=true;g.add(bar);
  /* 地面光带 */
  const gl=new T.Mesh(new T.PlaneGeometry(2.2,W+.4),
    new T.MeshBasicMaterial({map:glowTex,transparent:true,opacity:.3,
      depthWrite:false,blending:T.AdditiveBlending,color:0xb070ff}));
  gl.rotation.x=-PI/2;gl.position.y=.02;g.add(gl);
  const bg=new T.Mesh(new T.PlaneGeometry(W,H),      // 幕后一层底色，衬出门的轮廓
    new T.MeshBasicMaterial({color:0x2a1140,transparent:true,opacity:.72,
      depthWrite:false,side:T.DoubleSide}));
  bg.rotation.y=-PI/2;bg.position.set(.04,H/2,0);g.add(bg);
  portalG=g;g.userData.glow=gl;
  scene.add(g);
}

/* ================= 地图装饰（树/石头/草簇，只摆在战场外围） ================= */
function scatterDecor(){
  const inBattle=(x,z)=>x>-.7&&x<PORTAL_X+1.4&&z>BZ0-.3&&z<BZ1+.3;
  /* 商店排会随 shopShift 往左挪，这里按最大挪动量留出空地，别让树长到广场里 */
  const inShops =(x,z)=>x>SHOP_X0B-SHIFT_MAX-1.8&&x<SHOP_X0B+SHOP_DX+1.4&&z>-.9&&z<ROWS+.9;
  let n=0,guard=0;
  while(n<78&&guard++<1400){                       // 上方露出的草地也要有东西，范围往上铺开
    const x=-6+srand()*(COLS+12), z=-6+srand()*(ROWS+10);
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
  sc.left=-COLS*.95;sc.right=COLS*.72;             // 左边要罩住挪出去的商店排sc.top=ROWS*2.4;sc.bottom=-ROWS*2.4;sc.near=1;sc.far=34;
  scene.add(dirLight);scene.add(dirLight.target);
  dirLight.target.position.set(COLS/2,0,ROWS/2);
  const fill=new T.DirectionalLight(0x5f7fb8,.5);fill.position.set(6,4,6);scene.add(fill);

  const glowTex=texGlow(), runeTex=texRune();

  /* 连贯的草地大地图（一整张，战斗区只是铺在上面的石板路） */
  const ground=new T.Mesh(new T.PlaneGeometry(COLS+24,ROWS+22),
    new T.MeshLambertMaterial({map:texGrass()}));
  ground.rotation.x=-PI/2;ground.position.set(COLS/2,0,ROWS/2);ground.receiveShadow=true;
  scene.add(ground);

  /* 战斗区：石板路台面（边缘有厚度，和草地区分开）
     右边一直铺到传送门脚下（BW>COLS），不然屏幕右侧会留一条空草地 */
  const BW=COLS+.95;
  BZ0=-1.3;BZ1=ROWS+1.3;                          // 纵向也多铺出去，屏幕上下不露草地
  const BD=BZ1-BZ0, BZC=(BZ0+BZ1)/2;
  const board=new T.Mesh(new T.BoxGeometry(BW,.14,BD),
    new T.MeshLambertMaterial({color:0x222c3e}));
  board.position.set(BW/2,-.07,BZC);board.receiveShadow=true;
  scene.add(board);
  const road=new T.Mesh(new T.PlaneGeometry(BW,BD),
    new T.MeshLambertMaterial({map:texStone(),color:0xffffff}));
  road.material.map.repeat.set(BW/1.6,BD/1.6);
  road.rotation.x=-PI/2;road.position.set(BW/2,.005,BZC);road.receiveShadow=true;
  scene.add(road);

  /* 左侧商店广场：碎石地，宽度跟着 shopShift 变（layoutShops 里设），把左边空草地填掉 */
  yard=new T.Mesh(new T.PlaneGeometry(1,1),
    new T.MeshLambertMaterial({map:texDirt()}));
  yard.rotation.x=-PI/2;yard.receiveShadow=true;
  scene.add(yard);

  /* 左侧出兵位：不再是色块，改成职业色法阵光圈 */
  for(let c=0;c<HCOLS;c++){
    const col=CLASSES[COL_CLASS[c]].color;
    for(let r=ROW0;r<ROW0+HROWS;r++){
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
    g.scale.setScalar(SHOP_S);
    g.userData.k=SHOPS[i].k;
    shopGroups.push(g);scene.add(g);
  }
  for(let i=0;i<NODE_N;i++){
    const tr=buildTree();tr.position.set(0,0,TREE_Z);scene.add(tr);treeG.push(tr);
    const or=buildOre(); or.position.set(0,0,ORE_Z); scene.add(or); oreG.push(or);
  }
  layoutShops();
  buildPortal(glowTex);
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
  /* 纵向：**下沿死死贴着第5行地面，多出来的纵向空间全部留给上面**（用户明确要求：
     下面不留多余空间，上面可以留）。相机看向 y=yc：v(y,z)=(y-yc)*cos(TILT)-(z-tz)*sin(TILT)，
     下沿 v(0,ROWS)=-hh 反解出 tz；hh==needH 时正好回到 tz=ROWS/2。 */
  const HEAD=.62, yc=HEAD/2;
  const xR=PORTAL_X+.8, xLB=SHOP_X0B-1.45;
  const needW=(xR-xLB)/2;
  const needH=yc*cos(TILT)+(ROWS/2)*sin(TILT)+.02;
  const hh=max(needH,needW/asp), hw=max(needW,hh*asp);
  cam.left=-hw;cam.right=hw;cam.top=hh;cam.bottom=-hh;
  /* 屏幕特别扁时横向会富余：先让商店整排往左挪(广场跟着变宽)，
     剩下的富余全部留给左边——相机右沿死死贴着传送门，右侧不留空地 */
  shopShift=min(SHIFT_MAX,max(0,(hw-needW)*2));
  layoutShops();
  const tx=xR-hw;
  const tz=ROWS-(hh-.02-yc*cos(TILT))/sin(TILT);   // 下沿贴第5行，富余全给上面
  cam.position.set(tx,yc+CAM_D*sin(TILT),tz+CAM_D*cos(TILT));
  cam.lookAt(tx,yc,tz);
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

  /* --- 传送门：能量幕反向滚动，有怪时更亮 --- */
  if(portalG){
    const hot=mobs.length?1:.45;
    for(const v of portalVeil){
      v.tex.offset.x-=v.dir*.0022;
      v.tex.offset.y=sin(gt*.6*v.dir)*.05;
      v.m.material.opacity=(v.dir>0?1:.72)*hot*(.85+.15*sin(gt*2.4+v.dir));
    }
    portalG.userData.glow.material.opacity=.3*hot*(.8+.2*sin(gt*3));
  }

  /* --- 商店建筑：待机动画 + 打开中的高亮 --- */
  for(const g of shopGroups){
    const u=g.userData,on=openShop===u.k;
    const p=.5+.5*sin(gt*3+u.k.length);
    u.halo.material.opacity=on?.3+.22*p:.13;
    u.halo.material.color.set(on?0xffd24f:0x8ab8d8);
    if(u.spin)u.spin.rotation.y=gt*3.6;
    if(u.bob){u.bob.position.y=.72+.05*sin(gt*2.2);u.bob.rotation.y=gt*.72;}
    if(u.pulse)u.pulse.scale.setScalar(.85+.3*p);
    g.position.y=on?.05+.03*p:0;
  }
  drawWorkers();

  /* 建筑名牌（覆盖层，跟着建筑走） */
  for(let i=0;i<SHOPS.length;i++){
    const [sx,sz]=shopPos(i);
    const u=ppu(sx,.9,sz), sp=proj(sx,0,sz+.75);   // 名牌画在建筑正下方
    const on=openShop===SHOPS[i].k;
    const fs=max(11,.23*u);
    octx.textAlign='center';                     // 名牌画在建筑正下方（2×2 时上方总是别的建筑）
    octx.font='700 '+fs.toFixed(1)+'px -apple-system,sans-serif';
    octx.lineWidth=3.5;octx.strokeStyle='rgba(0,0,0,.75)';
    octx.strokeText(SHOPS[i].name,sp[0],sp[1]);
    octx.fillStyle=on?'#ffd24f':'#dce6f2';
    octx.fillText(SHOPS[i].name,sp[0],sp[1]);
    // 技能/装备不再显示小字，只有金矿伐木场标 Lv 和产量
    const k=SHOPS[i].k;
    const sub=k==='mine'?'Lv'+mineLv+'·'+mineW+'人 +'+(mineW*mineLv)+'/s'
             :k==='mill'?'Lv'+millLv+'·'+millW+'人 +'+(millW*millLv)+'/s':'';
    if(sub){
      octx.font='500 '+(fs*.72).toFixed(1)+'px -apple-system,sans-serif';
      octx.strokeText(sub,sp[0],sp[1]+fs*.95);
      octx.fillStyle='rgba(190,205,225,.9)';
      octx.fillText(sub,sp[0],sp[1]+fs*.95);
    }
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
    const g=bind(h,'H'+h.cls+h.tier+h.branch,()=>buildHero(h.cls,h.tier,h.branch));
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
      if(h.cls==='warrior')wep.rotation.z=-2.1*p+.25;   // 挥砍
      else wep.position.x=.24-.11*p;                     // 拉弓
    }
    if(g.userData.orb)g.userData.orb.scale.setScalar(1+.22*sin(gt*4)+p*.6);
    if(g.userData.orbit){                                // 转职法师：宝珠环绕光环
      g.userData.orbit.rotation.z=gt*3;
      g.userData.orbit.rotation.y=gt*.9;
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
  cardTick();

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

/* ================= 角色卡片里的 3D 预览 =================
   用一个独立的小 renderer 逐张渲染，再 drawImage 到各卡片的 2D canvas 上。
   这样只多占 1 个 WebGL context（手机上下文数量有限，别一卡一个）。
   rpg.js 通过 R3.cardShow([{canvas,cls,tier,branch}]) 挂上，cardHide() 摘掉。 */
let cardRen,cardScene,cardCam,cardSlot;
let cardViews=[];
const cardCache={};
function cardInit(){
  const c=document.createElement('canvas');
  cardRen=new T.WebGLRenderer({canvas:c,antialias:true,alpha:true});
  cardRen.setPixelRatio(min(window.devicePixelRatio||1,2));
  cardRen.setSize(200,240,false);
  cardScene=new T.Scene();
  cardScene.add(new T.HemisphereLight(0xd6e6ff,0x33405c,1.5));
  const d1=new T.DirectionalLight(0xfff4e0,1.7);d1.position.set(3,5,4);cardScene.add(d1);
  const d2=new T.DirectionalLight(0x8fb0ff,.7); d2.position.set(-4,2,-3);cardScene.add(d2);
  cardCam=new T.OrthographicCamera(-.62,.62,.86,-.62,.1,20);
  cardCam.position.set(1.5,1.3,3.2);cardCam.lookAt(0,.5,0);
  cardSlot=new T.Group();cardScene.add(cardSlot);
}
function cardShow(list){
  if(!cardRen)cardInit();
  cardViews=list||[];
}
function cardHide(){cardViews=[];}
function cardTick(){
  if(!cardViews.length)return;
  for(const v of cardViews){
    const key=v.cls+'|'+(v.tier|0)+'|'+(v.branch|0);
    let g=cardCache[key];
    if(!g)g=cardCache[key]=buildHero(v.cls,v.tier,v.branch);
    cardSlot.clear();cardSlot.add(g);
    /* 模型面朝 +X，转 90° 才面对相机；再左右缓慢摆动展示侧面 */
    /* 模型面朝 +X；相机在 (1.5,1.3,3.2)，要转到 -PI/2 附近才是面对镜头 */
    g.rotation.y=-PI/2+.34+sin(gt*.6+(v.phase||0))*.26;
    g.position.y=sin(gt*1.6+(v.phase||0))*.012;
    cardRen.render(cardScene,cardCam);
    const cv=v.canvas;
    if(!cv||!cv.width)continue;
    const x=cv.getContext('2d');
    x.clearRect(0,0,cv.width,cv.height);
    x.drawImage(cardRen.domElement,0,0,cv.width,cv.height);
  }
}

return {resize,draw,pick,shopAt,cardShow,cardHide};
})();
