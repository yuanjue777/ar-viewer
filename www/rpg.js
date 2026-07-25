'use strict';
/* ================= 职业（魔兽式属性）================= */
const ROWS=3, HCOLS=3, BCOLS=13, COLS=HCOLS+BCOLS, TOTAL_WAVES=25, HERO_COST=50, MAX_HEROES=3;
const MAX_SLOTS=4, MAX_SKILL_LV=10, MAX_EQUIP=6, MAX_HERO_LV=15;   // 装备栏2×3
const COL_CLASS=['mage','archer','warrior'];
/* bat=基础攻击间隔s wep=武器基础攻击 main=主属性(加攻) grow=每级属性成长 */
const CLASSES={
  mage:  {name:'法师',color:'#4f8dff',hpB:60,wep:6, bat:1.9,baseArmor:1,range:4.5,splash:1.1,main:'int',
          attr:{str:8, agi:12,int:24},grow:{str:1.1,agi:1.4,int:3.2},desc:'远程溅射·主智力'},
  archer:{name:'游侠',color:'#57d474',hpB:70,wep:8, bat:1.3,baseArmor:2,range:6,  splash:0,  main:'agi',
          attr:{str:10,agi:22,int:12},grow:{str:1.4,agi:2.9,int:1.5},desc:'中程速射·主敏捷'},
  warrior:{name:'战士',color:'#ff5d5d',hpB:90,wep:15,bat:1.7,baseArmor:4,range:1.15,splash:0, main:'str',
          attr:{str:22,agi:10,int:8}, grow:{str:2.7,agi:1.3,int:1.0},desc:'近战坦克·主力量'},
};
/* 转职分支：每职业2条路线，各带1个专精技能（专精用金+木升级，上限Lv5） */
const ADV={
  warrior:[
    {key:'berserker',name:'狂战士',atk:1.6,hp:1.5,bat:.9, range:.25,splash:0},
    {key:'guard',    name:'护卫',  atk:1.3,hp:1.9,bat:.95,range:.2, splash:0},
  ],
  archer:[
    {key:'elf',  name:'精灵游侠',atk:1.4,hp:1.3, bat:.85,range:1.5,splash:0},
    {key:'death',name:'死亡射手',atk:1.6,hp:1.25,bat:.9, range:1.2,splash:0},
  ],
  mage:[
    {key:'priest',name:'牧师',  atk:1.4,hp:1.5,bat:1,range:1,splash:.2},
    {key:'druid', name:'德鲁伊',atk:1.4,hp:1.4,bat:1,range:1,splash:.2},
  ],
};
const SPECS={
  berserker:{n:'血怒',    d:lv=>`失血越多输出越高：攻击+失血比×${15+10*lv}%，攻速+失血比×${30+15*lv}点`},
  guard:    {n:'坚壁',    d:lv=>`护甲+${3*lv}`},
  elf:      {n:'迅捷',    d:lv=>`攻击间隔额外-${(0.2+0.01*lv).toFixed(2)}s`},
  death:    {n:'死神收割',d:lv=>`每有敌人死亡+0.5敏捷，上限${20+10*(lv-1)}`},
  priest:   {n:'治愈祷言',d:lv=>`主动(30蓝,CD8s)：回复全体英雄 30+智×${(0.6+0.4*lv).toFixed(1)} 生命`},
  druid:    {n:'自然之力',d:lv=>`召唤物属性+${20*lv}%`},
};
function advOf(h){return h.tier?ADV[h.cls][h.branch]:null;}
function specCost(lv){return {g:60+40*(lv-1),w:40+25*(lv-1)};}   // 专精升级费用（当前级→下一级）
const SPEC_MAX=10;
const ADV_LV=5, ADV_GOLD=400, ADV_WOOD=250;
/* 英雄递增定价：第1个50、第2个100、第3个200 */
const HERO_COSTS=[50,100,200];
function heroCost(){return HERO_COSTS[Math.min(heroes.length,HERO_COSTS.length-1)];}
function xpNeed(lv){return 40+45*(lv-1);}
/* 魔兽护甲减伤公式 */
function armorRed(a){const v=a*.06;return v>0?v/(1+v):0;}

/* ================= 技能书 ================= */
const SKB={
  '狂战士之血':{cat:'str',q:'qblue',  short:'狂血',cd:0, desc:'被动：血越低回血越快、受伤越少（血量50%时约每秒回2%×等级）'},
  '荆棘光环':  {cat:'str',q:'qgreen', short:'荆棘',cd:0, desc:'被动：反弹15%×等级伤害，附加0.4×力量×等级（魔法伤害）'},
  '攻击溅射':  {cat:'str',q:'qpurple',short:'溅射',cd:0, desc:'被动：普攻对目标1.5格内溅射(25+5×等级)%伤害，多重射击的额外攻击同样触发'},
  '大地震颤':  {cat:'str',q:'qpurple',short:'震颤',cd:14,mana:25,desc:'主动(25蓝)：震裂身前3×4.5格矩形地面，每0.5秒造成一次伤害，持续(3+0.5×等级)秒，每秒(10+力量×0.4×等级)魔法伤害，区域内敌人移速与攻速-30%'},
  '忍受':      {cat:'str',q:'qblue',  short:'忍受',cd:18,mana:20,desc:'主动(20蓝)：进入忍受状态，持续(3+等级)秒，期间受到的伤害减少(20+3×等级)%（与其它减伤相乘），附近有敌人时自动开启'},
  '多重射击':  {cat:'agi',q:'qblue',  short:'多重',cd:0, desc:'被动：普攻额外射击 等级×0.5 个敌人（70%伤害）'},
  '沁毒射击':  {cat:'agi',q:'qgreen', short:'沁毒',cd:0, desc:'被动：普攻附带毒伤=敏捷×(0.35+0.15×等级)（魔法伤害）'},
  '剑雨':      {cat:'agi',q:'qgreen', short:'剑雨',cd:8, mana:25,desc:'主动(25蓝)：天降剑雨，对半径2格内所有敌人造成(20+敏捷×0.5×等级)魔法伤害'},
  '狙击潜质':  {cat:'agi',q:'qpurple',short:'狙击',cd:0, desc:'被动：射程+0.3格×等级（同时加长主动技能释放距离）'},
  '致命一击':  {cat:'agi',q:'qpurple',short:'致命',cd:0, desc:'被动：(15+5×等级)%几率暴击，造成(140+10×等级)%伤害，金色飘字'},
  '召唤熊德':  {cat:'int',q:'qblue',  short:'熊德',cd:22,mana:50,desc:'主动(50蓝)：召近战熊灵冲锋接敌，属性随智力成长'},
  '火元素':    {cat:'int',q:'qgreen', short:'火元素',cd:16,mana:30,desc:'主动(30蓝)：召唤1只火元素，远程(2.6格)喷火，每1.2秒造成(7+智×0.5×等级)魔法伤害，HP=70+智×3×等级，持续(10+1.5×等级)秒'},
  '水元素':    {cat:'int',q:'qblue',  short:'水元素',cd:20,mana:40,desc:'主动(40蓝)：召唤2只水元素近战肉盾，各每1.1秒造成(6+智×0.42×等级)物理伤害，各HP=90+智×4×等级，持续(12+2×等级)秒'},
  '地狱火':    {cat:'int',q:'qpurple',short:'地狱火',cd:30,mana:60,desc:'主动(60蓝)：召唤1只地狱火，每1.4秒造成(16+智×1.1×等级)物理伤害并对1.2格内溅射50%，HP=220+智×9×等级，持续(15+2×等级)秒'},
  '火球术':    {cat:'int',q:'qgreen', short:'火球',cd:7, mana:25,desc:'主动(25蓝)：单体魔法伤害（智力×3×等级+40），弹道线'},
  '冰风暴':    {cat:'int',q:'qpurple',short:'冰风',cd:10,mana:35,desc:'主动(35蓝)：暴风雪，固定区域每0.9秒对圈内全体造成(15+智×0.8×等级)魔法伤+减速，共(3+等级)波'},
  'CD光环':    {cat:'int',q:'qblue',  short:'CD环',cd:0, desc:'被动：主动技能冷却-4%×等级（与装备CD缩减叠加，总上限50%）'},
  '火焰风暴':  {cat:'int',q:'qblue',  short:'火风',cd:12,mana:40,desc:'主动(40蓝)：延迟1秒后在半径1.5格区域燃起烈焰，每0.5秒灼烧一次，持续(2+0.5×等级)秒，每秒(12+智×0.55×等级)魔法伤害'},
  '闪电链':    {cat:'int',q:'qblue',  short:'闪电',cd:4, mana:16,desc:'主动(16蓝)：短CD低耗蓝，闪电跳(2+等级)个目标，各(12+智×0.45×等级)魔法伤害'},
  '魂吸':      {cat:'int',q:'qpurple',short:'魂吸',cd:0, desc:'被动：每有敌方单位死亡+0.5智力，上限10+5×(等级-1)'},
};
const QC={qgreen:'#5ad48a',qblue:'#4fa8ff',qpurple:'#b070ff'};
const QN={qgreen:'绿',qblue:'蓝',qpurple:'紫'};
/* 技能书按品质加权roll：绿3/蓝2/紫1 */
function pickBook(pool){
  const w=n=>({qgreen:3,qblue:2,qpurple:1})[SKB[n].q]||1;
  let tot=0;for(const n of pool)tot+=w(n);
  let r=Math.random()*tot;
  for(const n of pool){r-=w(n);if(r<0)return n;}
  return pool[pool.length-1];
}
const CATS={str:{label:'力量',color:'#ff5d5d'},agi:{label:'敏捷',color:'#57d474'},int:{label:'智力',color:'#4f8dff'}};
const PACK_COST=200, ROLL_COST=125, PACK_N=4;
/* 出售：只有装备能卖，技能书不能卖；返还压低到roll成本的40~60% */
const SELL_EQ={common:8,fine:18,rare:40,epic:80};
function canSell(it){return it.t==='eq';}
function sellValue(it){return canSell(it)?(SELL_EQ[eqDef(it).q]||8):0;}

/* ================= 装备池（用户自定义，持续扩充）================= */
const QUALS={
  common:{n:'白色',c:'#c8d2dc',w:50},
  fine:  {n:'绿色',c:'#5ad48a',w:35},
  rare:  {n:'蓝色',c:'#4fa8ff',w:15},
  epic:  {n:'紫色',c:'#b070ff',w:0},   // 预留
};
const EQUIPS=[
  {id:'sword1',   n:'新手剑',  s:'新剑',q:'common',stats:{atk:10}},
  {id:'bow1',     n:'新手弓',  s:'新弓',q:'common',stats:{aspd:15}},
  {id:'staff1',   n:'新手法杖',s:'法杖',q:'common',stats:{cdr:.05}},
  {id:'hammer',   n:'狼牙锤',  s:'狼牙',q:'fine',  stats:{str:15}},
  {id:'shield1',  n:'小圆盾',  s:'圆盾',q:'fine',  stats:{armor:10}},
  {id:'fang',     n:'毒牙之刃',s:'毒牙',q:'fine',  stats:{agi:15}},
  {id:'doranring', n:'多兰戒', s:'多兰',q:'fine',  stats:{mpre:3}},
  {id:'thunderbow',n:'雷鸣弓', s:'雷弓',q:'rare',  stats:{bat:.1,aspd:20}},
  {id:'poorshield',n:'穷鬼盾', s:'穷盾',q:'rare',  stats:{block:20}},
  {id:'manaring',  n:'法力指环',s:'蓝戒',q:'rare', stats:{mpre:8}},
  {id:'dragonlance',n:'魔龙枪',s:'龙枪',q:'epic',  stats:{agi:20,range:2}},
  /* 精英池：只从精英试炼的宝箱掉落，商店roll不出（boss池以后再加）*/
  {id:'eliteblade', n:'精英战刃',s:'战刃',q:'epic',pool:'elite',stats:{atk:30,str:12}},
  {id:'elitecloak', n:'幽影斗篷',s:'幽影',q:'epic',pool:'elite',stats:{agi:22,aspd:25}},
  {id:'elitecrown', n:'秘法王冠',s:'王冠',q:'epic',pool:'elite',stats:{int:22,cdr:.1}},
  {id:'elitegirdle',n:'巨力腰带',s:'腰带',q:'rare',pool:'elite',stats:{str:18,hp:120}},
  {id:'elitetalis', n:'守护护符',s:'护符',q:'rare',pool:'elite',stats:{armor:8,mres:.15}},
];
const EQ_BY_ID=Object.fromEntries(EQUIPS.map(e=>[e.id,e]));
/* 装备商店三档roll：每次固定4件，越贵越容易出高品质 */
const EQ_TIERS={
  low: {n:'低级roll',cost:100,w:{common:60,fine:30,rare:9, epic:1}},
  mid: {n:'中级roll',cost:200,w:{common:30,fine:40,rare:24,epic:6}},
  high:{n:'高级roll',cost:400,w:{common:5, fine:30,rare:45,epic:20}},
};
function rollEquip(tier){
  const w=EQ_TIERS[tier].w;
  let r=Math.random()*100,qk='common';
  for(const k of ['common','fine','rare','epic']){if(r<w[k]){qk=k;break;}r-=w[k];}
  const pool=EQUIPS.filter(e=>e.q===qk&&!e.pool);
  return {t:'eq',id:pool[Math.floor(Math.random()*pool.length)].id};
}
function eqDef(item){return EQ_BY_ID[item.id];}
function qOf(item){return QUALS[eqDef(item).q];}
function eqDesc(def){
  const s=def.stats,p=[];
  if(s.atk)p.push('攻击+'+s.atk);
  if(s.str)p.push('力量+'+s.str);
  if(s.agi)p.push('敏捷+'+s.agi);
  if(s.armor)p.push('护甲+'+s.armor);
  if(s.aspd)p.push('攻速+'+s.aspd);
  if(s.cdr)p.push('技能CD-'+Math.round(s.cdr*100)+'%');
  if(s.bat)p.push('攻击间隔-'+s.bat);
  if(s.block)p.push('格挡普攻伤害'+s.block);
  if(s.mpre)p.push('回蓝+'+s.mpre+'/s');
  if(s.range)p.push('射程+'+s.range+'格');
  if(s.int)p.push('智力+'+s.int);
  if(s.mres)p.push('魔抗+'+Math.round(s.mres*100)+'%');
  if(s.hp)p.push('生命+'+s.hp);
  return p.join(' · ');
}

/* ================= 怪物（带护甲/魔抗）================= */
const MOBS={
  // atkR=攻击距离（都小于战士射程1.15，保证近战能还手）
  normal:{hp:40, spd:1.1,atk:8, reward:7, xp:5, r:.30,lives:1,armor:0,mres:0,  atkR:.62,color:'#c95bff'},
  fast:  {hp:26, spd:1.9,atk:6, reward:8, xp:6, r:.23,lives:1,armor:0,mres:0,  atkR:.42,color:'#ff9d4d'},
  tank:  {hp:150,spd:.7, atk:14,reward:14,xp:12,r:.38,lives:2,armor:6,mres:.15,atkR:.85,color:'#8a6bff'},
  boss:  {hp:700,spd:.55,atk:30,reward:70,xp:60,r:.47,lives:3,armor:10,mres:.3,atkR:1.05,color:'#ff3860'},
};
const INCOME_MAX=10;
function mineCost(lv){return 45+30*(lv-1);}
function millCost(lv){return 35+25*(lv-1);}
const WAVE_EVERY=35;
/* 波次类型：逢5(5/15/25)=精英波，逢10(10/20)=Boss关（只有Boss、数值额外拔高） */
const BOSS_WAVE_MUL=2.5, ELITE_RS=1.2;
function isBossWave(w){return w%10===0;}
function isEliteWave(w){return w%10===5;}
/* 怪物AI：仇恨范围>攻击范围（攻击距离见 MOBS.atkR），仇恨内只做轻微纵向贴靠 */
const AGGRO_R=3.2, VEER_SPD=.7;
/* 召唤物活动上限：守在左侧第4格附近，不追出去 */
const BEAR_MAX_X=4.15;
/* ===== 召唤物（bears 数组统一管理，kind 决定属性/外观）=====
   hp/atk = 基础 + 智力×系数×技能等级；rng=攻击距离 ivl=攻击间隔 splash=溅射半径 */
const MINIONS={
  bear:    {name:'熊灵',  n:1,r:.28,spd:1.8,rng:.8, ivl:1,  hpB:120,hpI:6,  atkB:8, atkI:.7, dur:l=>12+2*l,   mag:false,splash:0,  color:'#c9a068'},
  fire:    {name:'火元素',n:1,r:.26,spd:1.5,rng:2.6,ivl:1.2,hpB:70, hpI:3,  atkB:7, atkI:.5, dur:l=>10+1.5*l, mag:true, splash:0,  color:'#ff7a2f'},
  water:   {name:'水元素',n:2,r:.26,spd:1.7,rng:.85,ivl:1.1,hpB:90, hpI:4,  atkB:6, atkI:.42,dur:l=>12+2*l,   mag:false,splash:0,  color:'#4fc3ff'},
  infernal:{name:'地狱火',n:1,r:.38,spd:1.4,rng:1,  ivl:1.4,hpB:220,hpI:9,  atkB:16,atkI:1.1,dur:l=>15+2*l,   mag:false,splash:1.2,color:'#ff4d3d'},
};
/* 开波后英雄从左往右推进的速度（格/秒），清场后按1.8倍走回本阵 */
const HERO_SPD=.55;

/* ================= 四大试炼 =================
   点图标才开始；奖励挂在试炼怪身上（击杀即得）；CD 从左到右依次变长；
   精英试炼第5波后开放，掉落宝箱（点开=精英池装备）。难度跟当前波数走。*/
const TRIALS={
  gold: {n:'金币试炼',s:'金币',cd:40, color:'#f0c46a',minWave:0,
         desc:'召来一群贪财的敌人，击杀额外获得金币'},
  wood: {n:'木头试炼',s:'木头',cd:60, color:'#7ec87e',minWave:0,
         desc:'召来一群林间敌人，击杀额外获得木头'},
  xp:   {n:'经验试炼',s:'经验',cd:85, color:'#b070ff',minWave:0,
         desc:'召来一群历练目标，击杀额外获得经验'},
  elite:{n:'精英试炼',s:'精英',cd:120,color:'#ff5d5d',minWave:5,
         desc:'召来精英敌人，掉落宝箱（点击开启，出精英池装备）'},
};
const TRIAL_KEYS=['gold','wood','xp','elite'];

/* ================= 状态 ================= */
let gold,wood,lives,wave,queue,spawnT,incomeT,waveT,cleared,hudAcc;
let mineLv,millLv;
let heroes,mobs,shots,fx,nums,bears,inv,hails,storms,quakes,chests,trialCd;
let sel=null,invSel=null,speed=1,running=false,started=false,over=false,openShop=null,advPick=false;

/* ================= 画布 ================= */
const cv=document.getElementById('cv'),ctx=cv.getContext('2d');
let cell=30,dpr=1;
function resize(){
  const st=document.getElementById('stage');
  const w=st.clientWidth-8,h=st.clientHeight-8;
  cell=Math.floor(Math.min(w/COLS,h/ROWS));
  dpr=Math.min(window.devicePixelRatio||1,2);
  cv.width=COLS*cell*dpr;cv.height=ROWS*cell*dpr;
  cv.style.width=COLS*cell+'px';cv.style.height=ROWS*cell+'px';
  buildBG();
}
window.addEventListener('resize',()=>setTimeout(resize,60));

/* ================= 英雄 ================= */
function makeHero(cls,row,col){
  const h={cls,row,col,x:col+.5,lv:1,xp:0,tier:0,branch:-1,specLv:1,autoLearn:false,
    soulInt:0,deathAgi:0,equips:[],
    skills:{},cds:{},cd:0,flash:0,anim:0,endT:0,endF:0,alive:true};
  calc(h);h.hp=h.maxHp;
  return h;
}
function calc(h){
  const b=CLASSES[h.cls],a=advOf(h);
  const am=h.tier?1.35:1;
  const sp=h.specLv||0,key=a?a.key:'';
  let eqAtk=0,eqArmor=0,eqHp=0,eqAspd=0,eqStr=0,eqAgi=0,eqInt=0,eqMres=0,eqCdr=0,eqBat=0,eqBlock=0,eqMpre=0,eqRange=0;
  for(const e of h.equips){
    const s=eqDef(e).stats;
    eqAtk+=s.atk||0;eqArmor+=s.armor||0;eqHp+=s.hp||0;eqAspd+=s.aspd||0;
    eqStr+=s.str||0;eqAgi+=s.agi||0;eqInt+=s.int||0;eqMres+=s.mres||0;
    eqCdr+=s.cdr||0;eqBat+=s.bat||0;eqBlock+=s.block||0;eqMpre+=s.mpre||0;eqRange+=s.range||0;
  }
  // 装备加的力/敏一样吃派生；魂吸智力/死神收割敏捷是击杀累积
  h.str=Math.round((b.attr.str+b.grow.str*(h.lv-1))*am)+eqStr;
  h.agi=Math.round((b.attr.agi+b.grow.agi*(h.lv-1))*am)+eqAgi+Math.round(h.deathAgi||0);
  h.int=Math.round((b.attr.int+b.grow.int*(h.lv-1))*am)+eqInt+Math.round(h.soulInt||0);
  h.atk=Math.round(b.wep*(a?a.atk:1)+h[b.main]+eqAtk);
  h.maxHp=Math.round((b.hpB+h.str*8)*(a?a.hp:1)+eqHp);
  // 护卫专精：坚壁加甲
  h.armor=Math.round((b.baseArmor+h.agi/7+eqArmor+(key==='guard'?3*sp:0))*10)/10;
  h.mres=Math.min(.75,.25+eqMres);
  // 魔兽/DotA公式：每秒攻击=(1+攻速/100)/BAT；1敏=1攻速；上限400⇒最多5/BAT次每秒
  // 精灵游侠专精：迅捷额外降BAT
  const bat=Math.max(.35,b.bat*(a?a.bat:1)-eqBat-(key==='elf'?.2+.01*sp:0));
  h.bat=Math.round(bat*100)/100;   // 基础攻击间隔(BAT)：只含职业/转职/装备/迅捷，不含攻速
  h.ias=Math.min(400,h.agi+eqAspd);
  h.interval=bat/(1+h.ias/100);
  h.cdr=Math.min(.5,eqCdr+.04*(h.skills['CD光环']||0));
  h.block=eqBlock;
  h.range=b.range+(a?a.range:0)+.3*(h.skills['狙击潜质']||0)+eqRange;
  h.splash=b.splash+(a?a.splash:0);
  h.maxMp=10+h.int*3;
  h.mpRegen=1+h.int*.04+eqMpre;
  if(h.mp===undefined)h.mp=h.maxMp;
  h.mp=Math.min(h.mp,h.maxMp);
  if(h.hp!==undefined)h.hp=Math.min(h.hp,h.maxHp);
}
function heroAt(c,r){return heroes.find(h=>h.col===c&&h.row===r);}
function dispName(h){return h.tier?advOf(h).name:CLASSES[h.cls].name;}

/* ================= 流程 ================= */
function reset(){
  gold=200;wood=0;lives=10;wave=0;queue=[];spawnT=0;incomeT=0;
  waveT=WAVE_EVERY;cleared=true;hudAcc=0;
  mineLv=1;millLv=1;
  heroes=[];mobs=[];shots=[];fx=[];nums=[];bears=[];inv=[];hails=[];storms=[];quakes=[];chests=[];
  trialCd={};for(const k of TRIAL_KEYS)trialCd[k]=0;
  renderTrials();
  sel=null;invSel=null;over=false;openShop=null;advPick=false;
  closeShop();updateHUD();renderInfo();renderInv();
}
function waveComp(w){
  // 数量封顶30只（约27秒出完，不与下一波堆叠），后期靠强度而非数量
  // 最后一波：大量小怪 + 多个Boss 的总攻
  const fin=w>=TOTAL_WAVES;
  const list=[];
  if(isBossWave(w)){   // Boss关：清一色Boss，不带小怪，数值额外×BOSS_WAVE_MUL
    for(let i=0;i<w/10;i++)list.push({t:'boss',mul:BOSS_WAVE_MUL,rs:1.25});
    return list;
  }
  const n=fin?45:Math.min(30,4+w*2);
  for(let i=0;i<n;i++){
    let t='normal';
    if(w>=3&&i%3===2)t='fast';
    if(w>=4&&i%4===3)t='tank';
    list.push({t});
  }
  if(isEliteWave(w)){  // 精英波：小怪之外额外来一批精英
    const en=1+Math.floor(w/5);
    for(let i=0;i<en;i++)
      list.push({t:w>=15?'boss':'tank',elite:1,mul:1.6+.05*w,rs:ELITE_RS});
  }
  if(fin)list.push({t:'boss'},{t:'boss'},{t:'boss'});
  return list;
}
function startWave(){
  if(wave>=TOTAL_WAVES)return;
  wave++;
  // 整波一起入场（不再一只只放）：排成纵深队形从右边压上来
  const list=waveComp(wave);
  for(let i=0;i<list.length;i++){
    const e=list[i];
    spawnMob(e.t,{dx:(i%8)*.55+Math.floor(i/8)*.85,elite:e.elite,mul:e.mul,rs:e.rs});
  }
  if(isBossWave(wave))showToast(`<b style="color:#ff5d5d">第 ${wave} 波 · BOSS关</b>　只有Boss，但数值极高`);
  else if(isEliteWave(wave))showToast(`<b style="color:#f0c46a">第 ${wave} 波 · 精英波</b>　混入精英怪`);
  updateHUD();renderInfo();
}
function spawnMob(type,opt){
  opt=opt||{};
  // 强度爬升：前15波平缓，15波后额外+6%/波加速收尾
  // w1=1 w5≈1.6 w10≈2.9 w15≈4.7 w20≈10 w25≈20
  const b=MOBS[type];
  let mul=(1+0.12*(wave-1))*Math.pow(1.045,wave-1);
  if(wave>15)mul*=Math.pow(1.06,wave-15);
  // 不再固定在格子正中：在所选行附近随机散开
  const row=Math.floor(Math.random()*ROWS);
  const y=Math.max(0,Math.min(ROWS-1,row+(Math.random()*.7-.35)));
  mul*=opt.mul||1;
  mobs.push({type,row,y,x:COLS+.5+Math.random()*.4+(opt.dx||0),
    hp:b.hp*mul,maxHp:b.hp*mul,spd:b.spd,atk:b.atk*mul,r:b.r*(opt.rs||1),atkR:b.atkR,
    reward:Math.round(b.reward*(opt.elite?2:1)),xp:Math.round(b.xp*(opt.elite?2:1)),
    lives:b.lives,armor:b.armor,mres:b.mres,elite:opt.elite||0,
    trial:opt.trial||null,bonus:opt.bonus||0,chest:opt.chest||0,
    color:b.color,cd:0,fight:false,slowT:0,slowF:0,frost:0,asT:0,asF:0});
}
/* 四大试炼：点图标开打，怪即刻入场；奖励在击杀时结算（见 damage） */
function trialReady(k){
  return started&&!over&&trialCd[k]<=0&&wave>=TRIALS[k].minWave;
}
function startTrial(k){
  const T=TRIALS[k];
  if(!started||over){showToast('先点右上角 <b>▶ 启动</b> 才能开启试炼');return;}
  if(wave<T.minWave){showToast(`<b style="color:${T.color}">${T.n}</b> 第 ${T.minWave} 波后开放`);return;}
  if(trialCd[k]>0){showToast(`<b style="color:${T.color}">${T.n}</b> 冷却中 ${Math.ceil(trialCd[k])}s`);return;}
  trialCd[k]=T.cd;
  // 一波比一波难：数量与强度都跟当前波数走
  const w=Math.max(1,wave);
  if(k==='elite'){
    const n=1+Math.floor(w/5);
    for(let i=0;i<n;i++)
      spawnMob(w>=15?'boss':'tank',{trial:k,mul:1.5+.06*w,rs:1.15,dx:i*.7,chest:1});
    for(let i=0;i<2+Math.floor(w/3);i++)
      spawnMob('fast',{trial:k,mul:1.2+.04*w,dx:1.2+i*.4,chest:Math.random()<.35?1:0});
  }else{
    const n=4+Math.floor(w*.7);
    const bonus=k==='gold'?10+w*3:(k==='wood'?6+w*2:4+w*2);
    for(let i=0;i<n;i++){
      const t=k==='xp'?(i%3===2?'tank':'normal'):(i%3===2?'fast':'normal');
      spawnMob(t,{trial:k,mul:1.15+.05*w,dx:i*.35,bonus});
    }
  }
  showToast(`<b style="color:${T.color}">${T.n}</b> 开始！`);
  renderTrials();
}

/* ================= 伤害 ================= */
function dnum(x,y,val,color){
  if(nums.length>70)nums.shift();
  nums.push({x,y:y-.25,txt:String(Math.max(1,Math.round(val))),color:color||'#fff',t:.8,max:.8});
}
function damage(m,d,color){
  if(m.dead)return;
  m.hp-=d;
  dnum(m.x,m.y+.5,d,color);
  if(m.hp<=0){
    m.dead=true;
    gold+=m.reward;
    gainXp(m.xp);
    // 试炼奖励：击杀即结算
    if(m.trial==='gold'){gold+=m.bonus;dnum(m.x,m.y+.2,m.bonus,'#f0c46a');}
    else if(m.trial==='wood'){wood+=m.bonus;dnum(m.x,m.y+.2,m.bonus,'#7ec87e');}
    else if(m.trial==='xp'){gainXp(m.bonus);dnum(m.x,m.y+.2,m.bonus,'#b070ff');}
    else if(m.trial==='elite'&&m.chest)dropChest(m.x,m.y+.5);
    onKill();
    updateHUD();refreshAfford();
    fx.push({type:'ring',x:m.x,y:m.y+.5,rr:m.r*1.7,t:.28,max:.28,color:m.color});
  }
}
/* 精英试炼宝箱：掉在战斗区，点击开启，出精英池装备 */
function dropChest(x,y){
  chests.push({x:Math.max(HCOLS+.4,Math.min(COLS-.4,x)),y:Math.max(.4,Math.min(ROWS-.4,y)),t:0});
  fx.push({type:'ring',x,y,rr:.7,t:.5,max:.5,color:'#f0c46a'});
}
function openChest(ch){
  const pool=EQUIPS.filter(e=>e.pool==='elite');
  const d=pool[Math.floor(Math.random()*pool.length)];
  inv.push({t:'eq',id:d.id});
  ch.dead=true;
  const q=QUALS[d.q];
  for(let i=0;i<8;i++){
    const a=i/8*6.283;
    fx.push({type:'spark',x:ch.x,y:ch.y,ax:Math.cos(a),ay:Math.sin(a),t:.5,max:.5,color:q.c});
  }
  fx.push({type:'ring',x:ch.x,y:ch.y,rr:.9,t:.45,max:.45,color:q.c});
  showToast(`宝箱开启：<b style="color:${q.c}">${d.n}</b> [${q.n}]<br>${eqDesc(d)}`);
  renderInv();
}
/* 敌人死亡触发：魂吸(+智,上限随等级)、死神收割(+敏,上限随专精) */
function onKill(){
  let dirty=false;
  for(const h of heroes){
    const sk=h.skills['魂吸'];
    if(sk){
      const cap=10+5*(sk-1);
      if(h.soulInt<cap){h.soulInt=Math.min(cap,h.soulInt+.5);calc(h);dirty=true;}
    }
    if(h.tier&&advOf(h).key==='death'){
      const cap=20+10*((h.specLv||1)-1);
      if(h.deathAgi<cap){h.deathAgi=Math.min(cap,h.deathAgi+.5);calc(h);dirty=true;}
    }
  }
  if(dirty&&sel)renderInfo();
}
/* 物理伤害吃怪物护甲，魔法伤害吃怪物魔抗 */
function physDamage(m,d,color){damage(m,d*(1-armorRed(m.armor)),color);}
function magDamage(m,d,color){damage(m,d*(1-m.mres),color);}
function gainXp(x){
  let leveled=false;
  for(const h of heroes){
    if(h.lv>=MAX_HERO_LV)continue;
    h.xp+=x;
    while(h.xp>=xpNeed(h.lv)&&h.lv<MAX_HERO_LV){
      h.xp-=xpNeed(h.lv);h.lv++;calc(h);h.hp=h.maxHp;leveled=true;
      levelFx(h.x,h.row+.5);
    }
  }
  if(leveled&&sel)renderInfo();
}
/* 升级特效：金圈+八向飞溅+LV飘字 */
function levelFx(x,y){
  fx.push({type:'ring',x,y,rr:.85,t:.5,max:.5,color:'#f0e46a'});
  fx.push({type:'aoe',x,y,rr:.55,t:.35,max:.35,color:'#f0e46a'});
  for(let i=0;i<8;i++){
    const a=Math.PI/4*i;
    fx.push({type:'spark',x,y,ax:Math.cos(a),ay:Math.sin(a),t:.45,max:.45,color:'#ffe98a'});
  }
  nums.push({x,y:y-.55,txt:'LV UP',color:'#f0e46a',t:1,max:1});
}

/* ================= 更新 ================= */
function update(dt){
  if(started){   // 点▶启动后才产资源、走波次
    incomeT+=dt;
    while(incomeT>=1){
      incomeT-=1;
      if(mineLv||millLv){gold+=mineLv;wood+=millLv;updateHUD();refreshAfford();}
    }
    if(wave<TOTAL_WAVES){
      waveT-=dt;
      if(waveT<=0){waveT=WAVE_EVERY;startWave();}
    }
  }
  hudAcc+=dt;
  if(hudAcc>=.25){hudAcc=0;updateHUD();}
  /* 怪物：沿自己的路线向左推进，仇恨范围内会稍微靠向目标，进入攻击范围就停下开打 */
  for(const m of mobs){
    if(m.slowT>0)m.slowT-=dt;
    if(m.frost>0)m.frost-=dt;        // 冰霜覆层显示时长
    if(m.asT>0)m.asT-=dt;            // 攻速减益（大地震颤）
    const spd=m.spd*(m.slowT>0?1-m.slowF:1);
    m.fight=false;
    // 找仇恨范围内最近的我方单位（英雄或熊灵）
    let tgt=null,td=1e9;
    for(const h of heroes){
      if(!h.alive)continue;
      const d=Math.hypot(h.x-m.x,h.row-m.y);
      if(d<td){td=d;tgt=h;}
    }
    for(const br of bears){
      if(br.dead)continue;
      const d=Math.hypot(br.x-m.x,br.row-m.y);
      if(d<td){td=d;tgt=br;}
    }
    const reach=m.atkR+m.r;   // 攻击距离按怪物种类
    if(tgt&&td<=reach){          // 进入攻击范围：站定输出，不再贴靠
      m.fight=true;
      m.cd-=dt*(m.asT>0?1-m.asF:1);
      if(m.cd<=0){m.cd=1;hitUnit(tgt,m);}
      continue;
    }
    // 各走各的，不排队等同伴
    m.x-=spd*dt;
    if(m.x< -0.5){m.dead=true;lives-=m.lives;if(lives<=0){lives=0;endGame(false);}updateHUD();}
    // 几乎重叠时纵向轻推开，避免糊成一团（不影响前进）
    for(const o of mobs){
      if(o===m||o.dead)continue;
      if(Math.abs(o.x-m.x)<.38&&Math.abs(o.y-m.y)<.34){
        const dir=(m.y-o.y)||(Math.random()-.5);
        m.y=Math.max(0,Math.min(ROWS-1,m.y+Math.sign(dir)*.5*dt));
        break;
      }
    }
    // 仇恨范围内：纵向稍微靠一点（不会跑到英雄格子上）
    if(tgt&&td<=AGGRO_R){
      const dy=tgt.row-m.y;
      if(Math.abs(dy)>.02){
        const step=Math.min(Math.abs(dy),VEER_SPD*dt)*Math.sign(dy);
        m.y=Math.max(0,Math.min(ROWS-1,m.y+step));
      }
    }
    m.row=Math.max(0,Math.min(ROWS-1,Math.round(m.y)));   // 派生所在行
  }
  /* 熊灵 */
  for(const br of bears){
    br.t-=dt;
    if(br.t<=0||br.hp<=0){br.dead=true;continue;}
    br.cd-=dt;
    let best=null;
    for(const m of mobs){
      if(m.dead||m.row!==br.row)continue;
      if(!best||m.x<best.x)best=m;
    }
    const md=MINIONS[br.kind]||MINIONS.bear, by=br.row+.5+(br.oy||0);
    if(best){
      const gap=best.x-br.x;
      if(gap>(br.rng||.8)){br.x=Math.min(br.x+(br.spd||1.8)*dt,br.maxX||BEAR_MAX_X);}   // 只在召唤者前方活动，不追远
      else if(br.cd<=0){
        br.cd=br.ivl||1;
        if(br.mag)magDamage(best,br.atk,md.color);else physDamage(best,br.atk,md.color);
        if(br.splash)for(const o of mobs){
          if(o!==best&&!o.dead&&Math.hypot(o.x-best.x,o.y-best.y)<=br.splash+o.r)physDamage(o,br.atk*.5,md.color);
        }
        if((br.rng||.8)>1.2)   // 远程：喷射弹道
          fx.push({type:'bolt',x1:br.x+.2,y1:by,x2:best.x,y2:best.y+.5,t:.25,max:.25,color:md.color});
        fx.push({type:'ring',x:best.x,y:best.y+.5,rr:br.splash||.3,t:.15,max:.15,color:md.color});
      }
    }else if(br.x>br.home){br.x=Math.max(br.home,br.x-(br.spd||1.8)*dt);}
  }
  bears=bears.filter(b=>!b.dead);
  /* 暴风雪冰雹：到点落下，小片AOE伤害+减速 */
  for(const hl of hails){
    hl.delay-=dt;
    if(hl.delay>0){
      // 落地前0.5秒在区域内撒下一片下落的冰棱
      if(!hl.cued&&hl.delay<=.5){
        hl.cued=true;
        const n=5+Math.round(hl.R*2);
        for(let i=0;i<n;i++){
          const a=Math.random()*7, rad=Math.sqrt(Math.random())*hl.R;
          fx.push({type:'fall',x:hl.cx+Math.cos(a)*rad,y:hl.cy+Math.sin(a)*rad,
            t:hl.delay,max:.5+Math.random()*.3,color:'#bfeaff'});
        }
      }
      continue;
    }
    hl.done=true;
    fx.push({type:'ring',x:hl.cx,y:hl.cy,rr:hl.R,t:.3,max:.3,color:'#bfeaff'});
    fx.push({type:'aoe',x:hl.cx,y:hl.cy,rr:hl.R,t:.18,max:.18,color:'#dff4ff'});
    for(const m of mobs){
      if(m.dead)continue;
      if(Math.hypot(m.x-hl.cx,(m.y+.5)-hl.cy)<=hl.R+m.r){
        magDamage(m,hl.dmg,'#7fd8ff');
        m.slowT=2;m.slowF=hl.slow;m.frost=2;
      }
    }
  }
  hails=hails.filter(h=>!h.done);
  /* 火焰风暴：延迟1s后在固定区域持续灼烧（每0.5s结算一次） */
  for(const s of storms){
    if(s.delay>0){
      s.delay-=dt;
      if(s.delay<=0)fx.push({type:'ring',x:s.cx,y:s.cy,rr:s.R,t:.35,max:.35,color:'#ff7a2f'});
      continue;
    }
    s.t-=dt;s.tick-=dt;s.fxT-=dt;
    if(s.fxT<=0){   // 火舌粒子
      s.fxT=.035;
      const a=Math.random()*6.283,d=Math.sqrt(Math.random())*s.R;
      fx.push({type:'flame',x:s.cx+Math.cos(a)*d,y:s.cy+Math.sin(a)*d,
        sz:.7+Math.random()*.7,t:.55,max:.55,color:Math.random()<.4?'#ffd24f':'#ff7a2f'});
    }
    if(s.tick<=0){
      s.tick=.5;
      for(const m of mobs){
        if(m.dead)continue;
        if(Math.hypot(m.x-s.cx,(m.y+.5)-s.cy)<=s.R+m.r)magDamage(m,s.dps*.5,'#ff7a2f');
      }
    }
    if(s.t<=0)s.done=true;
  }
  storms=storms.filter(s=>!s.done);
  /* 大地震颤：身前矩形地裂，持续DoT + 区域内移速/攻速减益（每0.5s结算伤害） */
  for(const q of quakes){
    q.t-=dt;q.tick-=dt;q.fxT-=dt;
    if(q.fxT<=0){   // 碎石飞溅
      q.fxT=.05;
      fx.push({type:'rock',x:q.x0+Math.random()*(q.x1-q.x0),y:q.y0+Math.random()*(q.y1-q.y0),
        sz:.6+Math.random()*.8,vx:(Math.random()-.5)*.6,t:.5,max:.5,
        color:Math.random()<.35?'#c98b4b':'#7d5a3a'});
    }
    const tick=q.tick<=0;
    if(tick)q.tick=.5;
    for(const m of mobs){
      if(m.dead)continue;
      if(m.x<q.x0-m.r||m.x>q.x1+m.r)continue;
      const my=m.y+.5;
      if(my<q.y0||my>q.y1)continue;
      if(tick)magDamage(m,q.dps*.5,'#e0a05a');
      // 站在裂地里就一直吃减益，离开后很快恢复
      m.slowT=Math.max(m.slowT,.3);m.slowF=Math.max(m.slowF,q.slow);
      m.asT=Math.max(m.asT,.3); m.asF=Math.max(m.asF,q.slow);
    }
    if(q.t<=0)q.done=true;
  }
  quakes=quakes.filter(q=>!q.done);
  /* 试炼CD + 宝箱计时（宝箱不会消失，只做浮动动画） */
  for(const k of TRIAL_KEYS)if(trialCd[k]>0)trialCd[k]=Math.max(0,trialCd[k]-dt);
  for(const ch of chests)ch.t+=dt;
  chests=chests.filter(c=>!c.dead);
  /* 英雄 */
  for(const h of heroes){
    if(!h.alive)continue;
    if(h.flash>0)h.flash-=dt;
    if(h.anim>0)h.anim-=dt;
    if(h.endT>0)h.endT-=dt;   // 忍受 buff 计时
    const hx=h.x,hy=h.row+.5;
    const bb=h.skills['狂战士之血'];
    if(bb){
      const miss=1-h.hp/h.maxHp;
      if(miss>0)h.hp=Math.min(h.maxHp,h.hp+h.maxHp*.02*bb*miss*2*dt);
    }
    // 回蓝
    h.mp=Math.min(h.maxMp,h.mp+h.mpRegen*dt);
    for(const name in h.skills){
      const def=SKB[name];
      if(!def.cd)continue;
      h.cds[name]=(h.cds[name]||0)-dt;
      if(h.cds[name]>0)continue;
      if((def.mana||0)>h.mp)continue;   // 蓝不够不放
      if(castSkill(h,name,h.skills[name],hx,hy)){
        h.cds[name]=def.cd*(1-h.cdr);
        h.mp-=def.mana||0;
      }
    }
    // 牧师专精·治愈祷言（主动，自动释放）
    if(h.tier&&advOf(h).key==='priest'){
      h.specCd=(h.specCd||0)-dt;
      if(h.specCd<=0&&h.mp>=30){
        const hurt=heroes.filter(o=>o.alive&&o.hp<o.maxHp);
        if(hurt.length){
          h.specCd=8*(1-h.cdr);h.mp-=30;
          const heal=30+h.int*(.6+.4*h.specLv);
          for(const o of hurt){
            o.hp=Math.min(o.maxHp,o.hp+heal);
            dnum(o.x,o.row+.5,heal,'#7effc0');
            fx.push({type:'ring',x:o.x,y:o.row+.5,rr:.55,t:.35,max:.35,color:'#7effc0'});
            for(let i=0;i<3;i++)fx.push({type:'heal',x:o.x+(i-1)*.22,y:o.row+.45,
              t:.6+i*.08,max:.6+i*.08,color:'#7effc0'});
          }
        }
      }
    }
    h.cd-=dt;
    let best=null;
    for(const m of mobs){
      if(m.dead)continue;
      if(h.cls==='archer'&&Math.abs(m.y-h.row)>1.6)continue;
      if(h.cls==='warrior'&&Math.abs(m.y-h.row)>.7)continue;
      const d=Math.hypot(m.x-hx,(m.y+.5)-hy);
      if(d<=h.range+m.r&&(!best||m.x<best.x))best=m;
    }
    // 开波后从左往右推进；没敌人时压上去，清场后走回本阵
    const home=h.col+.5;
    if(started&&!over&&mobs.length){
      if(!best)h.x=Math.min(h.x+HERO_SPD*dt,COLS-.7);
    }else if(h.x>home)h.x=Math.max(home,h.x-HERO_SPD*1.8*dt);
    if(best&&h.cd<=0){
      h.cd=effInterval(h);
      attack(h,hx,hy,best);
      const ms=h.skills['多重射击'];
      if(ms){
        let extra=Math.floor(ms/2)+((ms%2)&&Math.random()<.5?1:0);
        if(extra>0){
          const others=mobs.filter(m=>{
            if(m.dead||m===best)return false;
            if(h.cls==='archer'&&Math.abs(m.y-h.row)>1.6)return false;
            if(h.cls==='warrior'&&Math.abs(m.y-h.row)>.7)return false;
            return Math.hypot(m.x-hx,(m.y+.5)-hy)<=h.range+m.r;
          }).sort((a,b)=>a.x-b.x).slice(0,extra);
          for(const o of others)attack(h,hx,hy,o,.7,'#7fe8ff');
        }
      }
    }
  }
  /* 子弹 */
  const SPD=10;
  for(const s of shots){
    if(s.target&&!s.target.dead){s.tx=s.target.x;s.ty=s.target.y+.5;}
    const dx=s.tx-s.x,dy=s.ty-s.y,l=Math.hypot(dx,dy);
    if(l<SPD*dt){
      s.dead=true;
      if(s.splash>0){
        fx.push({type:'ring',x:s.tx,y:s.ty,rr:s.splash,t:.22,max:.22,color:s.color});
        for(const m of mobs){if(!m.dead&&Math.hypot(m.x-s.tx,(m.y+.5)-s.ty)<=s.splash+m.r)shotHit(s,m);}
      }else if(s.target&&!s.target.dead)shotHit(s,s.target);
    }else{s.a=Math.atan2(dy,dx);s.x+=dx/l*SPD*dt;s.y+=dy/l*SPD*dt;}
  }
  mobs=mobs.filter(m=>!m.dead);
  shots=shots.filter(s=>!s.dead);
  for(const f of fx)f.t-=dt;
  fx=fx.filter(f=>f.t>0);
  for(const n of nums){n.t-=dt;n.y-=.7*dt;}
  nums=nums.filter(n=>n.t>0);
  const empty=!queue.length&&!mobs.length;
  if(!empty)cleared=false;
  else if(!cleared&&wave>0){
    cleared=true;
    gold+=20+wave*6;
    for(const h of heroes){h.alive=true;h.hp=h.maxHp;h.mp=h.maxMp;}
    updateHUD();
    if(wave>=TOTAL_WAVES){endGame(true);return;}
    renderInfo();
  }
}
/* 攻击溅射：普攻(含多重射击的额外攻击)对目标周围1.5格溅射 */
function cleaveAround(m,base,pct){
  for(const o of mobs){
    if(o===m||o.dead)continue;
    if(Math.hypot(o.x-m.x,o.y-m.y)<=1.5+o.r)physDamage(o,base*pct,'#ffb27f');
  }
  fx.push({type:'ring',x:m.x,y:m.y+.5,rr:1.5,t:.2,max:.2,color:'#ffb27f'});
}
/* 血怒(狂战士专精)：按失血比动态加攻/攻速 */
function berserkRatio(h){
  if(!h.tier||advOf(h).key!=='berserker')return 0;
  return 1-h.hp/h.maxHp;
}
function effAtk(h){
  const r=berserkRatio(h);
  return r>0?h.atk*(1+r*(.15+.1*h.specLv)):h.atk;
}
function effInterval(h){
  const r=berserkRatio(h);
  if(r<=0)return h.interval;
  const ias=Math.min(400,h.ias+r*(30+15*h.specLv));
  const bat=h.interval*(1+h.ias/100);   // 还原BAT
  return bat/(1+ias/100);
}
function attack(h,hx,hy,m,mul,color){
  mul=mul||1;
  h.anim=ANIM_T;
  let dmg=effAtk(h)*mul,c=color;
  // 致命一击：(15+5lv)%几率 (140+10lv)%伤害
  const cr=h.skills['致命一击'];
  if(cr&&Math.random()<.15+.05*cr){dmg*=1.4+.1*cr;c='#ffd24f';}
  const poison=h.skills['沁毒射击']?h.agi*(.35+.15*h.skills['沁毒射击']):0;
  const cleave=h.skills['攻击溅射']?(.25+.05*h.skills['攻击溅射']):0;
  if(h.cls==='warrior'){
    physDamage(m,dmg,c);
    if(poison)magDamage(m,poison,'#7ce87c');
    if(cleave)cleaveAround(m,dmg,cleave);
    fx.push({type:'slash',x:m.x-.1,y:m.y+.5,rr:.42,a:Math.atan2((m.y+.5)-hy,m.x-hx),
             t:.22,max:.22,color:c||CLASSES[h.cls].color});
    if(h.splash>0)for(const o of mobs){
      if(o!==m&&!o.dead&&Math.hypot(o.x-m.x,o.y-m.y)<=h.splash+o.r)physDamage(o,dmg*.6);
    }
  }else{
    shots.push({x:hx,y:hy,target:m,tx:m.x,ty:m.y+.5,a:Math.atan2((m.y+.5)-hy,m.x-hx),
      kind:h.cls==='mage'?'orb':'arrow',
      dmg,cleave,splash:h.splash,poison,color:c||CLASSES[h.cls].color});
  }
}
function shotHit(s,m){
  physDamage(m,s.dmg,s.color==='#7fe8ff'?'#7fe8ff':(s.color==='#ffd24f'?'#ffd24f':undefined));
  if(s.target===m){
    if(s.poison)magDamage(m,s.poison,'#7ce87c');
    if(s.cleave)cleaveAround(m,s.dmg,s.cleave);
  }
}
function hitUnit(u,m){
  if(u.isBear){
    u.hp-=m.atk;
    dnum(u.x,u.row+.5+(u.oy||0),m.atk,'#ff8080');
    return;
  }
  const h=u;
  // 穷鬼盾类固定格挡先扣，再吃护甲减伤
  let dmg=Math.max(0,m.atk-h.block)*(1-armorRed(h.armor));
  const bb=h.skills['狂战士之血'];
  if(bb){
    const miss=1-h.hp/h.maxHp;
    dmg*=1-Math.min(.7,miss*(.25+.08*bb));
  }
  if(h.endT>0)dmg*=1-h.endF;   // 忍受：额外减伤（与其它减伤相乘）
  h.hp-=dmg;h.flash=.12;
  dnum(h.x,h.row+.5,dmg,'#ff8080');
  const th=h.skills['荆棘光环'];
  if(th)magDamage(m,m.atk*.15*th+h.str*.4*th,'#9dff9d');
  if(h.hp<=0){
    h.hp=0;h.alive=false;
    fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.7,t:.35,max:.35,color:'#fff'});
    renderInfo();
  }
}
/* ===== 召唤类技能：技能名 → 召唤物种类 ===== */
const SUMMONS={'召唤熊德':'bear','火元素':'fire','水元素':'water','地狱火':'infernal'};
function summon(h,kind,lv){
  const d=MINIONS[kind];
  if(!mobs.length)return false;   // 同种召唤物可以叠着召（CD流人海战术）
  // 德鲁伊·自然之力：召唤物属性+20%×专精等级
  const sm=(h.tier&&advOf(h).key==='druid')?1+.2*h.specLv:1;
  const hp=(d.hpB+h.int*d.hpI*lv)*sm, atk=(d.atkB+h.int*d.atkI*lv)*sm;
  // 同排已有其它召唤物时错开站位，避免模型重叠
  const cnt=bears.filter(b=>!b.dead&&b.row===h.row).length;
  const base=(cnt%4)*.19;
  for(let i=0;i<d.n;i++){
    const oy=(d.n>1?(i-(d.n-1)/2)*.34:0)+[0,.16,-.16][(cnt+i)%3];   // 纵向错开显示
    const x=h.x+.5+base+i*.35;
    bears.push({isBear:true,kind,owner:h,row:h.row,oy,x,home:x,maxX:h.x+2.6-((cnt+i)%3)*.24,
      hp,maxHp:hp,atk,rng:d.rng,ivl:d.ivl,spd:d.spd,splash:d.splash,mag:d.mag,r:d.r,
      t:d.dur(lv),cd:0,dead:false});
    fx.push({type:'ring',x,y:h.row+.5+oy,rr:.8,t:.4,max:.4,color:d.color});
  }
  return true;
}
/* 主动技能释放距离与英雄射程同步：只选射程内最靠前的目标 */
function frontInRange(h,hx,hy){
  let t=null;
  for(const m of mobs){
    if(m.dead)continue;
    if(Math.hypot(m.x-hx,(m.y+.5)-hy)>h.range+m.r)continue;
    if(!t||m.x<t.x)t=m;
  }
  return t;
}
function castSkill(h,name,lv,hx,hy){
  if(SUMMONS[name])return summon(h,SUMMONS[name],lv);
  if(name==='火球术'){
    const t=frontInRange(h,hx,hy);
    if(!t)return false;
    fx.push({type:'bolt',x1:hx,y1:hy,x2:t.x,y2:t.y+.5,t:.4,max:.4,color:'#ffb04f'});
    fx.push({type:'ring',x:t.x,y:t.y+.5,rr:.6,t:.3,max:.3,color:'#ffb04f'});
    magDamage(t,40+h.int*3*lv,'#ffb04f');
    return true;
  }
  if(name==='冰风暴'){
    const t=frontInRange(h,hx,hy);
    if(!t)return false;
    // 暴风雪：固定区域，每0.9秒对区域内所有敌人结算一次，共 3+等级 波
    const R=1.1+.1*lv, waves=3+lv, gap=.9, cx=t.x, cy=t.y+.5;
    const dur=.3+waves*gap;
    fx.push({type:'aoe',x:cx,y:cy,rr:R,t:dur,max:dur,color:'#7fd8ff'});
    for(let i=0;i<waves;i++){
      hails.push({cx,cy,R,delay:.3+i*gap,
        dmg:15+h.int*.8*lv,slow:Math.min(.75,.4+.05*lv)});
    }
    return true;
  }
  if(name==='火焰风暴'){
    const t=frontInRange(h,hx,hy);
    if(!t)return false;
    // 延迟1秒落地，之后每0.5秒灼烧一次，持续 2+0.5×等级 秒
    const R=1.5,dur=2+.5*lv,dps=12+h.int*.55*lv;
    storms.push({cx:t.x,cy:t.y+.5,R,delay:1,t:dur,tick:0,fxT:0,dps});
    fx.push({type:'aoe',x:t.x,y:t.y+.5,rr:R,t:1,max:1,color:'#ff7a2f'});   // 1秒预警圈
    return true;
  }
  if(name==='大地震颤'){
    // 身前 3(高)×4.5(长) 矩形，纵向以英雄为中心并推回场内
    const LEN=4.5,H=3;
    const x0=hx,x1=hx+LEN;
    let y0=hy-H/2;
    y0=Math.max(0,Math.min(ROWS-H,y0));
    const y1=y0+H;
    let any=false;
    for(const m of mobs){
      if(m.dead)continue;
      if(m.x>=x0-m.r&&m.x<=x1+m.r&&m.y+.5>=y0&&m.y+.5<=y1){any=true;break;}
    }
    if(!any)return false;
    const dur=3+.5*lv, dps=10+h.str*.4*lv;
    quakes.push({x0,x1,y0,y1,t:dur,tick:0,fxT:0,dps,slow:.3});
    for(let i=0;i<14;i++)fx.push({type:'rock',x:x0+Math.random()*LEN,y:y0+Math.random()*H,
      sz:.9+Math.random()*.9,vx:(Math.random()-.5)*.8,t:.55,max:.55,color:'#c98b4b'});
    return true;
  }
  if(name==='忍受'){
    // 附近有敌人才开（射程+1.5格内），避免空放
    let near=false;
    for(const m of mobs){
      if(m.dead)continue;
      if(Math.hypot(m.x-hx,(m.y+.5)-hy)<=h.range+1.5){near=true;break;}
    }
    if(!near)return false;
    h.endT=3+lv;h.endF=(20+3*lv)/100;
    fx.push({type:'ring',x:hx,y:hy,rr:.75,t:.4,max:.4,color:'#ffd24f'});
    return true;
  }
  if(name==='剑雨'){
    const t=frontInRange(h,hx,hy);
    if(!t)return false;
    const R=2, dmg=20+h.agi*.5*lv, cx=t.x, cy=t.y+.5;
    fx.push({type:'aoe',x:cx,y:cy,rr:R,t:.45,max:.45,color:'#cfe6ff'});
    for(let i=0;i<12;i++){
      const a=Math.random()*6.283,d=Math.sqrt(Math.random())*R;
      fx.push({type:'sword',x:cx+Math.cos(a)*d,y:cy+Math.sin(a)*d,
        t:.45+Math.random()*.2,max:.65,color:'#dceaff'});
    }
    for(const m of mobs){
      if(m.dead)continue;
      if(Math.hypot(m.x-cx,(m.y+.5)-cy)<=R+m.r)magDamage(m,dmg,'#cfe6ff');
    }
    return true;
  }
  if(name==='闪电链'){
    let cur=frontInRange(h,hx,hy);
    if(!cur)return false;
    const n=2+lv,dmg=12+h.int*.45*lv,hit=new Set();
    let px=hx,py=hy;
    for(let i=0;i<n&&cur;i++){
      fx.push({type:'zap',x1:px,y1:py,x2:cur.x,y2:cur.y+.5,seed:Math.random()*99,
               t:.3,max:.3,color:'#9fd0ff'});
      magDamage(cur,dmg,'#9fd0ff');
      hit.add(cur);px=cur.x;py=cur.y+.5;
      let nxt=null,bd=2.5;   // 2.5格内弹跳
      for(const m of mobs){
        if(m.dead||hit.has(m))continue;
        const d=Math.hypot(m.x-px,(m.y+.5)-py);
        if(d<bd){bd=d;nxt=m;}
      }
      cur=nxt;
    }
    return true;
  }
  return false;
}
function endGame(win){
  over=true;running=false;closeShop();
  const ov=document.getElementById('overlay');
  ov.classList.remove('hide');
  ov.innerHTML=win
    ?`<h1>战线守住了</h1><p>${TOTAL_WAVES} 波全部击退。</p><button class="lg" id="startBtn">再来一局</button>`
    :`<h1 style="color:var(--warrior)">基地陷落</h1><p>坚持到了第 ${wave} 波。</p><button class="lg" id="startBtn">重新开始</button>`;
  document.getElementById('startBtn').onclick=begin;
}
function begin(){
  document.getElementById('overlay').classList.add('hide');
  reset();running=true;started=false;resize();
  document.getElementById('launchBtn').style.display='';   // 布阵阶段：右上角点▶启动才开波
  renderInfo();
}

/* ================= 绘制 ================= */
function rgba(hex,a){
  const n=parseInt(hex.slice(1),16);
  return `rgba(${n>>16},${n>>8&255},${n&255},${a})`;
}
/* 明暗调色：f>1变亮 f<1变暗；w=向白色混合比例(受击闪白) */
function shade(hex,f,w){
  const n=parseInt(hex.slice(1),16);
  let r=n>>16,g=n>>8&255,b=n&255;
  r*=f;g*=f;b*=f;
  if(w){r+=(255-r)*w;g+=(255-g)*w;b+=(255-b)*w;}
  return `rgb(${Math.min(255,r|0)},${Math.min(255,g|0)},${Math.min(255,b|0)})`;
}
const ANIM_T=.22;   // 攻击动作时长
let gt=0;           // 全局时间（用于呼吸/脉动）
function rrect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}
function poly(pts){
  ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);
  ctx.closePath();
}
/* ===== 英雄模型（矢量绘制，朝右）===== */
function drawHero(h,x,y){
  const b=CLASSES[h.cls], dead=!h.alive, w=h.flash>0?.75:0;
  const base=dead?'#39424f':shade(b.color,1,w);
  const dark=dead?'#252c37':shade(b.color,.6,w);
  const lite=dead?'#4a5462':shade(b.color,1.4,w);
  const gold='#f0c46a', metal=h.flash>0?'#fff':'#dbe6f3';
  const p=h.anim>0?h.anim/ANIM_T:0;          // 1→0 攻击进度
  const bob=dead?0:Math.sin(gt*2.2+h.row*1.7)*.012;
  ctx.save();ctx.translate(x,y+bob+.05);ctx.scale(.9,.9);
  ctx.globalAlpha=dead?.5:1;
  ctx.lineJoin='round';ctx.lineCap='round';
  // 影子
  ctx.fillStyle='rgba(0,0,0,.35)';
  ctx.beginPath();ctx.ellipse(0,.3,.24,.07,0,0,7);ctx.fill();
  // 转职：脚下金环
  if(h.tier){
    ctx.strokeStyle=gold;ctx.globalAlpha=(dead?.3:.55)+.2*Math.sin(gt*3);
    ctx.lineWidth=.035;
    ctx.beginPath();ctx.ellipse(0,.3,.3,.1,0,0,7);ctx.stroke();
    ctx.globalAlpha=dead?.5:1;
  }
  if(h.cls==='warrior'){
    // 盾（左手）
    ctx.fillStyle=dark;ctx.strokeStyle=metal;ctx.lineWidth=.03;
    poly([[-.34,-.14],[-.16,-.2],[-.16,.14],[-.25,.24],[-.34,.14]]);
    ctx.fill();ctx.stroke();
    ctx.fillStyle=lite;ctx.fillRect(-.28,-.1,.06,.2);
    // 腿
    ctx.fillStyle=dark;ctx.fillRect(-.11,.14,.09,.16);ctx.fillRect(.03,.14,.09,.16);
    // 躯干甲
    ctx.fillStyle=base;rrect(-.15,-.1,.3,.27,.05);ctx.fill();
    ctx.strokeStyle=dark;ctx.lineWidth=.025;ctx.stroke();
    ctx.fillStyle=h.tier?gold:lite;ctx.fillRect(-.15,-.1,.3,.05);   // 胸甲带
    // 头盔
    ctx.fillStyle=lite;rrect(-.11,-.32,.22,.22,.06);ctx.fill();
    ctx.fillStyle='#10151d';ctx.fillRect(-.02,-.25,.12,.05);        // 面甲缝
    ctx.fillStyle=h.tier?gold:dark;ctx.fillRect(-.12,-.35,.24,.05); // 盔顶
    // 剑（右手，随攻击挥砍）
    ctx.save();
    ctx.translate(.14,.0);
    ctx.rotate(-1.5+ (1-p)*.35 + p*p*2.2);
    ctx.fillStyle=gold;ctx.fillRect(-.03,-.02,.06,.1);              // 护手
    ctx.fillStyle=metal;
    poly([[-.035,-.02],[.035,-.02],[.02,-.4],[0,-.46],[-.02,-.4]]);
    ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=.015;
    ctx.beginPath();ctx.moveTo(0,-.05);ctx.lineTo(0,-.4);ctx.stroke();
    ctx.restore();
  }else if(h.cls==='archer'){
    const pull=p*.12;   // 拉弓
    // 箭袋（背后）
    ctx.fillStyle=dark;rrect(-.3,-.16,.11,.26,.04);ctx.fill();
    ctx.strokeStyle=metal;ctx.lineWidth=.02;
    for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-.27+i*.05,-.16);ctx.lineTo(-.29+i*.05,-.29);ctx.stroke();}
    // 腿
    ctx.fillStyle=dark;ctx.fillRect(-.1,.14,.08,.16);ctx.fillRect(.03,.14,.08,.16);
    // 斗篷+躯干
    ctx.fillStyle=base;
    poly([[-.16,-.06],[.14,-.06],[.11,.18],[-.13,.18]]);ctx.fill();
    ctx.fillStyle=dark;
    poly([[-.19,-.09],[-.02,-.09],[-.07,.2],[-.22,.16]]);ctx.fill();   // 披风
    // 兜帽
    ctx.fillStyle=h.tier?gold:lite;
    poly([[-.13,-.08],[0,-.34],[.13,-.08]]);ctx.fill();
    ctx.fillStyle='#101a14';ctx.fillRect(-.02,-.19,.11,.05);           // 阴影中的脸
    // 弓
    ctx.save();ctx.translate(.2-pull*.4,0);
    ctx.strokeStyle=h.tier?gold:'#c8a06a';ctx.lineWidth=.045;
    ctx.beginPath();ctx.arc(0,0,.26,-1.15,1.15);ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=.018;
    const sx=Math.cos(1.15)*.26, sy=Math.sin(1.15)*.26;
    ctx.beginPath();ctx.moveTo(sx,-sy);ctx.lineTo(-.02-pull,0);ctx.lineTo(sx,sy);ctx.stroke();
    if(p>0){   // 搭上的箭
      ctx.strokeStyle=metal;ctx.lineWidth=.022;
      ctx.beginPath();ctx.moveTo(-.04-pull,0);ctx.lineTo(.22,0);ctx.stroke();
    }
    ctx.restore();
  }else{
    // 法师
    const glow=.55+.45*Math.sin(gt*3.4)+(p>0?.6:0);
    // 长袍
    ctx.fillStyle=base;
    poly([[-.13,-.08],[.13,-.08],[.2,.28],[-.2,.28]]);ctx.fill();
    ctx.strokeStyle=dark;ctx.lineWidth=.025;ctx.stroke();
    ctx.fillStyle=h.tier?gold:lite;ctx.fillRect(-.14,-.08,.28,.04);   // 领口
    // 头
    ctx.fillStyle='#e8d5b5';ctx.beginPath();ctx.arc(0,-.17,.085,0,7);ctx.fill();
    // 尖帽
    ctx.fillStyle=lite;
    poly([[-.16,-.22],[0,-.44],[.16,-.22]]);ctx.fill();
    ctx.fillStyle=h.tier?gold:dark;ctx.fillRect(-.18,-.24,.36,.045);
    // 法杖 + 宝珠
    ctx.strokeStyle='#8a6a45';ctx.lineWidth=.035;
    ctx.beginPath();ctx.moveTo(.21,.26);ctx.lineTo(.24,-.26);ctx.stroke();
    ctx.globalAlpha=(dead?.4:1)*Math.min(1,.35+glow*.5);
    ctx.fillStyle=rgba('#bcdcff',.35);
    ctx.beginPath();ctx.arc(.245,-.3,.11+.02*glow,0,7);ctx.fill();
    ctx.globalAlpha=dead?.5:1;
    ctx.fillStyle=h.flash>0?'#fff':'#bcdcff';
    ctx.beginPath();ctx.arc(.245,-.3,.055,0,7);ctx.fill();
  }
  ctx.globalAlpha=1;
  ctx.restore();
}
/* ===== 熊灵模型 ===== */
function drawBear(br,x,y){
  ctx.save();ctx.translate(x,y);
  ctx.fillStyle='rgba(0,0,0,.35)';
  ctx.beginPath();ctx.ellipse(0,.26,.22,.06,0,0,7);ctx.fill();
  const fur='#c9a068',dark='#8e6f45';
  ctx.fillStyle=dark;ctx.fillRect(-.16,.1,.1,.15);ctx.fillRect(.06,.1,.1,.15);
  ctx.fillStyle=fur;rrect(-.2,-.14,.4,.3,.11);ctx.fill();      // 身体
  ctx.fillStyle=dark;                                          // 耳朵
  ctx.beginPath();ctx.arc(.07,-.28,.055,0,7);ctx.fill();
  ctx.beginPath();ctx.arc(.24,-.26,.055,0,7);ctx.fill();
  ctx.fillStyle=fur;rrect(.03,-.28,.24,.22,.09);ctx.fill();    // 头
  ctx.fillStyle='#5c4426';rrect(.19,-.19,.11,.09,.04);ctx.fill(); // 口鼻
  ctx.fillStyle='#1a1208';
  ctx.beginPath();ctx.arc(.11,-.19,.022,0,7);ctx.fill();
  ctx.beginPath();ctx.arc(.21,-.19,.022,0,7);ctx.fill();
  ctx.strokeStyle='#f2f2f2';ctx.lineWidth=.02;                 // 爪子
  for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(.16+i*.03,.06);ctx.lineTo(.2+i*.03,.14);ctx.stroke();}
  ctx.restore();
}
/* ===== 元素召唤物模型（火/水/地狱火，朝右）===== */
function drawElemental(br,x,y){
  const k=br.kind, s=(br.r||.26)/.26, ph=gt*7+x*3;
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.lineJoin='round';
  ctx.fillStyle='rgba(0,0,0,.3)';
  ctx.beginPath();ctx.ellipse(0,.27,.2,.055,0,0,7);ctx.fill();
  if(k==='fire'){
    const fl=1+Math.sin(ph)*.12;
    ctx.globalAlpha=.28;ctx.fillStyle='#ff7a2f';
    ctx.beginPath();ctx.arc(0,-.02,.32*fl,0,7);ctx.fill();ctx.globalAlpha=1;
    ctx.fillStyle='#ff7a2f';   // 火焰躯体（水滴形）
    poly([[0,-.34*fl],[.17,-.02],[.11,.2],[0,.26],[-.11,.2],[-.17,-.02]]);ctx.fill();
    ctx.fillStyle='#ffd24f';
    poly([[0,-.2*fl],[.09,-.01],[.05,.15],[-.05,.15],[-.09,-.01]]);ctx.fill();
    ctx.fillStyle='#fff6d0';   // 眼睛
    ctx.beginPath();ctx.arc(.045,-.05,.028,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(-.045,-.05,.028,0,7);ctx.fill();
    for(let i=0;i<2;i++){      // 上窜的小火苗
      const fy=-.34-((gt*1.6+i*.5)%1)*.22;
      ctx.globalAlpha=.6;ctx.fillStyle='#ffb04f';
      poly([[.05*(i?1:-1),fy],[.05*(i?1:-1)+.035,fy+.07],[.05*(i?1:-1)-.035,fy+.07]]);ctx.fill();
      ctx.globalAlpha=1;
    }
  }else if(k==='water'){
    const wv=Math.sin(ph)*.03;
    ctx.globalAlpha=.25;ctx.fillStyle='#4fc3ff';
    ctx.beginPath();ctx.arc(0,0,.3,0,7);ctx.fill();ctx.globalAlpha=1;
    ctx.fillStyle='#2f8fd0';   // 水体
    poly([[0,-.3],[.19,-.05+wv],[.15,.18],[0,.26],[-.15,.18],[-.19,-.05-wv]]);ctx.fill();
    ctx.globalAlpha=.75;ctx.fillStyle='#7fd8ff';
    poly([[0,-.22],[.12,-.03+wv],[.09,.13],[-.09,.13],[-.12,-.03-wv]]);ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle='rgba(220,250,255,.7)';ctx.lineWidth=.025;   // 波纹
    ctx.beginPath();ctx.moveTo(-.13,.04+wv);ctx.quadraticCurveTo(0,.1+wv,.13,.04-wv);ctx.stroke();
    ctx.fillStyle='#0b2a3d';
    ctx.beginPath();ctx.arc(.05,-.09,.03,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(-.05,-.09,.03,0,7);ctx.fill();
  }else{   // infernal：熔岩巨像
    const gl=.6+.4*Math.sin(ph*.7);
    ctx.globalAlpha=.22*gl;ctx.fillStyle='#ff4d3d';
    ctx.beginPath();ctx.arc(0,0,.4,0,7);ctx.fill();ctx.globalAlpha=1;
    ctx.fillStyle='#3a2420';   // 岩石躯干
    poly([[-.2,.24],[-.22,-.06],[-.13,-.2],[.13,-.2],[.22,-.06],[.2,.24]]);ctx.fill();
    ctx.fillStyle='#2a1a17';   // 双臂
    rrect(-.3,-.12,.1,.26,.04);ctx.fill();rrect(.2,-.12,.1,.26,.04);ctx.fill();
    ctx.fillStyle='#4a2e28';   // 头
    rrect(-.12,-.36,.24,.19,.06);ctx.fill();
    ctx.fillStyle='#2a1a17';   // 犄角
    poly([[-.12,-.36],[-.2,-.5],[-.05,-.38]]);ctx.fill();
    poly([[.12,-.36],[.2,-.5],[.05,-.38]]);ctx.fill();
    ctx.strokeStyle='#ff6a2f';ctx.lineWidth=.032;ctx.globalAlpha=gl;   // 熔岩裂纹
    ctx.beginPath();
    ctx.moveTo(-.14,-.14);ctx.lineTo(-.04,-.02);ctx.lineTo(-.1,.12);
    ctx.moveTo(.14,-.12);ctx.lineTo(.05,.02);ctx.lineTo(.12,.18);
    ctx.stroke();ctx.globalAlpha=1;
    ctx.fillStyle='#ffd24f';   // 发光的眼
    ctx.beginPath();ctx.arc(.06,-.27,.032,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(-.06,-.27,.032,0,7);ctx.fill();
  }
  ctx.restore();
}
/* ===== 怪物模型（朝左推进，形状按种类，配色保持原有辨识度）===== */
function drawMob(m,x,y){
  const c=m.color, dk=shade(c,.55), lt=shade(c,1.35);
  const s=m.r, ph=gt*6+m.x*2.2;              // 走路相位
  const bob=Math.sin(ph)*.07, leg=Math.sin(ph)*.35;
  ctx.save();ctx.translate(x,y+bob*s);ctx.scale(s,s);
  ctx.lineJoin='round';
  ctx.fillStyle='rgba(0,0,0,.32)';
  ctx.beginPath();ctx.ellipse(0,1.02,.78,.2,0,0,7);ctx.fill();
  if(m.trial){   // 试炼怪：脚下对应颜色的光环
    const tc=TRIALS[m.trial].color;
    ctx.globalAlpha=.35+.25*Math.sin(gt*4+m.x);
    ctx.strokeStyle=tc;ctx.lineWidth=.12;
    ctx.beginPath();ctx.ellipse(0,1.02,.85,.24,0,0,7);ctx.stroke();
    ctx.globalAlpha=1;
  }else if(m.elite){   // 精英怪：脚下金色双环
    ctx.globalAlpha=.4+.3*Math.sin(gt*4+m.x);
    ctx.strokeStyle='#f0c46a';ctx.lineWidth=.11;
    ctx.beginPath();ctx.ellipse(0,1.02,.88,.25,0,0,7);ctx.stroke();
    ctx.lineWidth=.06;
    ctx.beginPath();ctx.ellipse(0,1.02,.62,.17,0,0,7);ctx.stroke();
    ctx.globalAlpha=1;
  }
  const eye=(ex,ey,er)=>{
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(ex,ey,er,0,7);ctx.fill();
    ctx.fillStyle='#12060f';ctx.beginPath();ctx.arc(ex-er*.35,ey,er*.5,0,7);ctx.fill();
  };
  if(m.type==='fast'){
    // 疾行者：前倾瘦长，尖脑袋 + 速度线
    ctx.strokeStyle=rgba(c,.35);ctx.lineWidth=.16;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(1.5,-.3);ctx.lineTo(.85,-.3);
    ctx.moveTo(1.7,.15);ctx.lineTo(.95,.15);ctx.stroke();
    ctx.fillStyle=dk;                          // 腿
    ctx.fillRect(-.15,.5,.26,.5+leg*.3);ctx.fillRect(.3,.5,.26,.5-leg*.3);
    ctx.fillStyle=c;
    poly([[-.85,.1],[-.1,-.85],[.75,-.5],[.7,.6],[-.5,.7]]);ctx.fill();
    ctx.fillStyle=lt;
    poly([[-.95,-.35],[-.15,-.75],[-.1,-.15]]);ctx.fill();   // 尖脑袋朝左
    eye(-.45,-.45,.16);
  }else if(m.type==='tank'){
    // 重甲：宽厚方体 + 背甲铆钉 + 头盔
    ctx.fillStyle=dk;
    ctx.fillRect(-.5,.55,.34,.45+leg*.2);ctx.fillRect(.2,.55,.34,.45-leg*.2);
    ctx.fillStyle=c;rrect(-.85,-.6,1.7,1.25,.22);ctx.fill();
    ctx.fillStyle=dk;rrect(.25,-.68,.62,1.4,.2);ctx.fill();  // 背甲
    ctx.fillStyle=lt;
    for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(.56,-.4+i*.5,.09,0,7);ctx.fill();}
    ctx.fillStyle=lt;rrect(-.9,-.95,.95,.5,.14);ctx.fill();  // 头盔
    ctx.fillStyle='#12060f';ctx.fillRect(-.88,-.78,.5,.14);  // 面甲缝
    ctx.fillStyle='#ffd7e6';ctx.fillRect(-.8,-.75,.12,.08);
  }else if(m.type==='boss'){
    // 首领：巨体 + 弯角 + 尖牙 + 发光双眼
    ctx.globalAlpha=.18+.08*Math.sin(gt*3);
    ctx.fillStyle=c;ctx.beginPath();ctx.arc(0,0,1.35,0,7);ctx.fill();
    ctx.globalAlpha=1;
    ctx.fillStyle=dk;
    ctx.fillRect(-.55,.6,.4,.45+leg*.18);ctx.fillRect(.2,.6,.4,.45-leg*.18);
    ctx.fillStyle=c;rrect(-.85,-.5,1.7,1.2,.26);ctx.fill();
    ctx.fillStyle=lt;rrect(-.62,-.3,.5,.8,.12);ctx.fill();   // 胸甲
    ctx.fillStyle=dk;                                         // 肩甲
    ctx.beginPath();ctx.arc(-.7,-.35,.34,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(.7,-.35,.34,0,7);ctx.fill();
    ctx.fillStyle=c;rrect(-.75,-1.1,1.3,.72,.2);ctx.fill();  // 头
    ctx.strokeStyle=lt;ctx.lineWidth=.16;ctx.lineCap='round'; // 角
    ctx.beginPath();ctx.moveTo(-.6,-1.05);ctx.quadraticCurveTo(-1,-1.5,-.5,-1.6);
    ctx.moveTo(.35,-1.05);ctx.quadraticCurveTo(.75,-1.5,.25,-1.6);ctx.stroke();
    ctx.fillStyle='#fff2a0';
    ctx.beginPath();ctx.arc(-.42,-.78,.15,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(.05,-.78,.15,0,7);ctx.fill();
    ctx.fillStyle='#fff';                                     // 尖牙
    poly([[-.6,-.45],[-.45,-.45],[-.52,-.24]]);ctx.fill();
    poly([[-.25,-.45],[-.1,-.45],[-.17,-.28]]);ctx.fill();
  }else{
    // 普通小怪：驼背小鬼，两只角 + 大眼
    ctx.fillStyle=dk;
    ctx.fillRect(-.4,.55,.3,.45+leg*.3);ctx.fillRect(.15,.55,.3,.45-leg*.3);
    ctx.fillStyle=c;
    ctx.beginPath();ctx.ellipse(.1,.2,.72,.65,-.15,0,7);ctx.fill();   // 驼背身体
    ctx.fillStyle=lt;
    ctx.beginPath();ctx.arc(-.35,-.42,.55,0,7);ctx.fill();            // 头
    ctx.fillStyle=c;                                                  // 角
    poly([[-.72,-.72],[-.92,-1.15],[-.45,-.85]]);ctx.fill();
    poly([[-.05,-.72],[.16,-1.12],[-.3,-.88]]);ctx.fill();
    eye(-.52,-.45,.17);eye(-.06,-.42,.14);
    ctx.strokeStyle='#12060f';ctx.lineWidth=.07;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(-.55,-.12);ctx.lineTo(-.15,-.16);ctx.stroke();
  }
  // 减速：冰霜覆层（只有冰系减速才结霜）
  if(m.frost>0){
    ctx.globalAlpha=.3+.12*Math.sin(gt*8);
    ctx.fillStyle='#bfeaff';
    ctx.beginPath();ctx.arc(0,0,1.05,0,7);ctx.fill();
    ctx.globalAlpha=1;
  }
  ctx.restore();
}
/* ===== 宝箱（精英试炼掉落，点击开启）===== */
function drawChest(ch){
  const bob=Math.sin(gt*3+ch.x)*.03, pulse=.5+.5*Math.sin(gt*4+ch.x);
  ctx.save();ctx.translate(ch.x,ch.y+bob);
  ctx.globalAlpha=.2+.2*pulse;                    // 光柱/光晕
  ctx.fillStyle='#f0c46a';
  ctx.beginPath();ctx.arc(0,.02,.42+.06*pulse,0,7);ctx.fill();
  ctx.globalAlpha=1;
  ctx.fillStyle='rgba(0,0,0,.35)';
  ctx.beginPath();ctx.ellipse(0,.22,.24,.06,0,0,7);ctx.fill();
  ctx.fillStyle='#7a4f28';rrect(-.22,-.06,.44,.26,.04);ctx.fill();   // 箱体
  ctx.fillStyle='#8f5f31';                                           // 箱盖
  ctx.beginPath();ctx.moveTo(-.22,-.06);ctx.lineTo(-.22,-.14);
  ctx.quadraticCurveTo(0,-.3,.22,-.14);ctx.lineTo(.22,-.06);ctx.closePath();ctx.fill();
  ctx.fillStyle='#f0c46a';
  ctx.fillRect(-.05,-.22,.1,.32);                                    // 金扣带
  ctx.fillRect(-.22,-.08,.44,.03);
  ctx.fillStyle='#2a1a0c';ctx.fillRect(-.03,-.02,.06,.07);           // 锁孔
  ctx.restore();
}
/* ===== 背景：只画左侧村庄，战斗区留纯色（离屏预渲染，resize 时重画）===== */
let bgCv=null;
function buildBG(){
  const W=Math.round(COLS*cell*dpr),H=Math.round(ROWS*cell*dpr);
  if(W<=0||H<=0)return;
  bgCv=bgCv||document.createElement('canvas');
  bgCv.width=W;bgCv.height=H;
  const g=bgCv.getContext('2d');
  g.setTransform(W/COLS,0,0,H/ROWS,0,0);   // 统一用格子坐标
  /* --- 战斗区：保持干净的纯色，不做背景画（做过异界场景，用户觉得违和已去掉）--- */
  g.fillStyle='#0d1420';g.fillRect(HCOLS,0,BCOLS,ROWS);
  /* --- 左侧：出兵村庄 --- */
  const vg=g.createLinearGradient(0,0,0,ROWS);
  vg.addColorStop(0,'#101d31');vg.addColorStop(1,'#0a1420');
  g.fillStyle=vg;g.fillRect(0,0,HCOLS,ROWS);
  // 每行一栋小屋（坐在该行底线上，作为背景）
  const hut=(x,base,w,h,roof)=>{
    const y=base-h;
    g.fillStyle='#2f2a24';g.fillRect(x,y,w,h);                        // 墙
    g.strokeStyle='rgba(0,0,0,.5)';g.lineWidth=.02;g.strokeRect(x,y,w,h);
    g.fillStyle=roof;                                                  // 屋顶
    g.beginPath();g.moveTo(x-w*.16,y);g.lineTo(x+w/2,y-h*.72);g.lineTo(x+w*1.16,y);g.closePath();g.fill();
    g.fillStyle='rgba(255,198,110,.9)';                                // 暖光窗
    g.fillRect(x+w*.16,y+h*.28,w*.22,h*.26);
    g.fillStyle='rgba(255,198,110,.14)';
    g.fillRect(x+w*.02,y+h*.14,w*.5,h*.55);
    g.fillStyle='#241c14';g.fillRect(x+w*.58,y+h*.42,w*.24,h*.58);     // 门
  };
  hut(.16,.98,.6,.46,'#7d4a33');
  hut(1.6,1.96,.54,.42,'#5b5288');
  hut(.5,2.96,.62,.48,'#7d4a33');
  // 小树
  const tree=(x,base,s2)=>{
    g.fillStyle='#3b2c1e';g.fillRect(x-.03*s2,base-.22*s2,.06*s2,.22*s2);
    g.fillStyle='#2f5a44';
    g.beginPath();g.moveTo(x-.19*s2,base-.2*s2);g.lineTo(x,base-.62*s2);g.lineTo(x+.19*s2,base-.2*s2);g.closePath();g.fill();
  };
  tree(1.15,.98,1);tree(2.5,1.96,.85);tree(1.85,2.96,1);
  // 村旗
  g.strokeStyle='#5b4a35';g.lineWidth=.045;
  g.beginPath();g.moveTo(2.62,.2);g.lineTo(2.62,1.0);g.stroke();
  g.fillStyle='#c94d5e';
  g.beginPath();g.moveTo(2.64,.22);g.lineTo(2.98,.36);g.lineTo(2.64,.52);g.closePath();g.fill();
  // 地面草带 + 栅栏（村庄与战场分界）
  g.fillStyle='rgba(52,86,64,.35)';
  for(let r=0;r<ROWS;r++)g.fillRect(0,r+.9,HCOLS,.1);
  g.strokeStyle='rgba(140,116,80,.5)';g.lineWidth=.05;
  for(let i=0;i<12;i++){
    const y=i*ROWS/12+.04;
    g.beginPath();g.moveTo(HCOLS-.1,y);g.lineTo(HCOLS-.1,y+.17);g.stroke();
  }
}
/* ===== 弹道模型 ===== */
function drawShot(s){
  ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.a||0);
  if(s.kind==='orb'){
    // 奥术弹：光晕 + 拖尾
    const g=.7+.3*Math.sin(gt*18);
    ctx.globalAlpha=.28;ctx.fillStyle=s.color;
    ctx.beginPath();ctx.moveTo(-.34,0);ctx.lineTo(0,-.075);ctx.lineTo(0,.075);ctx.closePath();ctx.fill();
    ctx.globalAlpha=.3*g;
    ctx.beginPath();ctx.arc(0,0,.17,0,7);ctx.fill();
    ctx.globalAlpha=1;
    ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(0,0,.085,0,7);ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-.015,-.015,.035,0,7);ctx.fill();
  }else{
    // 箭矢：杆 + 箭头 + 尾羽
    ctx.globalAlpha=.3;ctx.strokeStyle=s.color;ctx.lineWidth=.05;
    ctx.beginPath();ctx.moveTo(-.42,0);ctx.lineTo(-.12,0);ctx.stroke();
    ctx.globalAlpha=1;
    ctx.strokeStyle='#d8c9a8';ctx.lineWidth=.035;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(-.2,0);ctx.lineTo(.1,0);ctx.stroke();
    ctx.fillStyle=s.color;
    poly([[.2,0],[.05,-.075],[.08,0],[.05,.075]]);ctx.fill();
    ctx.strokeStyle=s.color;ctx.lineWidth=.028;
    ctx.beginPath();ctx.moveTo(-.2,0);ctx.lineTo(-.28,-.075);ctx.moveTo(-.2,0);ctx.lineTo(-.28,.075);ctx.stroke();
  }
  ctx.restore();
}
function draw(){
  ctx.setTransform(dpr*cell,0,0,dpr*cell,0,0);
  ctx.clearRect(0,0,COLS,ROWS);
  if(bgCv)ctx.drawImage(bgCv,0,0,COLS,ROWS);
  for(let c=0;c<HCOLS;c++){
    const col=CLASSES[COL_CLASS[c]].color;
    ctx.fillStyle=rgba(col,.09);
    for(let r=0;r<ROWS;r++)ctx.fillRect(c+.03,r+.03,.94,.94);
  }
  ctx.strokeStyle='#1c2940';ctx.lineWidth=.02;
  ctx.beginPath();
  for(let c=HCOLS;c<=COLS;c++){ctx.moveTo(c,0);ctx.lineTo(c,ROWS);}
  for(let r=0;r<=ROWS;r++){ctx.moveTo(0,r);ctx.lineTo(COLS,r);}
  ctx.stroke();
  ctx.strokeStyle='rgba(255,93,93,.5)';ctx.lineWidth=.05;
  ctx.beginPath();ctx.moveTo(HCOLS,0);ctx.lineTo(HCOLS,ROWS);ctx.stroke();
  if(sel){
    ctx.strokeStyle='#8ab8d8';ctx.lineWidth=.06;
    ctx.strokeRect(sel.col+.06,sel.row+.06,.88,.88);
  }
  // 火焰风暴：燃烧区域
  for(const s of storms){
    if(s.delay>0)continue;
    const fl=.75+.25*Math.sin(gt*13+s.cx);
    ctx.globalAlpha=.17*fl;ctx.fillStyle='#ff7a2f';
    ctx.beginPath();ctx.arc(s.cx,s.cy,s.R,0,7);ctx.fill();
    ctx.globalAlpha=.5*fl;ctx.strokeStyle='#ffb04f';ctx.lineWidth=.05;
    ctx.beginPath();ctx.arc(s.cx,s.cy,s.R,0,7);ctx.stroke();
    ctx.globalAlpha=1;
  }
  // 大地震颤：龟裂的矩形地面
  for(const q of quakes){
    const w=q.x1-q.x0,hh=q.y1-q.y0;
    const fl=.7+.3*Math.sin(gt*17+q.x0);
    ctx.globalAlpha=.16*fl;ctx.fillStyle='#a86b32';
    ctx.fillRect(q.x0,q.y0,w,hh);
    ctx.globalAlpha=.55*fl;ctx.strokeStyle='#e0a05a';ctx.lineWidth=.05;
    ctx.strokeRect(q.x0,q.y0,w,hh);
    // 裂缝（位置由区域坐标决定，保持稳定）
    ctx.globalAlpha=.5*fl;ctx.strokeStyle='#5a3b22';ctx.lineWidth=.045;
    ctx.beginPath();
    for(let i=0;i<7;i++){
      const s=Math.abs(Math.sin((q.x0+i*3.7)*12.9898))%1;
      const cy=q.y0+((i+.5)/7)*hh;
      ctx.moveTo(q.x0+.1,cy+(s-.5)*.3);
      for(let j=1;j<=5;j++){
        const t2=Math.abs(Math.sin((i*9.1+j*4.3)*78.233))%1;
        ctx.lineTo(q.x0+.1+(w-.2)*j/5,cy+(t2-.5)*.42);
      }
    }
    ctx.stroke();ctx.globalAlpha=1;
  }
  ctx.textAlign='center';
  // 英雄
  for(const h of heroes){
    const x=h.x,y=h.row+.5;
    drawHero(h,x,y);
    if(h.alive&&h.endT>0){   // 忍受：金色护盾罩
      const p=.75+.25*Math.sin(gt*9);
      ctx.globalAlpha=.5*p;ctx.strokeStyle='#ffd24f';ctx.lineWidth=.05;
      ctx.beginPath();ctx.arc(x,y-.04,.44,0,7);ctx.stroke();
      ctx.globalAlpha=.12*p;ctx.fillStyle='#ffd24f';
      ctx.beginPath();ctx.arc(x,y-.04,.44,0,7);ctx.fill();
      ctx.globalAlpha=1;
    }
    if(h.alive){
      // 血条（等级框在左端）
      ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(x-.24,y-.53,.58,.08);
      ctx.fillStyle='#6ee7a0';ctx.fillRect(x-.24,y-.53,.58*Math.max(h.hp/h.maxHp,0),.08);
      // 蓝条（法力）
      ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(x-.24,y-.43,.58,.06);
      ctx.fillStyle='#4f8dff';ctx.fillRect(x-.24,y-.43,.58*Math.max(h.mp/h.maxMp,0),.06);
      // 等级框
      ctx.fillStyle='#0a0e16';ctx.fillRect(x-.45,y-.54,.2,.17);
      ctx.strokeStyle='#f0c46a';ctx.lineWidth=.02;ctx.strokeRect(x-.45,y-.54,.2,.17);
      ctx.fillStyle='#f0c46a';ctx.font='600 .13px -apple-system,sans-serif';
      ctx.fillText(h.lv,x-.35,y-.41);
      // 经验条（紫，魔兽风格）
      ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(x-.34,y+.37,.68,.06);
      ctx.fillStyle='#b070ff';ctx.fillRect(x-.34,y+.37,.68*(h.lv>=MAX_HERO_LV?1:Math.min(h.xp/xpNeed(h.lv),1)),.06);
    }
  }
  // 召唤物
  for(const br of bears){
    const y=br.row+.5+(br.oy||0);
    if(br.kind&&br.kind!=='bear')drawElemental(br,br.x,y);else drawBear(br,br.x,y);
    const bw=br.kind==='infernal'?.76:.56;
    ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(br.x-bw/2,y-.42,bw,.08);
    ctx.fillStyle='#6ee7a0';ctx.fillRect(br.x-bw/2,y-.42,bw*Math.max(br.hp/br.maxHp,0),.08);
  }
  // 怪物
  for(const m of mobs){
    const y=m.y+.5;
    drawMob(m,m.x,y);
    ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(m.x-m.r,y-m.r-.15,m.r*2,.08);
    ctx.fillStyle='#6ee7a0';ctx.fillRect(m.x-m.r,y-m.r-.15,m.r*2*Math.max(m.hp/m.maxHp,0),.08);
  }
  for(const ch of chests)drawChest(ch);
  for(const s of shots)drawShot(s);
  for(const f of fx){
    const k=1-f.t/f.max;
    if(f.type==='line'){
      ctx.strokeStyle=f.color;ctx.globalAlpha=1-k;ctx.lineWidth=.07;
      ctx.beginPath();ctx.moveTo(f.x1,f.y1);ctx.lineTo(f.x2,f.y2);ctx.stroke();
      ctx.globalAlpha=1;
    }else if(f.type==='aoe'){
      ctx.beginPath();ctx.arc(f.x,f.y,f.rr,0,7);
      ctx.fillStyle=f.color;ctx.globalAlpha=.22*(1-k);ctx.fill();
      ctx.globalAlpha=1-k;ctx.strokeStyle=f.color;ctx.lineWidth=.05;ctx.stroke();
      ctx.globalAlpha=1;
    }else if(f.type==='fall'){
      // 冰雹从上方坠落：k=0在高处，k=1落地
      const fy=f.y-1.5*(1-k);
      ctx.globalAlpha=.35+.5*k;
      ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=.03;
      ctx.beginPath();ctx.moveTo(f.x,fy-.34);ctx.lineTo(f.x,fy-.14);ctx.stroke();
      ctx.fillStyle=f.color;                       // 冰棱（菱形）
      poly([[f.x,fy+.09],[f.x-.055,fy-.05],[f.x,fy-.16],[f.x+.055,fy-.05]]);ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.75)';
      poly([[f.x,fy+.02],[f.x-.02,fy-.05],[f.x,fy-.13]]);ctx.fill();
      ctx.globalAlpha=1;
    }else if(f.type==='bolt'){
      // 火球：带拖尾的飞行弹 + 落点爆闪
      const fp=Math.min(1,k/.62), bx=f.x1+(f.x2-f.x1)*fp, by=f.y1+(f.y2-f.y1)*fp;
      const ang=Math.atan2(f.y2-f.y1,f.x2-f.x1);
      if(fp<1){
        ctx.save();ctx.translate(bx,by);ctx.rotate(ang);
        ctx.globalAlpha=.35;ctx.fillStyle=f.color;
        poly([[-.5,0],[0,-.1],[0,.1]]);ctx.fill();
        ctx.globalAlpha=.45;
        ctx.beginPath();ctx.arc(0,0,.19,0,7);ctx.fill();
        ctx.globalAlpha=1;
        ctx.beginPath();ctx.arc(0,0,.1,0,7);ctx.fill();
        ctx.fillStyle='#fff4c0';ctx.beginPath();ctx.arc(0,0,.045,0,7);ctx.fill();
        ctx.restore();
      }else{
        const e=(k-.62)/.38;
        ctx.globalAlpha=(1-e)*.8;ctx.fillStyle=f.color;
        ctx.beginPath();ctx.arc(f.x2,f.y2,.15+e*.5,0,7);ctx.fill();
      }
      ctx.globalAlpha=1;
    }else if(f.type==='zap'){
      // 闪电链：折线电弧
      const N=6,dx=(f.x2-f.x1)/N,dy=(f.y2-f.y1)/N;
      const nx=-(f.y2-f.y1),ny=(f.x2-f.x1),nl=Math.hypot(nx,ny)||1;
      ctx.globalAlpha=(1-k)*(.7+.3*Math.random());
      for(let pass=0;pass<2;pass++){
        ctx.strokeStyle=pass?'#ffffff':f.color;
        ctx.lineWidth=pass?.03:.085;
        ctx.beginPath();ctx.moveTo(f.x1,f.y1);
        for(let i=1;i<N;i++){
          const o=Math.sin(f.seed+i*2.3+pass)*.16*(1-Math.abs(i/N-.5)*1.2);
          ctx.lineTo(f.x1+dx*i+nx/nl*o,f.y1+dy*i+ny/nl*o);
        }
        ctx.lineTo(f.x2,f.y2);ctx.stroke();
      }
      ctx.globalAlpha=1;
    }else if(f.type==='slash'){
      // 战士挥砍：弧形刀光
      ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.a);
      ctx.globalAlpha=1-k;
      ctx.strokeStyle=f.color;ctx.lineWidth=.11*(1-k)+.03;
      ctx.beginPath();ctx.arc(0,0,f.rr*(.7+.5*k),-1.05,1.05);ctx.stroke();
      ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=.03;
      ctx.beginPath();ctx.arc(0,0,f.rr*(.7+.5*k),-.85,.85);ctx.stroke();
      ctx.restore();ctx.globalAlpha=1;
    }else if(f.type==='flame'){
      // 火焰风暴：上窜的火舌
      const fy=f.y-.45*k, sz=f.sz*(1-k*.55);
      ctx.globalAlpha=(1-k)*.9;ctx.fillStyle=f.color;
      poly([[f.x,fy-.3*sz],[f.x+.12*sz,fy],[f.x,fy+.14*sz],[f.x-.12*sz,fy]]);ctx.fill();
      ctx.globalAlpha=1;
    }else if(f.type==='sword'){
      // 剑雨：剑从上方插下
      const sy=f.y-1.4*(1-k)*(1-k);
      ctx.globalAlpha=k<.85?1:(1-k)/.15;
      ctx.strokeStyle=f.color;ctx.lineWidth=.035;
      ctx.beginPath();ctx.moveTo(f.x,sy-.3);ctx.lineTo(f.x,sy+.1);ctx.stroke();   // 剑身
      ctx.lineWidth=.028;
      ctx.beginPath();ctx.moveTo(f.x-.07,sy-.24);ctx.lineTo(f.x+.07,sy-.24);ctx.stroke(); // 护手
      ctx.globalAlpha=1;
    }else if(f.type==='rock'){
      // 大地震颤：崩起又落下的碎石
      const ry=f.y-(.5-Math.abs(k-.5)*2*.5)*.45, sz=f.sz*(1-k*.4);
      ctx.globalAlpha=1-k*k;ctx.fillStyle=f.color;
      poly([[f.x+f.vx*k*.5-.07*sz,ry+.06*sz],[f.x+f.vx*k*.5-.02*sz,ry-.08*sz],
            [f.x+f.vx*k*.5+.08*sz,ry-.03*sz],[f.x+f.vx*k*.5+.04*sz,ry+.07*sz]]);ctx.fill();
      ctx.globalAlpha=1;
    }else if(f.type==='heal'){
      // 治疗：上浮的十字
      const hy=f.y-.55*k;
      ctx.globalAlpha=(1-k)*.9;ctx.fillStyle=f.color;
      ctx.fillRect(f.x-.035,hy-.11,.07,.22);
      ctx.fillRect(f.x-.11,hy-.035,.22,.07);
      ctx.globalAlpha=1;
    }else if(f.type==='spark'){
      const d=.25+k*1.1;
      ctx.beginPath();ctx.arc(f.x+f.ax*d,f.y+f.ay*d,.06*(1-k)+.02,0,7);
      ctx.fillStyle=f.color;ctx.globalAlpha=1-k;ctx.fill();ctx.globalAlpha=1;
    }else{
      ctx.beginPath();ctx.arc(f.x,f.y,f.rr*(.4+.6*k),0,7);
      ctx.strokeStyle=f.color;ctx.globalAlpha=1-k;ctx.lineWidth=.06;ctx.stroke();ctx.globalAlpha=1;
    }
  }
  ctx.font='600 .3px -apple-system,sans-serif';
  for(const n of nums){
    ctx.fillStyle=n.color;ctx.globalAlpha=Math.min(1,n.t/n.max*1.6);
    ctx.fillText(n.txt,n.x,n.y);
  }
  ctx.globalAlpha=1;
}

/* ================= UI ================= */
const uiMoney=document.getElementById('uiMoney'),uiWood=document.getElementById('uiWood'),
      uiLife=document.getElementById('uiLife'),uiWave=document.getElementById('uiWave'),
      info=document.getElementById('info'),invEl=document.getElementById('invItems'),
      toast=document.getElementById('toast'),ghost=document.getElementById('dragGhost');
const tiles={skill:document.getElementById('tileSkill'),item:document.getElementById('tileItem'),
             mine:document.getElementById('tileMine'),mill:document.getElementById('tileMill')};
let toastT=null;
function showToast(msg){
  toast.innerHTML=msg;toast.classList.add('show');
  clearTimeout(toastT);toastT=setTimeout(()=>toast.classList.remove('show'),1800);
}
function updateHUD(){
  uiMoney.textContent=Math.floor(gold);uiWood.textContent=Math.floor(wood);
  uiLife.textContent=lives;
  uiWave.textContent=wave+'/'+TOTAL_WAVES+(running&&started&&!over&&wave<TOTAL_WAVES?' · '+Math.ceil(waveT)+'s':'');
  renderTrials();
  document.getElementById('mineLvT').textContent='Lv'+mineLv+' +'+mineLv+'/s';
  document.getElementById('millLvT').textContent='Lv'+millLv+' +'+millLv+'/s';
  // 英雄面板的HP/MP实时刷新（不重建DOM，避免打断点击）
  const hv=document.getElementById('hpVal'),mv=document.getElementById('mpVal'),h=selHero();
  if(h&&hv&&mv){
    hv.textContent=Math.ceil(h.hp)+'/'+h.maxHp;
    mv.textContent=Math.floor(h.mp)+'/'+h.maxMp;
    // 攻击间隔会随血怒(狂战士)动态变化，跟HP/MP一样原地刷新
    const iv=document.getElementById('itvVal');
    if(iv)iv.textContent=effInterval(h).toFixed(2)+'s';
  }
}
function selHero(){return sel?heroAt(sel.col,sel.row):null;}

function renderInfo(){
  if(over)return;
  if(openShop){info.innerHTML=shopHTML();return;}
  if(invSel!=null&&inv[invSel]){
    const it=inv[invSel];
    if(it.t==='book'){
      const d=SKB[it.name];
      info.innerHTML=`<div class="card"><b style="color:${CATS[d.cat].color}">${it.name}</b>
        <span style="color:${QC[d.q]}">[${QN[d.q]}]</span>
        <span>${CATS[d.cat].label}系技能书</span><br><span>${d.desc}</span><br><span>拖到英雄上学习，同名升级（上限Lv${MAX_SKILL_LV}）</span></div>`;
    }else{
      const d=eqDef(it),q=qOf(it);
      info.innerHTML=`<div class="card"><b style="color:${q.c}">${d.n}</b> <span style="color:${q.c}">[${q.n}]</span><br>
        <span>${eqDesc(d)}</span><br><span>拖到英雄上穿戴（${MAX_EQUIP}个装备位）</span></div>`;
    }
    return;
  }
  const h=selHero();
  let html='';
  if(sel&&!h){
    const cls=COL_CLASS[sel.col],b=CLASSES[cls];
    const hc=heroCost();
    html=`<div class="card"><b style="color:${b.color}">初始${b.name}</b> <span>${b.desc}</span><br>
      <span>HP ${b.hpB+b.attr.str*8} · 攻 ${b.wep+b.attr[b.main]} · 间隔 ${b.bat}s · 甲 ${b.baseArmor}</span><br>
      <span>力${b.attr.str}(+${b.grow.str}) 敏${b.attr.agi}(+${b.grow.agi}) 智${b.attr.int}(+${b.grow.int})</span></div>
      <button class="btn" id="buyAt" data-cost="${hc}" data-lock="${heroes.length>=MAX_HEROES?1:0}" ${gold<hc||heroes.length>=MAX_HEROES?'disabled':''}>
        买入 <span class="cost">${hc}金</span>${heroes.length>=MAX_HEROES?'<br><span class="sub">已满3人</span>':'<br><span class="sub">第'+(heroes.length+1)+'个英雄</span>'}</button>`;
  }else if(h){
    const b=CLASSES[h.cls];
    const advOK=!h.tier&&h.lv>=ADV_LV, canAdv=advOK&&gold>=ADV_GOLD&&wood>=ADV_WOOD;
    const xpTxt=h.lv>=MAX_HERO_LV?'满级':`经验 ${Math.floor(h.xp)}/${xpNeed(h.lv)}`;
    // 4个技能栏（空栏虚线，学了填充；长按看介绍）
    const names=Object.keys(h.skills),sk=[];
    for(let i=0;i<MAX_SLOTS;i++){
      const n=names[i];
      // 边框颜色=技能品质（绿/蓝/紫），文字颜色=属性系（力红/敏绿/智蓝）
      sk.push(n?`<div class="slot f" data-skslot="${i}" data-lps="${n}" style="border-color:${QC[SKB[n].q]};color:${CATS[SKB[n].cat].color}">${SKB[n].short}<i>Lv${h.skills[n]}</i></div>`
              :`<div class="slot" data-skslot="${i}">空</div>`);
    }
    // 2×3装备栏
    const eq=[];
    for(let i=0;i<MAX_EQUIP;i++){
      const e=h.equips[i];
      eq.push(e?`<div class="slot f" data-eqslot="${i}" data-lpe="${i}" style="border-color:${qOf(e).c};color:${qOf(e).c}">${eqDef(e).s}</div>`
              :`<div class="slot" data-eqslot="${i}">空</div>`);
    }
    html=`<div class="hcard">
      <div><b style="color:${b.color}">${dispName(h)}</b> <span class="dim">Lv${h.lv} · ${xpTxt}</span></div>
      <div class="hgrid">
        <span>HP <b id="hpVal">${Math.ceil(h.hp)}/${h.maxHp}</b></span>
        <span>MP <b id="mpVal">${Math.floor(h.mp)}/${h.maxMp}</b> +${h.mpRegen.toFixed(1)}/s</span>
        <span>攻击 <b>${h.atk}</b></span>
        <span>攻速 <b>${h.ias}</b></span>
        <span>基础间隔 <b>${h.bat.toFixed(2)}s</b></span>
        <span>实际间隔 <b id="itvVal">${effInterval(h).toFixed(2)}s</b> <span class="dim">${(1/effInterval(h)).toFixed(2)}次/s</span></span>
        <span>护甲 <b>${h.armor}</b> ${Math.round(armorRed(h.armor)*100)}%</span>
        <span style="color:#ff9d9d">力 <b>${h.str}</b></span>
        <span style="color:#8ce8a8">敏 <b>${h.agi}</b></span>
        <span style="color:#8db8ff">智 <b>${h.int}</b></span>
        <span>抗 <b>${Math.round(h.mres*100)}%</b>${h.cdr?' CD-'+Math.round(h.cdr*100)+'%':''}${h.block?' 挡'+h.block:''}</span>
      </div>${h.tier?`<div style="margin-top:2px;color:${b.color};font-size:9.5px">专精 <b>${SPECS[advOf(h).key].n}</b> Lv${h.specLv} — <span style="color:var(--ink-dim)">${SPECS[advOf(h).key].d(h.specLv)}</span></div>`:''}</div>
      <button class="autoBtn${h.autoLearn?' on':''}" data-auto="1">自动<br>学习</button>
      <div class="slotgrid sk">${sk.join('')}</div>
      <div class="slotgrid eq">${eq.join('')}</div>`;
    if(!h.tier){
      const canBase=h.lv>=ADV_LV, can=canBase&&gold>=ADV_GOLD&&wood>=ADV_WOOD;
      if(!advPick){
        // 单个转职按钮，点击后展开分支选择
        html+=`<button class="btn" id="advOpen" data-lock="${canBase?0:1}" ${can?'':'disabled'}>
          转职 ▸<br><span class="sub">${canBase?'选择支线':'需Lv'+ADV_LV}</span> <span class="cost">${ADV_GOLD}金</span>+<span class="costw">${ADV_WOOD}木</span></button>`;
      }else{
        // 展开：两条支线二选一
        html+=`<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">`+
          ADV[h.cls].map((br,i)=>
            `<button class="btn" data-adv="${i}" data-cost="${ADV_GOLD}" data-wood="${ADV_WOOD}" data-lock="0" ${can?'':'disabled'} style="padding:4px 8px">
              ${br.name} <span style="color:${b.color};font-size:9px">[${SPECS[br.key].n}]</span></button>`
          ).join('')+
          `<button class="btn" id="advCancel" style="padding:2px 8px;font-size:10px">取消</button></div>`;
      }
    }else if(h.specLv<SPEC_MAX){
      const sc=specCost(h.specLv);
      html+=`<button class="btn" data-spec="1" data-cost="${sc.g}" data-wood="${sc.w}" data-lock="0" ${gold>=sc.g&&wood>=sc.w?'':'disabled'}>
        专精升级 Lv${h.specLv+1}<br><span class="cost">${sc.g}金</span>+<span class="costw">${sc.w}木</span></button>`;
    }
  }else{
    const n=mobs.length+queue.length;
    html=`<div class="hint">${!started?'布阵阶段：买好英雄后点右上角 <b style="color:#8ab8d8">▶ 启动</b> 开始进攻':
      n?'第 '+wave+' 波'+(isBossWave(wave)?' <b style="color:#ff5d5d">· BOSS关</b>':isEliteWave(wave)?' <b style="color:#f0c46a">· 精英波</b>':'')+' — 剩余 '+n
       :'点 3×3 格子买英雄；技能书/装备从背包拖到英雄身上'}</div>`;
  }
  info.innerHTML=html;
  const ba=document.getElementById('buyAt');
  if(ba)ba.onclick=()=>{
    const hc=heroCost();
    if(gold>=hc&&heroes.length<MAX_HEROES&&sel&&!heroAt(sel.col,sel.row)){
      gold-=hc;
      heroes.push(makeHero(COL_CLASS[sel.col],sel.row,sel.col));
      updateHUD();renderInfo();
    }
  };
  const au=info.querySelector('[data-auto]');
  if(au)au.onclick=()=>{
    const hh=selHero();if(!hh)return;
    hh.autoLearn=!hh.autoLearn;
    if(hh.autoLearn){
      showToast('已启用自动学习：商店刷出的同名技能书会自动升级');
      autoLearnPass();renderInv();
    }
    renderInfo();
  };
  const ao=document.getElementById('advOpen');
  if(ao)ao.onclick=()=>{advPick=true;renderInfo();};
  const ac=document.getElementById('advCancel');
  if(ac)ac.onclick=()=>{advPick=false;renderInfo();};
  info.querySelectorAll('[data-adv]').forEach(btn=>btn.onclick=()=>{
    const hh=selHero();if(!hh||hh.tier||hh.lv<ADV_LV)return;
    if(gold>=ADV_GOLD&&wood>=ADV_WOOD){
      gold-=ADV_GOLD;wood-=ADV_WOOD;
      hh.tier=1;hh.branch=+btn.dataset.adv;hh.specLv=1;
      calc(hh);hh.hp=hh.maxHp;
      levelFx(hh.x,hh.row+.5);
      advPick=false;
      updateHUD();renderInfo();
    }
  });
  const sb=info.querySelector('[data-spec]');
  if(sb)sb.onclick=()=>{
    const hh=selHero();if(!hh||!hh.tier||hh.specLv>=SPEC_MAX)return;
    const sc=specCost(hh.specLv);
    if(gold>=sc.g&&wood>=sc.w){
      gold-=sc.g;wood-=sc.w;hh.specLv++;
      calc(hh);
      fx.push({type:'ring',x:hh.x,y:hh.row+.5,rr:.7,t:.4,max:.4,color:'#f0c46a'});
      updateHUD();renderInfo();
    }
  };
}

/* ---- 商店 ---- */
function setShop(kind){
  openShop=openShop===kind?null:kind;
  invSel=null;
  for(const k in tiles)tiles[k].classList.toggle('on',k===openShop);
  renderInfo();
}
function closeShop(){
  openShop=null;
  for(const k in tiles)tiles[k].classList.remove('on');
}
function shopHTML(){
  if(openShop==='skill'){
    return `<div class="card shopHead"><b>技能商店</b><br><span>每次${PACK_N}本进背包</span></div>`+
      Object.entries(CATS).map(([cat,c])=>
        `<button class="btn grow" data-pack="${cat}" data-cost="${PACK_COST}" data-lock="0" ${gold>=PACK_COST?'':'disabled'}>
          <b style="color:${c.color}">${c.label}</b> <span class="cost">${PACK_COST}金</span>
          <span class="sub">${Object.keys(SKB).filter(n=>SKB[n].cat===cat).join('/')}</span></button>`).join('')+
      `<button class="btn grow" data-pack="roll" data-cost="${ROLL_COST}" data-lock="0" ${gold>=ROLL_COST?'':'disabled'}>
        <b style="color:#f0c46a">ROLL</b> <span class="cost">${ROLL_COST}金</span>
        <span class="sub">全池·半价（新书替换旧书）</span></button>`;
  }
  if(openShop==='item'){
    return `<div class="card shopHead"><b>装备商店</b><br><span>每档roll4件<br>越贵越出高品质</span></div>`+
      Object.entries(EQ_TIERS).map(([k,t])=>
        `<button class="btn grow" data-eqroll="${k}" data-cost="${t.cost}" data-lock="0" ${gold>=t.cost?'':'disabled'}>
          <b>${t.n}</b> <span class="cost">${t.cost}金</span>
          <span class="sub">白${t.w.common}/绿${t.w.fine}/蓝${t.w.rare}/紫${t.w.epic}%</span></button>`).join('');
  }
  const isMine=openShop==='mine';
  const lv=isMine?mineLv:millLv, cost=isMine?mineCost(lv):millCost(lv);
  const head=`<div class="card shopHead"><b>${isMine?'金矿':'伐木场'} Lv${lv}/${INCOME_MAX}</b><br><span>每秒 +${lv} ${isMine?'金币':'木头'}</span></div>`;
  if(lv>=INCOME_MAX)
    return head+`<button class="btn grow" disabled><b>已满级</b><span class="sub">每秒 +${lv} ${isMine?'金币':'木头'}</span></button>`;
  return head+
    `<button class="btn grow" data-shop="${openShop}" data-cost="${cost}" data-lock="0" ${gold>=cost?'':'disabled'}>
      <b>升级到 Lv${lv+1}</b> <span class="cost">${cost}金</span>
      <span class="sub">每秒 +${lv} → +${lv+1}${isMine?'':'（木头用于转职）'}</span></button>`;
}
function refreshAfford(){
  document.querySelectorAll('#info [data-cost]').forEach(b=>{
    b.disabled=b.dataset.lock==='1'||gold<+b.dataset.cost||wood<+(b.dataset.wood||0);
  });
}
document.getElementById('sellAll').addEventListener('click',()=>{
  const sellable=inv.filter(canSell);
  if(!sellable.length)return;
  const total=sellable.reduce((s,it)=>s+sellValue(it),0);
  gold+=total;
  inv=inv.filter(it=>!canSell(it));   // 技能书保留在背包
  invSel=null;
  showToast(`出售 ${sellable.length} 件装备，获得 <b style="color:var(--gold)">${total}金</b>`);
  updateHUD();renderInv();renderInfo();
});
/* 四大试炼图标：旋转CD遮罩 + 就绪脉动 */
const trialBtns=[...document.querySelectorAll('.tile.trial')];
for(const b of trialBtns){
  const k=b.dataset.trial;
  b.style.setProperty('--tc',TRIALS[k].color);
  b.addEventListener('click',()=>{
    if(trialReady(k))startTrial(k);
    else{
      const T=TRIALS[k];
      showToast(`<b style="color:${T.color}">${T.n}</b>（CD ${T.cd}s）<br>${T.desc}`
        +(wave<T.minWave?`<br><b style="color:#ff9d9d">第 ${T.minWave} 波后开放</b>`
          :(trialCd[k]>0?`<br>冷却中 ${Math.ceil(trialCd[k])}s`:'')));
    }
  });
}
function renderTrials(){
  if(!trialCd)return;
  for(const b of trialBtns){
    const k=b.dataset.trial,T=TRIALS[k],cd=trialCd[k]||0;
    const locked=wave<T.minWave;
    b.classList.toggle('locked',locked);
    b.classList.toggle('ready',!locked&&cd<=0&&started&&!over);
    b.querySelector('.cdmask').style.setProperty('--p',(cd/T.cd*360)+'deg');
    b.querySelector('.lv').textContent=
      locked?`第${T.minWave}波开`:(cd>0?Math.ceil(cd)+'s':'就绪');
  }
}
tiles.skill.addEventListener('click',()=>setShop('skill'));
tiles.item.addEventListener('click',()=>setShop('item'));
tiles.mine.addEventListener('click',()=>setShop('mine'));
tiles.mill.addEventListener('click',()=>setShop('mill'));

/* ---- 背包（技能书+装备混放）---- */
function buyPack(cat){
  const cost=cat==='roll'?ROLL_COST:PACK_COST;
  if(gold<cost)return;
  gold-=cost;
  inv=inv.filter(it=>it.t!=='book');   // 上次没用完的技能书不保留
  const pool=cat==='roll'?Object.keys(SKB):Object.keys(SKB).filter(n=>SKB[n].cat===cat);
  for(let i=0;i<PACK_N;i++)inv.push({t:'book',name:pickBook(pool)});
  if(invSel!=null&&(!inv[invSel]||inv[invSel].t!=='book'))invSel=null;
  autoLearnPass();
  updateHUD();renderInfo();renderInv();
}
/* 自动学习：开启的英雄会自动吃掉自己已学同名技能书来升级 */
function autoLearnPass(){
  if(!heroes.some(h=>h.autoLearn))return;
  const got=[];
  for(let i=inv.length-1;i>=0;i--){
    const it=inv[i];
    if(it.t!=='book')continue;
    const h=heroes.find(o=>o.autoLearn&&o.skills[it.name]&&o.skills[it.name]<MAX_SKILL_LV);
    if(!h)continue;
    h.skills[it.name]++;calc(h);
    fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.6,t:.4,max:.4,color:CATS[SKB[it.name].cat].color});
    got.push(`${it.name}→Lv${h.skills[it.name]}`);
    inv.splice(i,1);
    if(invSel===i)invSel=null;
  }
  if(got.length)showToast('自动学习：'+got.join('、'));
}
function buyEquip(tier){
  const cost=EQ_TIERS[tier].cost;
  if(gold<cost)return;
  gold-=cost;
  for(let i=0;i<4;i++)inv.push(rollEquip(tier));   // 每档固定roll4件
  updateHUD();renderInfo();renderInv();
}
function renderInv(){
  invEl.innerHTML='';
  const sb=document.getElementById('sellAll');
  const total=inv.reduce((s,it)=>s+sellValue(it),0);
  const nEq=inv.filter(canSell).length;
  sb.disabled=!nEq;
  sb.innerHTML=nEq?`出售装备<br><span style="color:var(--gold);font-size:9px">${nEq}件 +${total}金</span>`:'出售<br>装备';
  inv.forEach((it,i)=>{
    const el=document.createElement('div');
    el.className='book';
    el.dataset.idx=i;
    if(it.t==='book'){
      const d=SKB[it.name];
      el.style.borderColor=QC[d.q];             // 边框=品质
      el.style.color=CATS[d.cat].color;         // 文字=属性系
      el.innerHTML=`${d.short}<small>技能书</small>`;
    }else{
      const d=eqDef(it),q=qOf(it);
      el.style.borderColor=q.c;
      el.style.color=q.c;
      el.innerHTML=`${d.s}<small>${q.n}</small>`;
    }
    invEl.appendChild(el);
  });
}
/* slot: 可选目标栏位 {sk:i} 或 {eq:i}，用于覆盖 */
function applyItem(idx,h,slot){
  const it=inv[idx];if(!it||!h)return;
  if(it.t==='book'){
    const names=Object.keys(h.skills);
    // 拖到已占用的技能栏 → 覆盖原技能
    if(slot&&slot.sk!=null&&slot.sk<names.length&&names[slot.sk]!==it.name){
      const old=names[slot.sk];
      delete h.skills[old];
      h.skills[it.name]=1;
      showToast(`已用 <b style="color:${CATS[SKB[it.name].cat].color}">${it.name}</b> 覆盖 ${old}`);
    }else{
      const cur=h.skills[it.name]||0;
      if(cur>=MAX_SKILL_LV){showToast(`${it.name} 已满级`);return;}
      if(!cur&&names.length>=MAX_SLOTS){showToast('技能位已满，拖到某个技能上可覆盖');return;}
      h.skills[it.name]=cur+1;
    }
    calc(h);
    fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.6,t:.4,max:.4,color:CATS[SKB[it.name].cat].color});
  }else{
    // 拖到已占用的装备栏 → 覆盖，旧装备退回背包
    if(slot&&slot.eq!=null&&slot.eq<h.equips.length){
      const old=h.equips[slot.eq];
      h.equips[slot.eq]=it;
      inv.splice(idx,1);inv.push(old);
      const ratio=h.hp/h.maxHp;calc(h);h.hp=Math.round(h.maxHp*ratio);
      showToast(`已替换装备，<b style="color:${qOf(old).c}">${eqDef(old).n}</b> 退回背包`);
      renderInv();if(selHero()===h)renderInfo();
      return;
    }
    if(h.equips.length>=MAX_EQUIP){showToast('装备位已满，拖到某件装备上可替换');return;}
    h.equips.push(it);
    const ratio=h.hp/h.maxHp;calc(h);h.hp=Math.round(h.maxHp*ratio);
    fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.6,t:.4,max:.4,color:qOf(it).c});
  }
  inv.splice(idx,1);
  renderInv();
  if(selHero()===h)renderInfo();
}
/* 拖拽：短按查看说明，拖到英雄上使用 */
let drag=null;
invEl.addEventListener('pointerdown',ev=>{
  const el=ev.target.closest('.book');if(!el)return;
  drag={idx:+el.dataset.idx,sx:ev.clientX,sy:ev.clientY,moved:false};
  ghost.innerHTML=el.outerHTML;
  ev.preventDefault();
});
window.addEventListener('pointermove',ev=>{
  if(!drag)return;
  if(Math.hypot(ev.clientX-drag.sx,ev.clientY-drag.sy)>10)drag.moved=true;
  if(drag.moved){
    ghost.style.display='block';
    ghost.style.left=(ev.clientX-20)+'px';
    ghost.style.top=(ev.clientY-46)+'px';
  }
});
window.addEventListener('pointerup',ev=>{
  if(!drag)return;
  ghost.style.display='none';
  const {idx,moved}=drag;drag=null;
  if(!moved){
    invSel=idx;closeShop();sel=null;renderInfo();
    return;
  }
  const it=inv[idx];if(!it)return;
  // 先看是否落在英雄面板的技能栏/装备栏上（覆盖）
  const under=document.elementFromPoint(ev.clientX,ev.clientY);
  const slotEl=under&&under.closest('[data-skslot],[data-eqslot]');
  const h=selHero();
  if(slotEl&&h){
    if(slotEl.dataset.skslot!=null&&it.t==='book'){applyItem(idx,h,{sk:+slotEl.dataset.skslot});return;}
    if(slotEl.dataset.eqslot!=null&&it.t==='eq'){applyItem(idx,h,{eq:+slotEl.dataset.eqslot});return;}
    showToast(it.t==='book'?'技能书要拖到技能栏':'装备要拖到装备栏');
    return;
  }
  // 否则落在战场英雄方块上
  const rect=cv.getBoundingClientRect();
  const c=Math.floor((ev.clientX-rect.left)/cell),r=Math.floor((ev.clientY-rect.top)/cell);
  if(c>=0&&c<HCOLS&&r>=0&&r<ROWS){
    const hh=heroAt(c,r);
    if(hh)applyItem(idx,hh);
    else showToast('拖到已购买的英雄方块上');
  }
});

let lastTap={t:0,key:''};
info.addEventListener('click',ev=>{
  // 点击技能栏/装备栏查看介绍；双击装备=脱下退回背包
  const s=ev.target.closest('[data-lps],[data-lpe]');
  if(s){
    const h=selHero();if(!h)return;
    if(s.dataset.lps){
      const n=s.dataset.lps,d=SKB[n];
      showToast(`<b style="color:${CATS[d.cat].color}">${n}</b> [${QN[d.q]}] Lv${h.skills[n]}<br>${d.desc}`);
    }else{
      const ei=+s.dataset.lpe,e=h.equips[ei];if(!e)return;
      const now=performance.now(),key='eq'+ei;
      if(now-lastTap.t<350&&lastTap.key===key){
        // 双击：脱下装备退回背包
        lastTap={t:0,key:''};
        h.equips.splice(ei,1);inv.push(e);
        const ratio=h.hp/h.maxHp;calc(h);h.hp=Math.round(h.maxHp*ratio);
        showToast(`已脱下 <b style="color:${qOf(e).c}">${eqDef(e).n}</b>，退回背包`);
        renderInv();renderInfo();
        return;
      }
      lastTap={t:now,key};
      const d=eqDef(e),q=qOf(e);showToast(`<b style="color:${q.c}">${d.n}</b> [${q.n}]<br>${eqDesc(d)} · 双击脱下`);
    }
    return;
  }
  const b=ev.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.pack){buyPack(b.dataset.pack);return;}
  if(b.dataset.eqroll){buyEquip(b.dataset.eqroll);return;}
  if(b.dataset.shop){
    const isMine=b.dataset.shop==='mine';
    const lv=isMine?mineLv:millLv;
    if(lv>=INCOME_MAX)return;
    const cost=isMine?mineCost(lv):millCost(lv);
    if(gold>=cost){gold-=cost;if(isMine)mineLv++;else millLv++;updateHUD();renderInfo();}
    return;
  }
});
cv.addEventListener('pointerdown',ev=>{
  if(!running)return;
  const rect=cv.getBoundingClientRect();
  const fx0=(ev.clientX-rect.left)/cell,fy0=(ev.clientY-rect.top)/cell;
  // 先判宝箱（精英试炼掉落，点击开启）
  for(const ch of chests){
    if(!ch.dead&&Math.hypot(ch.x-fx0,ch.y-fy0)<.5){openChest(ch);return;}
  }
  // 英雄会推进到战斗区，点身上也能选中（不只是点老家格子）
  for(const h of heroes){
    if(Math.abs(h.x-fx0)<.5&&Math.abs(h.row+.5-fy0)<.5){
      sel={col:h.col,row:h.row};invSel=null;advPick=false;closeShop();renderInfo();return;
    }
  }
  const c=Math.floor(fx0),r=Math.floor(fy0);
  if(c<0||c>=COLS||r<0||r>=ROWS)return;
  sel=c<HCOLS?{col:c,row:r}:null;
  invSel=null;advPick=false;
  if(sel)closeShop();
  renderInfo();
});
document.getElementById('launchBtn').addEventListener('click',ev=>{
  if(started)return;
  started=true;
  ev.currentTarget.style.display='none';
  startWave();waveT=WAVE_EVERY;
  renderInfo();
});
document.getElementById('speedBtn').addEventListener('click',ev=>{
  speed=speed===1?2:1;
  ev.currentTarget.textContent='×'+speed;
  ev.currentTarget.classList.toggle('on',speed===2);
});
document.getElementById('startBtn').addEventListener('click',begin);

/* ================= 主循环 ================= */
let last=performance.now();
function loop(now){
  const dt=Math.min((now-last)/1000,.05);last=now;
  gt+=dt;
  if(running&&!over)update(dt*speed);
  draw();
  requestAnimationFrame(loop);
}
reset();resize();
requestAnimationFrame(loop);
