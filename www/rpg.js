'use strict';
/* ================= 职业（魔兽式属性）================= */
const ROWS=5, HCOLS=3, BCOLS=17, COLS=HCOLS+BCOLS, TOTAL_WAVES=25, HERO_COST=50, MAX_HEROES=3;
/* 出兵区仍是 3 列×3 行，纵向居中（第1~3行）；上下两行只有怪，靠英雄横移/射程去拦 */
const HROWS=3, ROW0=(ROWS-HROWS)>>1;
const MAX_SLOTS=4, MAX_SKILL_LV=10, MAX_EQUIP=6, MAX_HERO_LV=15;   // 装备栏2×3
const COL_CLASS=['mage','archer','warrior'];
/* bat=基础攻击间隔s wep=武器基础攻击 main=主属性(加攻) grow=每级属性成长 */
const CLASSES={
  // ⚠️ splash 全部为 0：**平A一律单体**（用户明确要求），只有学了「攻击溅射」技能才溅射
  mage:  {name:'法师',color:'#4f8dff',hpB:60,wep:6, bat:1.6,baseArmor:1,range:4.5,splash:0,  main:'int',
          attr:{str:8, agi:12,int:24},grow:{str:1.1,agi:1.4,int:3.2},desc:'远程溅射·主智力'},
  archer:{name:'游侠',color:'#57d474',hpB:70,wep:8, bat:1.4,baseArmor:2,range:6,  splash:0,  main:'agi',
          attr:{str:10,agi:22,int:12},grow:{str:1.4,agi:2.9,int:1.5},desc:'中程速射·主敏捷'},
  warrior:{name:'战士',color:'#ff5d5d',hpB:90,wep:15,bat:1.5,baseArmor:8,range:1.15,splash:0, main:'str',
          attr:{str:22,agi:10,int:8}, grow:{str:2.7,agi:1.3,int:1.0},desc:'近战坦克·主力量'},
};
/* 转职分支：**每职业3条路线**，各带1个专精天赋（专精用金+木升级，上限Lv10） */
const ADV={
  warrior:[
    {key:'berserker',name:'狂战士',atk:1.6, hp:1.5, bat:.9, range:.25,splash:0},
    {key:'guard',    name:'护卫',  atk:1.3, hp:1.9, bat:.95,range:.2, splash:0},
    {key:'bandit',   name:'强盗',  atk:1.45,hp:1.35,bat:.88,range:.25,splash:0},
  ],
  archer:[
    {key:'musket',name:'火枪兵',  atk:1.5,hp:1.3, bat:.95,range:1.5,splash:0},
    {key:'elf',   name:'精灵游侠',atk:1.4,hp:1.3, bat:.85,range:1.5,splash:0},
    {key:'xbow',  name:'弩手',    atk:1.6,hp:1.35,bat:1,  range:1.8,splash:0},
  ],
  mage:[
    {key:'summoner',name:'召唤师',atk:1.35,hp:1.45,bat:1,range:1,  splash:0},
    {key:'priest',  name:'牧师',  atk:1.4, hp:1.5, bat:1,range:1,  splash:0},
    {key:'archmage',name:'大法师',atk:1.5, hp:1.35,bat:1,range:1.2,splash:0},
  ],
};
const SPECS={
  berserker:{n:'血怒',    d:lv=>`失血越多输出越高：攻击+失血比×${15+10*lv}%，攻速+失血比×${30+15*lv}点`},
  guard:    {n:'护甲光环',d:lv=>`3格内友方英雄+${5+lv}护甲，自己+${(5+lv)*2}（不叠加取最高）`},
  bandit:   {n:'掠夺',    d:lv=>`每次普攻偷取 ${30+5*lv} 金币`},
  musket:   {n:'精准射击',d:lv=>`弹道瞬发（无飞行时间）；普攻附加 敏×${(0.15+0.05*lv).toFixed(2)} 魔法伤害`},
  elf:      {n:'迅捷',    d:lv=>`攻击间隔额外-${(0.1+0.01*lv).toFixed(2)}s`},
  xbow:     {n:'重弩',    d:lv=>`攻击间隔+0.2s；攻击力与最终伤害各提升「攻击间隔×75% + ${5*lv}%」`},
  summoner: {n:'召唤精通',d:lv=>`召唤物属性+${20+2*lv}%`},
  priest:   {n:'治愈祷言',d:lv=>`主动(30蓝,CD2s)：回复全体英雄 智×${(0.5*lv).toFixed(1)} 生命`},
  archmage: {n:'奥术专精',d:lv=>`技能CD-${10+2*lv}%`},
};
function advOf(h){return h.tier?ADV[h.cls][h.branch]:null;}
function specCost(lv){return {g:60+40*(lv-1),w:40+25*(lv-1)};}   // 专精升级费用（当前级→下一级）
const SPEC_MAX=10;
const ADV_LV=5, ADV_GOLD=400, ADV_WOOD=250;
/* 英雄递增定价：第1个免费(开局卡片选)、第2个100、第3个200 */
const HERO_COSTS=[0,100,200];   // 开局送1个，之后100/200
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
  '主属光环':  {cat:'str',q:'qpurple',short:'主属',cd:0, desc:'被动光环：3格内的友方英雄（含自己）各获得 20×等级 点自身主属性（多个光环不叠加，取最高）'},
  '忍受':      {cat:'str',q:'qblue',  short:'忍受',cd:18,mana:20,desc:'主动(20蓝)：进入忍受状态，持续(3+等级)秒，期间受到的伤害减少(20+3×等级)%（与其它减伤相乘），附近有敌人时自动开启'},
  '多重射击':  {cat:'agi',q:'qblue',  short:'多重',cd:0, desc:'被动：普攻额外射击 等级×0.5 个敌人（70%伤害）'},
  '沁毒射击':  {cat:'agi',q:'qgreen', short:'沁毒',cd:0, desc:'被动：普攻附带毒伤=敏捷×(0.35+0.15×等级)（魔法伤害）'},
  '剑雨':      {cat:'agi',q:'qgreen', short:'剑雨',cd:8, mana:25,desc:'主动(25蓝)：天降剑雨，对半径2格内所有敌人造成(20+敏捷×0.5×等级)魔法伤害'},
  '狙击潜质':  {cat:'agi',q:'qpurple',short:'狙击',cd:0, desc:'被动：射程+0.3格×等级（同时加长主动技能释放距离）'},
  '致命一击':  {cat:'agi',q:'qpurple',short:'致命',cd:0, desc:'被动：(15+5×等级)%几率暴击，造成(140+10×等级)%伤害，金色飘字'},
  '召唤熊德':  {cat:'int',q:'qblue',  short:'熊德',cd:22,mana:50,desc:'主动(50蓝)：召近战熊灵冲锋接敌，属性随智力成长'},
  '火元素':    {cat:'int',q:'qgreen', short:'火元素',cd:16,mana:30,desc:'主动(30蓝)：召唤1只火元素，远程(2.6格)喷火，每1.2秒造成(7+智×0.5×等级)魔法伤害，HP=70+智×3×等级，持续(10+1.5×等级)秒'},
  '水元素':    {cat:'int',q:'qblue',  short:'水元素',cd:20,mana:40,desc:'主动(40蓝)：召唤2只水元素近战肉盾，各每1.1秒造成(6+智×0.42×等级)物理伤害，各HP=90+智×4×等级，持续(12+2×等级)秒'},
  '地狱火':    {cat:'int',q:'qpurple',short:'地狱火',cd:30,mana:60,desc:'主动(60蓝)：召唤1只地狱火，每1.4秒造成(16+智×1.1×等级)单体物理伤害，HP=220+智×9×等级，持续(15+2×等级)秒'},
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
/* 技能书走金币（2026-07 用户确认：只是涨价，货币还是金）；装备 roll 才同时吃金+木。 */
/* ⚠️ 2026-07 用户定的分工：**roll（技能书/装备）只花木头，购买（学技能/穿装备）只花金币**。 */
const PACK_COST=200, ROLL_COST=100, PACK_N=4;   // 单位=木头
/* 技能书学习费：roll只出书，真正学到英雄身上时按品质付**金币**（每升一档品质翻倍） */
const BOOK_COST={qgreen:150,qblue:300,qpurple:600,qgold:1000};   // 单位=金币
function bookCost(name){return BOOK_COST[SKB[name].q]||0;}
/* 出售：只有装备能卖，技能书不能卖；返还压低到roll成本的40~60% */
const SELL_EQ={common:8,fine:18,rare:40,epic:80,legend:200};
/* 装备穿上时按品质付费（和技能书的学习费一个思路：roll只是出货，装备要另付钱） */
const EQUIP_COST={common:50,fine:120,rare:200,epic:600,legend:1000};   // 单位=金币
/* 已经付过装备费的（存过熔炉的）不再收费，也不再标价 */
function equipCost(it){return it.paid?0:(EQUIP_COST[eqDef(it).q]||0);}
function canSell(it){return it.t==='eq';}
function sellValue(it){return canSell(it)?(SELL_EQ[eqDef(it).q]||8):0;}

/* ================= 装备池（2026-07 整池重做）=================
   ⚠️ 唯一特效规则（用户定的）：**同名装备的特殊特效只生效一件**，
   不同名字之间照常叠加。代码在 calc() 里用 seen 集合去重：
   普通属性（攻击/三围/攻速/暴击/护甲…）永远求和，
   只有 bat(攻击间隔) / sunder(削甲) / range(射程) / proc(特殊触发) 这四类按 id 去重。
   —— 所以两把满月只减一次间隔，但 满月+柳月弓+幻烁之舞 三件是叠加的。 */
const QUALS={
  common:{n:'白色',c:'#c8d2dc',w:50},
  fine:  {n:'绿色',c:'#5ad48a',w:35},
  rare:  {n:'蓝色',c:'#4fa8ff',w:15},
  epic:  {n:'紫色',c:'#b070ff',w:0},   // 预留
  legend:{n:'金色',c:'#f0a63c',w:0},   // 金色：只从宝箱掉，商店roll不出
};
/* 特殊触发效果（proc）：一件装备最多挂一个，说明文字给 eqDesc 用 */
const PROCS={
  gold:   '平A获得5金币',
  thunder:'平A附带(力+敏+智)魔法伤害',
  storm:  '击杀敌人+30攻速持续3秒，继续击杀刷新',
  blood:  '每次平A+5攻击+1%吸血，最多25层(每波重置)',
  black:  '平A永久削目标10%最大生命+40护甲',
  echo:   '每2秒一次：下一次平A打两下',
  curse:  '施放技能后3秒内冷却速度+20%',
  sheep:  '每次平A+10攻速，最多10层(每波重置)',
  silence:'沉默自己：无法施放主动技能',
  titan:  '每次受伤+10攻击/+2护甲/+1%魔抗/+2%体型，最多50层(每波重置)',
};
const EQUIPS=[
  /* ---------- 白色 ---------- */
  {id:'doransword', n:'多兰剑',    s:'多兰',q:'common',stats:{str:5,atk:10}},
  {id:'doranshield',n:'多兰盾',    s:'兰盾',q:'common',stats:{flat:10}},
  {id:'doranring',  n:'多兰戒',    s:'兰戒',q:'common',stats:{mpre:1}},
  {id:'kill1',      n:'杀人剑',    s:'杀剑',q:'common',stats:{atk:15},evo:'kill2',evoN:20},   // 进化门槛递增 20/50/100/200
  {id:'twig',       n:'小树枝',    s:'小枝',q:'common',stats:{all:5},craft:{to:'bigtwig',n:6}},
  {id:'banditblade',n:'强盗之刃',  s:'强盗',q:'common',stats:{},proc:'gold'},
  {id:'shortdagger',n:'短刀',      s:'短刀',q:'common',stats:{aspd:10}},
  /* ---------- 绿色 ---------- */
  {id:'rustblade',  n:'锈蚀之刃',  s:'锈蚀',q:'fine',stats:{atk:20,sunder:5}},
  {id:'stormsword', n:'暴风之剑',  s:'暴剑',q:'fine',stats:{atk:40}},
  {id:'winddagger', n:'唤风之匕',  s:'唤风',q:'fine',stats:{agi:10,aspd:20}},
  {id:'thunderhorn',n:'雷霆号角',  s:'雷号',q:'fine',stats:{int:15,summon:.1}},
  {id:'heavyhammer',n:'重锤',      s:'重锤',q:'fine',stats:{str:20}},
  {id:'silverdagger',n:'银质匕首', s:'银匕',q:'fine',stats:{crit:10,atk:10}},
  {id:'smallshield',n:'小圆盾',    s:'圆盾',q:'fine',stats:{block:20,armor:5}},
  /* ---------- 蓝色 ---------- */
  {id:'gloomblade', n:'幽冥之刃',  s:'幽冥',q:'rare',stats:{atk:40,sunder:15}},
  {id:'willowbow',  n:'柳月弓',    s:'柳月',q:'rare',stats:{bat:.1,aspd:20}},
  {id:'forbidden',  n:'禁制匕首',  s:'禁制',q:'rare',stats:{atk:75,aspd:40},proc:'silence'},
  {id:'siriusblade',n:'天狼刀',    s:'天狼',q:'rare',stats:{str:30}},
  {id:'abysstalis', n:'幽邃护符',  s:'幽符',q:'rare',stats:{cdr:.15,int:15}},
  {id:'holypend',   n:'圣洁吊坠',  s:'圣坠',q:'rare',stats:{heal:20,int:20}},
  {id:'abyssstaff', n:'幽邃法杖',  s:'幽杖',q:'rare',stats:{int:20,summon:.1}},
  {id:'manapend',   n:'法力吊坠',  s:'法坠',q:'rare',stats:{mpre:5,all:10}},
  {id:'phantom',    n:'幻烁之舞',  s:'幻烁',q:'rare',stats:{bat:.15,agi:10}},
  {id:'lovebow',    n:'博爱之弩',  s:'博爱',q:'rare',stats:{bat:-.2,atk:30}},
  {id:'darkeye',    n:'漆黑之眼',  s:'黑眼',q:'rare',stats:{atk:50,crit:20}},
  {id:'watcher',    n:'守望者铠甲',s:'守望',q:'rare',stats:{armor:20,flat:50}},
  {id:'birdcirclet',n:'森鸟头环',  s:'森鸟',q:'rare',stats:{agi:30}},
  {id:'abyssring',  n:'幽邃耳环',  s:'幽环',q:'rare',stats:{int:30}},
  {id:'bigtwig',    n:'大树枝',    s:'大枝',q:'rare',stats:{all:30},craft:{to:'cenarius',n:6}},
  /* ---------- 紫色 ---------- */
  {id:'thunderedict',n:'雷霆领主的法令',s:'法令',q:'epic',stats:{},proc:'thunder'},
  {id:'stormrider', n:'风暴骑手的狂涌',s:'狂涌',q:'epic',stats:{agi:30,aspd:30},proc:'storm'},
  {id:'warlord',    n:'战争领主的嗜血',s:'嗜血',q:'epic',stats:{all:15},proc:'blood'},
  {id:'fullmoon',   n:'满月',      s:'满月',q:'epic',stats:{atk:80,aspd:40,bat:.2}},
  {id:'blackblade', n:'黑刀',      s:'黑刀',q:'epic',stats:{atk:100},proc:'black'},
  {id:'bladethorn', n:'刃刺',      s:'刃刺',q:'epic',stats:{atk:100,crit:25,str:20,agi:20}},
  {id:'echoblade',  n:'回响之刃',  s:'回响',q:'epic',stats:{str:50,aspd:50},proc:'echo'},
  {id:'goblinhorn', n:'哥布林号角',s:'哥号',q:'epic',stats:{summon:.6,cdr:.15}},
  {id:'poorshield', n:'穷鬼盾',    s:'穷盾',q:'epic',stats:{blockP:20,armor:20,flat:20}},
  {id:'abysscurse', n:'幽邃圣主的诅咒',s:'诅咒',q:'epic',stats:{int:50,cdr:.25},proc:'curse'},
  {id:'infinity',   n:'无尽之刃',  s:'无尽',q:'epic',stats:{atk:60,crit:20,cdmg:40}},
  {id:'sheepstick', n:'羊刀',      s:'羊刀',q:'epic',stats:{all:25},proc:'sheep'},
  {id:'dragonlance',n:'魔龙枪',    s:'龙枪',q:'epic',stats:{agi:25,range:1.5}},
  /* ---------- 金色：商店roll不出，只从宝箱开 ---------- */
  {id:'godslayer',n:'弑神炮',        s:'弑神',q:'legend',pool:'gold',stats:{atk:200,crit:35,cdmg:50,range:2}},
  {id:'cenarius', n:'塞纳留斯的号角',s:'号角',q:'legend',pool:'gold',stats:{all:100,summon:1,cdr:.2}},
  {id:'titan',    n:'泰坦的坚决',    s:'泰坦',q:'legend',pool:'gold',stats:{armor:20,mres:.2},proc:'titan'},
  /* ---------- 杀人剑的进化形态：pool:'evo' → 商店/宝箱都不会直接出 ---------- */
  {id:'kill2',n:'杀人剑',s:'杀剑',q:'fine',  pool:'evo',stats:{atk:35,aspd:10},         evo:'kill3',evoN:50},
  {id:'kill3',n:'杀人剑',s:'杀剑',q:'rare',  pool:'evo',stats:{atk:70,aspd:25},         evo:'kill4',evoN:100},
  {id:'kill4',n:'杀人剑',s:'杀剑',q:'epic',  pool:'evo',stats:{atk:100,crit:20,aspd:40},evo:'kill5',evoN:200},
  {id:'kill5',n:'杀人剑',s:'杀剑',q:'legend',pool:'evo',stats:{atk:250,crit:25,aspd:80}},
];
const GOLD_DROP=.15;   // 宝箱里开出金色装备的概率
const EQ_BY_ID=Object.fromEntries(EQUIPS.map(e=>[e.id,e]));
/* 装备商店四档roll：每次固定4件，越贵越容易出高品质。
   ⚠️ 2026-07 用户加的规则：**每一档都要同时花金币和木头**（木头=金币，1:1），
   顶级档 800金+800木 不出白，且是**唯一能roll出金色的地方**（10%）——
   前三档仍然 roll 不出金色，宝箱那条路（GOLD_DROP）也照旧。 */
const EQ_TIERS={
  low: {n:'低级roll',wood:200, w:{common:60,fine:30,rare:9, epic:1}},
  mid: {n:'中级roll',wood:400, w:{common:30,fine:40,rare:24,epic:6}},
  high:{n:'高级roll',wood:800, w:{common:5, fine:30,rare:45,epic:20}},
  top: {n:'顶级roll',wood:1600,w:{common:0, fine:5,  rare:30,epic:55,legend:10}},
};
function rollEquip(tier){
  const w=EQ_TIERS[tier].w;
  let r=Math.random()*100,qk='common';
  for(const k of ['common','fine','rare','epic','legend']){if(r<(w[k]||0)){qk=k;break;}r-=w[k]||0;}
  // 金色不带 pool:'gold' 就永远roll不到；其余品质仍然只roll商店池（排除 gold/evo）
  const pool=EQUIPS.filter(e=>e.q===qk&&(qk==='legend'?e.pool==='gold':!e.pool));
  return {t:'eq',id:pool[Math.floor(Math.random()*pool.length)].id};
}
function eqDef(item){return EQ_BY_ID[item.id];}
function qOf(item){return QUALS[eqDef(item).q];}
function eqDesc(def,it){
  const s=def.stats,p=[];
  if(s.atk)p.push('攻击+'+s.atk);
  if(s.all)p.push('全属性+'+s.all);
  if(s.str)p.push('力量+'+s.str);
  if(s.agi)p.push('敏捷+'+s.agi);
  if(s.int)p.push('智力+'+s.int);
  if(s.aspd)p.push('攻速+'+s.aspd);
  if(s.bat>0)p.push('攻击间隔-'+s.bat+'(唯一)');
  if(s.bat<0)p.push('攻击间隔+'+(-s.bat)+'(唯一)');
  if(s.crit)p.push('暴击率+'+s.crit+'%');
  if(s.cdmg)p.push('暴击伤害+'+s.cdmg+'%');
  if(s.armor)p.push('护甲+'+s.armor);
  if(s.mres)p.push('魔抗+'+Math.round(s.mres*100)+'%');
  if(s.hp)p.push('生命+'+s.hp);
  if(s.block)p.push('格挡普攻'+s.block);
  if(s.blockP)p.push('受到普攻伤害-'+s.blockP+'%');
  if(s.flat)p.push('固定减伤'+s.flat);
  if(s.mpre)p.push('回蓝+'+s.mpre+'/s');
  if(s.cdr)p.push('技能CD-'+Math.round(s.cdr*100)+'%');
  if(s.summon)p.push('召唤强度+'+Math.round(s.summon*100)+'%');
  if(s.heal)p.push('治疗强度+'+s.heal+'%');
  if(s.range)p.push('射程+'+s.range+'格(唯一)');
  if(s.sunder)p.push('平A削'+s.sunder+'护甲(唯一)');
  if(def.proc)p.push(PROCS[def.proc]+'(唯一)');
  if(def.craft)p.push(def.craft.n+'个合成 '+EQ_BY_ID[def.craft.to].n);
  if(def.evo)p.push('击杀'+(it?((it.kills||0)+'/'):'')+def.evoN+'进化');
  return p.join(' · ');
}
/* ================= 怪物（带护甲/魔抗）================= */
const MOBS={
  // atkR=攻击距离（都小于战士射程1.15，保证近战能还手）
  /* ⚠️ 2026-07 用户定的两条：
     ① 移速全部 1.3（和英雄统一），**多样化不许靠移速**；
     ② 小怪整体要肉。所以四种小怪靠 射程/伤害/护甲/血量 区分：
        步兵=均衡  长矛兵=手长(atkR 1.5，超出战士射程1.15，会先白打一下)
        狂徒=高伤脆皮(攻×3)  重甲兵=高甲高抗 */
  // ⚠️ 这四种的血**试过再×5**（350/300/275/1200），用户实测「打不过」当场回退。别再往上翻倍。
  normal:{hp:105,spd:1.3,atk:6, reward:8, xp:5, r:.30,lives:1,armor:2, mres:0,  atkR:.62,color:'#c95bff'},
  lancer:{hp:90, spd:1.3,atk:7, reward:9, xp:6, r:.27,lives:1,armor:0, mres:0,  atkR:1.5, color:'#ff9d4d'},
  brute: {hp:80, spd:1.3,atk:17,reward:11,xp:8, r:.29,lives:1,armor:0, mres:0,  atkR:.5, color:'#e04c4c'},
  tank:  {hp:360,spd:1.3,atk:10,reward:16,xp:12,r:.38,lives:2,armor:14,mres:.3, atkR:.85,color:'#8a6bff'},
  boss:  {hp:700,spd:1.3,atk:30,reward:70,xp:60,r:.47,lives:3,armor:10,mres:.3, atkR:1.05,color:'#ff3860'},
};
/* ---- 金矿 / 伐木场：产出 = 工人数 × 等级（每秒）。等级上限10、工人上限5 ----
   平衡推导：升级和招人是互相放大的（P=W×L），所以只比"边际收益/花费"：
     招人更划算 ⇔ L/Cw(W) > W/Cl(L)。两边都取线性 Cl=a·L、Cw=b·W 时，
     条件化简成 L > W·√(b/a) —— 也就是 √(b/a) 决定这栋楼的"性格"。
   · 金矿 = 平衡型：b/a=250/60≈4，√=2 → 交叉点 L=2W，正好对上 10级/5人 的上限比，
            所以从头到尾等级和工人是交替买的，每一步都要重新算，真的有得选。
   · 伐木场 = 人海型：b/a=110/150，√≈0.86 → 交叉点 L=0.86W，几乎永远先招满 5 个工人。
   满配：金矿 5人×Lv10=50金/s（升级2700+工人2500=5200金）
        伐木场 5人×Lv10=50木/s（升级6750+工人1100=7850金） */
const INCOME_MAX=10, WORKER_MAX=5;
function mineCost(lv){return 60*lv;}            // 金矿升级：60/120/…/540（共2700）
function millCost(lv){return 60*lv;}            // 伐木场升级：和金矿同步（用户要求），60/120/…/540
function mineWkCost(w){return 250*w;}           // 金矿招工人：250/500/750/1000（共2500）
function millWkCost(w){return 250*w;}           // 伐木场招工人：和金矿同步，250/500/750/1000
/* 波次节奏：出怪后不限时（只记录战斗用时），清场后进入 REST_TIME 秒备战，倒计时结束才出下一波 */
const REST_TIME=25;
/* 整波入场的阵型（按波轮换）：雁形/锋矢/横阵/斜阵/方阵 */
const FORMS=['goose','wedge','line','echelon','block'];
/* 波次类型：逢5(5/15/25)=精英波，逢10(10/20)=Boss关（只有Boss、数值额外拔高） */
const BOSS_WAVE_MUL=3.0, ELITE_RS=1.2;
/* Boss关的Boss：数值×BOSS_WAVE_MUL 之外，**血量再单独 ×BOSS_HP_MUL**（只加血不加伤害） */
const BOSS_HP_MUL=3.0;
function isBossWave(w){return w%10===0;}
function isEliteWave(w){return w%10===5;}
/* 怪物AI：进仇恨半径就直接扑向最近的英雄/召唤物，进攻击范围(MOBS.atkR)停下开打 */
const MS_EXTRA=.5;   // 多重射击：次级目标的检索范围比主目标多这么多格
const AGGRO_R=4.6;   // 仇恨半径：进这个圈就扑向英雄。5行后调大过，否则上下两行的怪来不及被吸引
/* 召唤物不再有活动上限：召出来就一路向右压，波次结束随波消散 */
/* 开波后英雄从左往右推进的速度（格/秒），清场后按1.8倍走回本阵 */
const HERO_SPD=1.3;   // 和怪物统一（用户指定），召唤物也跟着这个值
/* ===== 召唤物（bears 数组统一管理，kind 决定属性/外观）=====
   hp/atk = 基础 + 智力×系数×技能等级；rng=攻击距离 ivl=攻击间隔 splash=溅射半径
   ⚠️ spd 统一 = HERO_SPD：召唤物不能比英雄跑得快（原来 1.4~1.8，会一路冲到最前面送死） */
const MINIONS={
  bear:    {name:'熊灵',  n:1,r:.28,spd:HERO_SPD,rng:.8, ivl:1,  hpB:120,hpI:6,  atkB:8, atkI:.7, dur:l=>12+2*l,   mag:false,splash:0,  color:'#c9a068'},
  fire:    {name:'火元素',n:1,r:.26,spd:HERO_SPD,rng:2.6,ivl:1.2,hpB:70, hpI:3,  atkB:7, atkI:.5, dur:l=>10+1.5*l, mag:true, splash:0,  color:'#ff7a2f'},
  water:   {name:'水元素',n:2,r:.26,spd:HERO_SPD,rng:.85,ivl:1.1,hpB:90, hpI:4,  atkB:6, atkI:.42,dur:l=>12+2*l,   mag:false,splash:0,  color:'#4fc3ff'},
  infernal:{name:'地狱火',n:1,r:.38,spd:HERO_SPD,rng:1,  ivl:1.4,hpB:220,hpI:9,  atkB:16,atkI:1.1,dur:l=>15+2*l,   mag:false,splash:0,  color:'#ff4d3d'},
};

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
let gold,wood,lives,wave,queue,spawnT,incomeT,waveT,battleT,resting,cleared,hudAcc;
let mineLv,millLv,mineW,millW;                  // 等级 / 工人数
/* 右上角三个自动开关（跨局保留，不在 reset 里清） */
let autoLearnAll=false,autoTrial=false,autoNext=false,autoTrialT=0;
let heroes,mobs,shots,fx,nums,bears,inv,hails,storms,quakes,chests,trialCd;
let sel=null,invSel=null,speed=1,running=false,started=false,over=false,openShop=null;
/* 尸体：怪死后不是瞬间消失，留半秒往后仰倒并沉进地里（纯表现，渲染层读它） */
let corpses=[];
/* 当前伤害来源英雄。damage()/magDamage() 会读它来 ① 累计伤害统计 ② 吃法术强度。
   在英雄循环、召唤物循环、弹道结算、AOE 结算前后各设一次；用完置回 null。 */
let SRC=null;
/* 熔炉：信息区右边的装备暂存架。只收装备（技能书不收，免得绕过"买新书清旧书"的规则），
   不参与"出售装备"和树枝合成——所以它的用途就是「把好装备存起来别被卖掉/别占背包」。 */
const FORGE_MAX=8;
let forge=[];
const forgeBtn=document.getElementById('cardForge');
const ANIM_T=.22;   // 攻击动作时长（rpg3d.js 的挥砍/拉弓动作用它算进度）
/* 各转职支线的攻击节奏（渲染层按 h.animT 算动作进度）：
   弩手慢而重、精灵游侠快、火枪/强盗短促、狂战士双斧稍长 */
const ANIM_BR={xbow:.44,elf:.12,musket:.17,bandit:.15,berserker:.28};
function animT(h){const a=h.tier?ADV[h.cls][h.branch]:null;return (a&&ANIM_BR[a.key])||ANIM_T;}
let gt=0;           // 全局时间（呼吸/脉动/走路相位）

/* ================= 画布 =================
   渲染全部交给 rpg3d.js（Three.js 俯视 3D），这里只管尺寸与拾取。
   格子坐标 → 世界坐标由 R3 负责，逻辑层不用关心。 */
const cv=document.getElementById('cv');
function resize(){R3.resize();}
window.addEventListener('resize',()=>setTimeout(resize,60));

/* ================= 英雄 ================= */
function makeHero(cls,row,col){
  const h={cls,row,col,x:col+.5,lv:1,xp:0,tier:0,branch:-1,specLv:1,autoLearn:autoLearnAll,
    soulInt:0,deathAgi:0,equips:[],
    skills:{},cds:{},cd:0,flash:0,anim:0,endT:0,endF:0,titanS:0,dmgOut:0,dmgTaken:0,
    bloodS:0,sheepS:0,stormT:0,echoCd:0,curseT:0,alive:true};
  calc(h);h.hp=h.maxHp;
  return h;
}
function calc(h){
  const b=CLASSES[h.cls],a=advOf(h);
  const am=h.tier?1.35:1;
  const sp=h.specLv||0,key=a?a.key:'';
  let eqAtk=0,eqArmor=0,eqHp=0,eqAspd=0,eqStr=0,eqAgi=0,eqInt=0,eqMres=0,eqCdr=0,eqBat=0,eqBlock=0,eqMpre=0,eqRange=0;
  let eqCrit=0,eqSunder=0,eqSummon=0,eqCdmg=0,eqHeal=0,eqFlat=0,eqBlockP=0;
  /* 唯一特效 = 同名只生效一件：普通属性照常求和，
     bat/sunder/range/proc 这四类只算每个 id 的第一件（见装备池顶上的注释） */
  const seen=new Set(),proc={};
  for(const e of h.equips){
    const d=eqDef(e),s=d.stats;
    eqAtk+=s.atk||0;eqArmor+=s.armor||0;eqHp+=s.hp||0;eqAspd+=s.aspd||0;
    eqStr+=(s.str||0)+(s.all||0);eqAgi+=(s.agi||0)+(s.all||0);eqInt+=(s.int||0)+(s.all||0);
    eqMres+=s.mres||0;eqCdr+=s.cdr||0;eqBlock+=s.block||0;eqMpre+=s.mpre||0;eqFlat+=s.flat||0;
    eqBlockP+=s.blockP||0;
    eqCrit+=s.crit||0;eqSummon+=s.summon||0;eqCdmg+=s.cdmg||0;eqHeal+=s.heal||0;
    if(seen.has(d.id))continue;                // ↓↓ 唯一特效：同名装备只算第一件
    seen.add(d.id);
    eqBat+=s.bat||0;eqSunder+=s.sunder||0;eqRange+=s.range||0;
    if(d.proc)proc[d.proc]=1;
  }
  h.procs=proc;
  // 装备加的力/敏一样吃派生；魂吸智力/死神收割敏捷是击杀累积
  // 主属光环：3格内友方英雄（含自己）提供 20×等级 点各自主属性，不叠加取最高
  let aura=0;
  for(const o of heroes){
    const lv=o.skills&&o.skills['主属光环'];
    if(!lv||!o.alive)continue;
    if(o!==h&&Math.hypot((o.x||0)-(h.x||0),o.row-h.row)>3)continue;
    aura=Math.max(aura,20*lv);
  }
  h.aura=aura;
  const ts=h.titanS||0;   // 泰坦的坚决层数
  h.str=Math.round((b.attr.str+b.grow.str*(h.lv-1))*am)+eqStr+(b.main==='str'?aura:0);
  h.agi=Math.round((b.attr.agi+b.grow.agi*(h.lv-1))*am)+eqAgi+Math.round(h.deathAgi||0)+(b.main==='agi'?aura:0);
  h.int=Math.round((b.attr.int+b.grow.int*(h.lv-1))*am)+eqInt+Math.round(h.soulInt||0)+(b.main==='int'?aura:0);
  h.atk=Math.round(b.wep*(a?a.atk:1)+h[b.main]+eqAtk+ts*10+(h.bloodS||0)*5);
  h.maxHp=Math.round((b.hpB+h.str*8)*(a?a.hp:1)+eqHp);
  // 护卫专精·护甲光环：3格内友方英雄 +5+lv 甲，护卫自己双倍（不叠加取最高）
  let armAura=0;
  for(const o of heroes){
    if(!o.alive||!o.tier||advOf(o).key!=='guard')continue;
    if(o!==h&&Math.hypot((o.x||0)-(h.x||0),o.row-h.row)>3)continue;
    armAura=Math.max(armAura,(5+(o.specLv||1))*(o===h?2:1));
  }
  h.armor=Math.round((b.baseArmor+h.agi/7+eqArmor+ts*2+armAura)*10)/10;
  h.mres=Math.min(.75,.25+eqMres+ts*.01);
  // 魔兽/DotA公式：每秒攻击=(1+攻速/100)/BAT；1敏=1攻速；上限400⇒最多5/BAT次每秒
  // 精灵游侠专精：迅捷额外降BAT
  const bat=Math.max(.35,b.bat*(a?a.bat:1)-eqBat-(key==='elf'?.1+.01*sp:0));
  h.bat=Math.round(bat*100)/100;   // 基础攻击间隔(BAT)：只含职业/转职/装备/迅捷，不含攻速
  /* 弩手·重弩：间隔+0.2s，换来「攻击间隔×75% + 5%×等级」的攻击力和最终伤害加成 */
  h.dmgMul=1;
  if(key==='xbow'){
    h.bat=Math.round((h.bat+.2)*100)/100;
    const r=h.bat*.75+.05*sp;
    h.atk=Math.round(h.atk*(1+r));h.dmgMul=1+r;
  }
  // ⚠️ 用户 2026-07 定：**1敏 = 0.1 攻速点**（原来是 1:1），让装备上的攻速真正值钱
  h.ias=Math.min(400,h.agi*.1+eqAspd+(h.stormT>0?30:0)+(h.sheepS||0)*10);
  h.interval=h.bat/(1+h.ias/100);
  h.cdr=Math.min(.5,eqCdr+.04*(h.skills['CD光环']||0)+(key==='archmage'?(10+2*sp)/100:0));
  h.block=eqBlock;h.flat=eqFlat;   // block=固定格挡(只挡普攻)，flat=固定减免；当前怪只有普攻，两者效果相同
  h.blockP=Math.min(.8,eqBlockP/100);   // 穷鬼盾：普攻伤害百分比减免（上限80%）
  h.critAdd=eqCrit/100;      // 装备额外暴击率
  h.critDmg=eqCdmg/100;      // 装备额外暴击伤害
  h.healP=1+eqHeal/100;      // 治疗强度（牧师祷言吃这个）
  h.sunder=eqSunder;         // 锈蚀之刃/幽冥之刃：普攻削甲（同名唯一，异名叠加）
  h.sumB=1+eqSummon;         // 召唤物强度倍率
  h.titan=!!proc.titan;      // 泰坦的坚决：受伤叠层
  h.silenced=!!proc.silence; // 禁制匕首：沉默携带者
  h.lifesteal=proc.blood?(h.bloodS||0)*.01:0;   // 战争领主的嗜血
  h.sizeMul=1+ts*.02;        // 体型随层数变大
  h.range=b.range+(a?a.range:0)+.3*(h.skills['狙击潜质']||0)+eqRange;
  h.splash=b.splash+(a?a.splash:0);
  h.maxMp=10+h.int*3;
  h.hpRegen=h.str*.3;                  // 1力 = 0.3 生命回复/s（用户 2026-07 加，英雄原本完全不回血）
  h.mpRegen=1+h.int*.01+eqMpre;        // 1智 = 0.01 回蓝/s
  h.spellP=1+h.int*.001;               // 1智 = +0.1% 法术伤害（作用在所有 magDamage 上）
  if(h.mp===undefined)h.mp=h.maxMp;
  h.mp=Math.min(h.mp,h.maxMp);
  if(h.hp!==undefined)h.hp=Math.min(h.hp,h.maxHp);
}
function heroAt(c,r){return heroes.find(h=>h.col===c&&h.row===r);}
function dispName(h){return h.tier?advOf(h).name:CLASSES[h.cls].name;}

/* ================= 流程 ================= */
function reset(){
  gold=350;wood=300;lives=10;wave=0;queue=[];spawnT=0;incomeT=0;
  waveT=0;battleT=0;resting=false;cleared=true;hudAcc=0;
  mineLv=1;millLv=1;mineW=1;millW=1;autoTrialT=0;
  heroes=[];mobs=[];shots=[];fx=[];nums=[];bears=[];inv=[];forge=[];hails=[];storms=[];quakes=[];chests=[];corpses=[];
  trialCd={};for(const k of TRIAL_KEYS)trialCd[k]=0;
  renderTrials();
  sel=null;invSel=null;over=false;openShop=null;SRC=null;
  closeShop();closeCards();updateHUD();renderInfo();renderInv();refreshHire();
}
function waveComp(w){
  // 数量封顶30只（约27秒出完，不与下一波堆叠），后期靠强度而非数量
  // 最后一波：大量小怪 + 多个Boss 的总攻
  const fin=w>=TOTAL_WAVES;
  const list=[];
  if(isBossWave(w)){   // Boss关：清一色Boss，不带小怪，数值额外×BOSS_WAVE_MUL
    list.push({t:'boss',mul:BOSS_WAVE_MUL,hmul:BOSS_HP_MUL,rs:1.25});   // 每个BOSS关只来1只
    return list;
  }
  // 前5波是新手期：数量不减（金币照拿），靠 spawnMob 里的强度折扣压低数值
  const n=fin?45:Math.min(30,4+w*2);
  // 坦克逐步登场：w5每6只掺1、w6每5只掺1、w7起每4只掺1（原来w4就满配）
  const tankEvery=w>=7?4:(w>=6?5:(w>=5?6:0));
  for(let i=0;i<n;i++){
    let t='normal';
    if(w>=4&&i%3===2)t='lancer';                  // 长矛兵：手长
    if(w>=6&&i%5===1)t='brute';                   // 狂徒：高伤脆皮
    if(tankEvery&&i%tankEvery===tankEvery-1)t='tank';
    list.push({t});
  }
  if(isEliteWave(w)){  // 精英波：小怪之外额外来一批精英（第5波只来1只、倍率也低）
    const en=w<10?1:1+Math.floor(w/5);
    for(let i=0;i<en;i++)
      list.push({t:w>=15?'boss':'tank',elite:1,mul:w<10?1.25:1.6+.05*w,rs:ELITE_RS});
  }
  if(fin)list.push({t:'boss'},{t:'boss'},{t:'boss'});
  return list;
}
/* 阵型槽位：lane=第几行，dx=往右退多远（dx 越小越靠前、越先接敌） */
function formSlots(n,kind){
  const mid=(ROWS-1)/2, out=[];
  for(let i=0;i<n;i++){
    const lane=i%ROWS, depth=Math.floor(i/ROWS), off=Math.abs(lane-mid);
    let dx=depth*.9;
    if(kind==='goose')dx+=off*.95;              // 雁形阵：中间突前、两翼后掠
    else if(kind==='wedge')dx+=(mid-off)*.95;   // 锋矢阵：两翼在前、中间收后
    else if(kind==='line')dx+=depth*.55;        // 横阵：一排排整齐推进
    else if(kind==='echelon')dx+=lane*.8;       // 斜阵：整体斜着压过来
    out.push({lane,dx:dx+Math.random()*.18});
  }
  return out;
}
function startWave(){
  if(wave>=TOTAL_WAVES)return;
  wave++;
  resting=false;waveT=0;battleT=0;
  // 整波一起入场（不再一只只放）：排成纵深队形从右边压上来
  // 装备叠层每波重置：泰坦 / 嗜血 / 羊刀 / 狂涌 / 回响 / 诅咒
  for(const h of heroes){h.titanS=0;h.bloodS=0;h.sheepS=0;h.stormT=0;h.echoCd=0;h.curseT=0;calc(h);}
  /* 阵亡英雄在下一波开始时复活。
     ⚠️ 别删：英雄原来只在"清场"时复活，可一旦全灭场上就永远清不掉，
     英雄再也不复活、命一路掉到0，玩家没有任何翻盘机会。5行+追击AI之后
     英雄承压大增，全灭很常见，所以改成按波复活——惩罚是这一波漏光扣命，
     而不是直接判死。 */
  for(const h of heroes){
    if(!h.alive){
      h.alive=true;h.hp=h.maxHp;h.mp=h.maxMp;h.x=h.col+.5;
      levelFx(h.x,h.row+.5);
    }
  }
  const list=waveComp(wave);
  const slots=formSlots(list.length,FORMS[(wave-1)%FORMS.length]);
  slots.sort((a,b)=>a.dx-b.dx);
  // 近战在前、攻击距离远的在后：按 atkR 升序去抢靠前(dx小)的槽位
  const order=list.map((e,i)=>i).sort((a,b)=>(MOBS[list[a].t].atkR-MOBS[list[b].t].atkR)||(a-b));
  order.forEach((li,si)=>{
    const e=list[li], sl=slots[si];
    spawnMob(e.t,{dx:sl.dx,lane:sl.lane,elite:e.elite,mul:e.mul,hmul:e.hmul,rs:e.rs});
  });
  if(isBossWave(wave))showToast(`<b style="color:#ff5d5d">第 ${wave} 波 · BOSS关</b>　只有Boss，但数值极高`);
  else if(isEliteWave(wave))showToast(`<b style="color:#f0c46a">第 ${wave} 波 · 精英波</b>　混入精英怪`);
  updateHUD();renderInfo();
}
function spawnMob(type,opt){
  opt=opt||{};
  // 强度爬升：前7波额外打折(新手期，数量不减只压数值)，前15波平缓，15波后额外+6%/波加速收尾
  // 折后 w1≈0.4 w5≈1.16 w8起回原曲线 w10≈2.9 w15≈4.7 w20≈10 w25≈20
  const b=MOBS[type];
  let mul=(1+0.12*(wave-1))*Math.pow(1.045,wave-1);
  // 新手期折扣（第8波起衔接原曲线）。小怪整体变肉之后这里同步压低，
  // 保住 md 里那条「前7波刻意做简单」的要求。
  if(wave<=7)mul*=[.36,.42,.46,.52,.58,.68,.8][wave-1];
  if(wave>15)mul*=Math.pow(1.06,wave-15);
  if(wave>19)mul*=Math.pow(1.07,wave-19);   // 20~25波再加一档，收尾更有压迫感
  // 不再固定在格子正中：在所选行附近随机散开
  const hasLane=opt.lane!=null;
  const row=hasLane?opt.lane:Math.floor(Math.random()*ROWS);
  // 有阵型时只轻微抖动（看得出队形），没阵型(试炼)时大幅散开
  const j=hasLane?.5:1.3;
  const y=Math.max(-.32,Math.min(ROWS-1+.32,row+(Math.random()*j-j/2)));
  mul*=opt.mul||1;
  /* ⚠️ 耐久和伤害分开算（用户指定）：第5波之后**只有血量**额外 ×1.09^(w-5)，
     攻击力仍然走原来那条 mul 曲线。所以后期是"打得久"而不是"被秒"。
     实际血量倍率：w10≈1.5× w15≈2.4× w20≈3.6× w25≈5.6×（在原曲线之上再乘） */
  let hMul=mul*(opt.hmul||1);
  if(wave>5)hMul*=Math.pow(1.09,wave-5);
  mobs.push({type,row,y,x:COLS+.5+Math.random()*.4+(opt.dx||0),
    hp:b.hp*hMul,maxHp:b.hp*hMul,spd:b.spd,atk:b.atk*mul,r:b.r*(opt.rs||1),atkR:b.atkR,
    reward:Math.round(b.reward*(opt.elite?2:1)),xp:Math.round(b.xp*(opt.elite?2:1)),
    lives:b.lives,armor:b.armor,mres:b.mres,elite:opt.elite||0,
    trial:opt.trial||null,bonus:opt.bonus||0,chest:opt.chest||0,
    color:b.color,cd:0,fight:false,slowT:0,slowF:0,frost:0,asT:0,asF:0,sunderT:0,sunder:0});
}
/* 四大试炼：点图标开打，怪即刻入场；奖励在击杀时结算（见 damage） */
function trialReady(k){
  return started&&!over&&!resting&&trialCd[k]<=0&&wave>=TRIALS[k].minWave;
}
function startTrial(k){
  const T=TRIALS[k];
  if(!started||over){showToast('先点右上角 <b>▶ 启动</b> 才能开启试炼');return;}
  if(resting){showToast('备战时间内不能开试炼<br>等倒计时结束，或点 <b style="color:var(--gold)">⏩ 下一波</b>');return;}
  if(wave<T.minWave){showToast(`<b style="color:${T.color}">${T.n}</b> 第 ${T.minWave} 波后开放`);return;}
  if(trialCd[k]>0){showToast(`<b style="color:${T.color}">${T.n}</b> 冷却中 ${Math.ceil(trialCd[k])}s`);return;}
  trialCd[k]=T.cd;
  // 一波比一波难：数量与强度都跟当前波数走
  const w=Math.max(1,wave);
  if(k==='elite'){
    const n=1+Math.floor(w/5);
    const nChest=Math.random()<.25?2:1;   // 整场试炼只掉1个箱子，25%概率掉2个
    for(let i=0;i<n;i++)
      spawnMob(w>=15?'boss':'tank',{trial:k,mul:1.5+.06*w,rs:1.15,dx:i*.7,chest:i<nChest?1:0});
    for(let i=0;i<2+Math.floor(w/3);i++)
      spawnMob('lancer',{trial:k,mul:1.2+.04*w,dx:1.2+i*.4});
  }else{
    const n=4+Math.floor(w*.7);
    const bonus=k==='gold'?10+w*3:(k==='wood'?6+w*2:4+w*2);
    for(let i=0;i<n;i++){
      const t=k==='xp'?(i%3===2?'tank':'normal'):(i%3===2?'lancer':'normal');
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
  if(SRC)SRC.dmgOut=(SRC.dmgOut||0)+Math.max(0,Math.min(d,m.hp));   // 伤害统计（不算溢出）
  m.hp-=d;
  m.knock=Math.min(.2,(m.knock||0)+.09);   // 打击感：被打时往后弹一下并压扁
  dnum(m.x,m.y+.5,d,color);
  if(m.hp<=0){
    m.dead=true;
    if(corpses.length<24)corpses.push({type:m.type,x:m.x,y:m.y,r:m.r,rot:0,t:.6,max:.6});
    if(m.type==='boss')R3.shake(.22);else if(m.type==='tank')R3.shake(.1);
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
  const gold15=Math.random()<GOLD_DROP;
  // 新装备池没有单独的精英池了：15%出金色，否则从商店同款的蓝/紫里随机
  const pool=gold15?EQUIPS.filter(e=>e.pool==='gold')
                   :EQUIPS.filter(e=>!e.pool&&(e.q==='rare'||e.q==='epic'));
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
    if(h.procs&&h.procs.storm){h.stormT=3;calc(h);}   // 风暴骑手的狂涌：击杀刷新3秒攻速
    /* 杀人剑：击杀数记在装备实例上（每把独立），够 evoN 就进化一档 */
    for(const e of h.equips){
      const d=eqDef(e);
      if(!d.evo)continue;
      e.kills=(e.kills||0)+1;
      if(e.kills>=d.evoN){
        e.kills=0;e.id=d.evo;calc(h);dirty=true;
        const nd=eqDef(e),q=QUALS[nd.q];
        fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.8,t:.5,max:.5,color:q.c});
        showToast(`<b style="color:${q.c}">${nd.n}</b> 进化 → [${q.n}]<br>${eqDesc(nd,e)}`);
      }
    }
  }
  if(dirty&&sel)renderInfo();
}
/* 物理伤害吃怪物护甲，魔法伤害吃怪物魔抗 */
function mobArmor(m){return Math.max(0,m.armor-(m.sunderT>0?(m.sunder||0):0));}
function physDamage(m,d,color){damage(m,d*(1-armorRed(mobArmor(m))),color);}
function magDamage(m,d,color){damage(m,d*(SRC&&SRC.spellP?SRC.spellP:1)*(1-m.mres),color);}
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
      gold+=mineW*mineLv;wood+=millW*millLv;updateHUD();refreshAfford();
    }
    // 出怪后不限时（只累计战斗用时）；清场后进入备战倒计时，到点自动开下一波
    if(resting){
      waveT-=dt;
      if(autoNext&&wave<TOTAL_WAVES)goNextWave(true);   // 自动开波：不等备战倒计时
      else if(waveT<=0)startWave();
    }else if(wave>0)battleT+=dt;
    /* 自动试炼：CD一好就开，隔 1.5s 开一个，别 4 个一起涌进来 */
    if(autoTrial){
      autoTrialT-=dt;
      if(autoTrialT<=0){
        const tk=TRIAL_KEYS.find(trialReady);
        if(tk){startTrial(tk);autoTrialT=1.5;}
      }
    }
  }
  hudAcc+=dt;
  if(hudAcc>=.25){
    hudAcc=0;updateHUD();
    // 主属光环按距离生效，英雄会推进，所以定期重算一次属性
    if(heroes.some(h=>h.skills['主属光环']||(h.tier&&advOf(h).key==='guard')))
      for(const h of heroes){const rt=h.hp/h.maxHp;calc(h);h.hp=h.maxHp*rt;}
  }
  /* 怪物：视野外向左推进；**进入仇恨范围就直接扑向最近的英雄/召唤物**（不是擦着走过去），
     进攻击范围停下开打。所以只要英雄不死，上下两行的怪也会被拉过来，理论上不漏。 */
  for(const m of mobs){
    if(m.knock>0)m.knock=Math.max(0,m.knock-dt*1.1);
    if(m.slowT>0)m.slowT-=dt;
    if(m.frost>0)m.frost-=dt;        // 冰霜覆层显示时长
    if(m.asT>0)m.asT-=dt;            // 攻速减益（大地震颤）
    if(m.sunderT>0)m.sunderT-=dt;    // 破甲计时（幽冥刃）
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
    // 仇恨内=追击目标；仇恨外=继续向左推进（各走各的，不排队等同伴）
    if(tgt&&td<=AGGRO_R){
      const dx=tgt.x-m.x, dy=tgt.row-m.y, L=Math.hypot(dx,dy)||1;
      m.x+=dx/L*spd*dt;
      m.y=Math.max(-.32,Math.min(ROWS-1+.32,m.y+dy/L*spd*dt));
    }else{
      m.x-=spd*dt;
    }
    if(m.x< -0.5){m.dead=true;lives-=m.lives;if(lives<=0){lives=0;endGame(false);}updateHUD();}
    /* 相互排开：所有怪都想站在离目标 reach 的地方，再加一层各向同性的斥力，
       结果就是**围着肉盾摊成一道弧**而不是叠成一坨。SEP 略小于两只的体型和，
       所以允许轻微重叠，但数得清个数。 */
    for(const o of mobs){
      if(o===m||o.dead)continue;
      const dx=m.x-o.x, dy=m.y-o.y, d2=dx*dx+dy*dy, SEP=m.r+o.r+.24;
      if(d2>=SEP*SEP)continue;
      const d=Math.sqrt(d2)||.001;
      const push=(SEP-d)/SEP*2.2*dt;
      m.x+=dx/d*push;
      m.y=Math.max(-.32,Math.min(ROWS-1+.32,m.y+dy/d*push*1.35));   // 纵向推得多一点，弧更明显
    }
    m.row=Math.max(0,Math.min(ROWS-1,Math.round(m.y)));   // 派生所在行
  }
  /* 熊灵 */
  for(const br of bears){
    br.t-=dt;
    if(br.t<=0||br.hp<=0){br.dead=true;continue;}
    br.cd-=dt;
    /* ⚠️ 原来是 `m.row!==br.row` 硬筛同一行，导致召唤物从斜下方的怪身边直接走过去。
       改成纵向 1.6 格的 band + 距离判定，和英雄一个口径。 */
    SRC=br.own||null;
    let best=null,bestD=1e9;
    for(const m of mobs){
      if(m.dead||Math.abs(m.y-br.row)>1.6)continue;
      const d=Math.hypot(m.x-br.x,m.y-br.row);
      if(d<=1.1){ if(!best||bestD>1.1||d<bestD){best=m;bestD=d;} }
      else if(!best||(bestD>1.1&&m.x<best.x)){best=m;bestD=d;}
    }
    const md=MINIONS[br.kind]||MINIONS.bear, by=br.row+.5+(br.oy||0);
    if(!best){br.x=Math.min(br.x+(br.spd||HERO_SPD)*dt,COLS-.5);continue;}   // 本行没敌人：继续往前压
    {
      const gap=best.x-br.x;
      if(gap>(br.rng||.8)){br.x=Math.min(br.x+(br.spd||HERO_SPD)*dt,COLS-.5);}   // 一直向前推进，不再被召唤点限制
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
    }
  }
  SRC=null;
  bears=bears.filter(b=>!b.dead);
  /* 暴风雪冰雹：到点落下，小片AOE伤害+减速 */
  for(const hl of hails){
    SRC=hl.own||null;
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
    SRC=s.own||null;
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
    SRC=q.own||null;
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
    SRC=h;               // 这一轮里所有伤害（平A/技能/装备触发）都记到这个英雄头上
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
    // 回血（1力=0.3/s，和狂战士之血那种按失血比的回复叠加）/ 回蓝
    if(h.hp<h.maxHp)h.hp=Math.min(h.maxHp,h.hp+h.hpRegen*dt);
    h.mp=Math.min(h.maxMp,h.mp+h.mpRegen*dt);
    /* 装备计时器：回响之刃CD / 风暴骑手攻速buff / 幽邃圣主的诅咒冷却加速 */
    if(h.echoCd>0)h.echoCd-=dt;
    if(h.stormT>0){h.stormT-=dt;if(h.stormT<=0)calc(h);}
    if(h.curseT>0)h.curseT-=dt;
    const cdSpd=h.curseT>0?1.2:1;
    for(const name in h.skills){
      const def=SKB[name];
      if(!def.cd)continue;
      h.cds[name]=(h.cds[name]||0)-dt*cdSpd;
      if(h.silenced)continue;           // 禁制匕首：沉默，主动技能全部不放
      if(h.cds[name]>0)continue;
      if((def.mana||0)>h.mp)continue;   // 蓝不够不放
      if(castSkill(h,name,h.skills[name],hx,hy)){
        h.cds[name]=def.cd*(1-h.cdr);
        h.mp-=def.mana||0;
        if(h.procs.curse)h.curseT=3;
      }
    }
    // 牧师专精·治愈祷言（主动，自动释放）
    if(h.tier&&advOf(h).key==='priest'&&!h.silenced){
      h.specCd=(h.specCd||0)-dt*cdSpd;
      if(h.specCd<=0&&h.mp>=30){
        const hurt=heroes.filter(o=>o.alive&&o.hp<o.maxHp);
        if(hurt.length){
          h.specCd=2*(1-h.cdr);h.mp-=30;
          if(h.procs.curse)h.curseT=3;
          const heal=h.int*h.specLv*.5*(h.healP||1);   // 治疗强度
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
    /* 选敌：先按纵向 band 粗筛，再用真实距离判定。
       ⚠️ band 放宽过（战士 1.15→1.6、游侠 2.3→3.2）：原来贴在斜上/斜下一格的怪
       会被 band 滤掉，英雄当没看见继续往前走，就出现"和 Boss 擦肩而过"。
       另外**贴脸的优先**：0.9 格内的敌人直接锁定，不再挑站得最靠左的那只。 */
    let best=null,bestD=1e9;
    for(const m of mobs){
      if(m.dead)continue;
      const band=h.cls==='warrior'?1.6:(h.cls==='archer'?3.2:3.2);
      if(Math.abs(m.y-h.row)>band)continue;
      const d=Math.hypot(m.x-hx,(m.y+.5)-hy);
      if(d>h.range+m.r)continue;
      if(d<=.9){ if(!best||bestD>.9||d<bestD){best=m;bestD=d;} }        // 贴脸的优先
      else if(!best||(bestD>.9&&m.x<best.x)){best=m;bestD=d;}
    }
    // 开波后从左往右推进；没敌人时压上去，清场后瞬间传回本阵
    const home=h.col+.5;
    if(started&&!over&&mobs.length){
      if(!best)h.x=Math.min(h.x+HERO_SPD*dt,COLS-.7);
    }else if(h.x!==home){
      fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.5,t:.3,max:.3,color:'#8ab8d8'});
      h.x=home;
      fx.push({type:'ring',x:home,y:h.row+.5,rr:.5,t:.3,max:.3,color:'#8ab8d8'});
    }
    if(best&&h.cd<=0){
      h.cd=effInterval(h);
      attack(h,hx,hy,best);
      const ms=h.skills['多重射击'];
      if(ms){
        let extra=Math.floor(ms/2)+((ms%2)&&Math.random()<.5?1:0);
        if(extra>0){
          // 次级目标的检索范围比主目标再放宽 MS_EXTRA 格（横向和纵向都放宽），
          // 否则常常只打得到 1 个、打不满 extra 个
          const others=mobs.filter(m=>{
            if(m.dead||m===best)return false;
            if(h.cls==='archer'&&Math.abs(m.y-h.row)>2.3+MS_EXTRA)return false;
            if(h.cls==='warrior'&&Math.abs(m.y-h.row)>1.15+MS_EXTRA)return false;
            return Math.hypot(m.x-hx,(m.y+.5)-hy)<=h.range+m.r+MS_EXTRA;
          }).sort((a,b)=>a.x-b.x).slice(0,extra);
          for(const o of others)attack(h,hx,hy,o,.7,'#7fe8ff');
        }
      }
    }
  }
  SRC=null;
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
  for(const c of corpses)c.t-=dt;
  corpses=corpses.filter(c=>c.t>0);
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
    // 波次结束：召唤物全部消散，英雄直接传送回本阵格子
    for(const br of bears)
      fx.push({type:'ring',x:br.x,y:br.row+.5+(br.oy||0),rr:.6,t:.35,max:.35,
        color:(MINIONS[br.kind]||MINIONS.bear).color});
    bears=[];
    for(const h of heroes){h.alive=true;h.hp=h.maxHp;h.mp=h.maxMp;h.x=h.col+.5;}
    updateHUD();
    if(wave>=TOTAL_WAVES){endGame(true);return;}
    resting=true;waveT=REST_TIME;
    showToast(`第 ${wave} 波清空（用时 ${Math.round(battleT)}s）<br>备战 <b style="color:#8ab8d8">${REST_TIME}s</b> 后出下一波，可点右上角 <b style="color:var(--gold)">⏩</b> 提前开波换金币`);
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
function attack(h,hx,hy,m,mul,color,noEcho){
  mul=mul||1;
  h.animT=animT(h);h.anim=h.animT;
  const adv=advOf(h), akey=adv?adv.key:'', asp=h.specLv||1;
  const P=h.procs||{};
  /* 平A叠层：战争领主的嗜血(+5攻+1%吸血,25层) / 羊刀(+10攻速,10层) */
  if(P.blood&&(h.bloodS||0)<25){h.bloodS=(h.bloodS||0)+1;calc(h);}
  if(P.sheep&&(h.sheepS||0)<10){h.sheepS=(h.sheepS||0)+1;calc(h);}
  let dmg=effAtk(h)*mul*(h.dmgMul||1),c=color;   // dmgMul = 弩手·重弩的最终伤害加成
  if(akey==='bandit'){                            // 强盗·掠夺：每次普攻偷金币
    const st=30+5*asp;gold+=st;
    nums.push({x:h.x,y:h.row+.1,txt:'+'+st,color:'#f0c46a',t:.8,max:.8});
  }
  if(P.gold){gold+=5;nums.push({x:h.x,y:h.row+.1,txt:'+5',color:'#f0c46a',t:.6,max:.6});}
  // 致命一击：(15+5lv)%几率 (140+10lv)%伤害；装备再加暴击率/爆伤
  const cr=h.skills['致命一击'];
  const critC=(cr?.15+.05*cr:0)+(h.critAdd||0);   // 技能暴击率 + 装备暴击率
  if(critC>0&&Math.random()<critC){dmg*=(cr?1.4+.1*cr:1.5)+(h.critDmg||0);c='#ffd24f';R3.shake(.09);}
  if(h.sunder){m.sunderT=6;m.sunder=Math.max(m.sunder||0,h.sunder);}   // 锈蚀/幽冥破甲
  if(P.black){                                    // 黑刀：永久削最大生命与护甲
    m.maxHp=Math.max(1,m.maxHp*.9);m.hp=Math.min(m.hp,m.maxHp);
    m.armor=Math.max(0,m.armor-40);
  }
  if(P.thunder)magDamage(m,h.str+h.agi+h.int,'#8ad8ff');   // 雷霆领主的法令
  if(h.lifesteal)h.hp=Math.min(h.maxHp,h.hp+dmg*h.lifesteal);
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
  }else if(akey==='musket'){
    /* 火枪兵·精准射击：弹道瞬发（参考 DotA 火枪），没有飞行时间，直接结算 + 一条枪线 */
    physDamage(m,dmg,c);
    if(poison)magDamage(m,poison,'#7ce87c');
    if(cleave)cleaveAround(m,dmg,cleave);
    magDamage(m,h.agi*(.15+.05*asp),'#ffd08a');   // 天赋：平A附加敏捷伤害
    fx.push({type:'bolt',x1:hx,y1:hy,x2:m.x,y2:m.y+.5,t:.08,max:.08,color:'#ffd08a'});
  }else{
    shots.push({x:hx,y:hy,target:m,tx:m.x,ty:m.y+.5,a:Math.atan2((m.y+.5)-hy,m.x-hx),
      kind:h.cls==='mage'?'orb':(akey==='xbow'?'quarrel':'arrow'),
      heavy:akey==='xbow'?1:0,
      dmg,cleave,splash:h.splash,poison,src:h,color:c||CLASSES[h.cls].color});
  }
  /* 回响之刃：每2秒一次，这一下打两遍 */
  if(P.echo&&!noEcho&&(h.echoCd||0)<=0&&!m.dead){h.echoCd=2;attack(h,hx,hy,m,mul,color,1);}
}
function shotHit(s,m){
  SRC=s.src||null;
  physDamage(m,s.dmg,s.color==='#7fe8ff'?'#7fe8ff':(s.color==='#ffd24f'?'#ffd24f':undefined));
  if(s.heavy){                       // 弩手·重弩：单发命中的冲击感
    R3.shake(.13);
    fx.push({type:'ring',x:m.x,y:m.y+.5,rr:.9,t:.24,max:.24,color:'#ffd08a'});
    fx.push({type:'slash',x:m.x-.05,y:m.y+.5,rr:.34,a:s.a||0,t:.18,max:.18,color:'#fff0c4'});
  }
  if(s.target===m){
    if(s.poison)magDamage(m,s.poison,'#7ce87c');
    if(s.cleave)cleaveAround(m,s.dmg,s.cleave);
  }
  SRC=null;
}
function hitUnit(u,m){
  if(u.isBear){
    u.hp-=m.atk;
    if(u.own)u.own.dmgTaken=(u.own.dmgTaken||0)+m.atk;   // 召唤物承伤算在主人头上
    dnum(u.x,u.row+.5+(u.oy||0),m.atk,'#ff8080');
    return;
  }
  const h=u;
  // 固定格挡 + 固定减免 先扣，再吃护甲减伤，最后乘百分比格挡(穷鬼盾)
  let dmg=Math.max(0,m.atk-h.block-(h.flat||0))*(1-armorRed(h.armor))*(1-(h.blockP||0));
  const bb=h.skills['狂战士之血'];
  if(bb){
    const miss=1-h.hp/h.maxHp;
    dmg*=1-Math.min(.7,miss*(.25+.08*bb));
  }
  if(h.endT>0)dmg*=1-h.endF;   // 忍受：额外减伤（与其它减伤相乘）
  h.hp-=dmg;h.flash=.12;h.dmgTaken=(h.dmgTaken||0)+dmg;
  dnum(h.x,h.row+.5,dmg,'#ff8080');
  if(h.titan&&(h.titanS||0)<50){   // 泰坦的坚决：每次受伤叠一层，本波内永久
    h.titanS=(h.titanS||0)+1;
    const rt=h.hp/h.maxHp;calc(h);h.hp=h.maxHp*rt;
    if((h.titanS%10)===0)fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.6,t:.35,max:.35,color:'#f0a63c'});
  }
  const th=h.skills['荆棘光环'];
  if(th)magDamage(m,m.atk*.15*th+h.str*.4*th,'#9dff9d');
  if(h.hp<=0){
    h.hp=0;h.alive=false;R3.shake(.16);
    fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.7,t:.35,max:.35,color:'#fff'});
    renderInfo();
  }
}
/* ===== 召唤类技能：技能名 → 召唤物种类 ===== */
const SUMMONS={'召唤熊德':'bear','火元素':'fire','水元素':'water','地狱火':'infernal'};
function summon(h,kind,lv){
  const d=MINIONS[kind];
  if(!mobs.length)return false;   // 同种召唤物可以叠着召（CD流人海战术）
  // 召唤师·召唤精通：召唤物属性 +(20+2×专精等级)%
  const sm=((h.tier&&advOf(h).key==='summoner')?1+(20+2*h.specLv)/100:1)*(h.sumB||1);
  const hp=(d.hpB+h.int*d.hpI*lv)*sm, atk=(d.atkB+h.int*d.atkI*lv)*sm;
  // 同排已有其它召唤物时错开站位，避免模型重叠
  const cnt=bears.filter(b=>!b.dead&&b.row===h.row).length;
  const base=(cnt%4)*.19;
  for(let i=0;i<d.n;i++){
    const oy=(d.n>1?(i-(d.n-1)/2)*.34:0)+[0,.16,-.16][(cnt+i)%3];   // 纵向错开显示
    const x=h.x+.5+base+i*.35;
    bears.push({isBear:true,kind,owner:h,row:h.row,oy,x,
      own:h,hp,maxHp:hp,atk,rng:d.rng,ivl:d.ivl,spd:d.spd,splash:d.splash,mag:d.mag,r:d.r,
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
      hails.push({cx,cy,R,delay:.3+i*gap,own:h,
        dmg:15+h.int*.8*lv,slow:Math.min(.75,.4+.05*lv)});
    }
    return true;
  }
  if(name==='火焰风暴'){
    const t=frontInRange(h,hx,hy);
    if(!t)return false;
    // 延迟1秒落地，之后每0.5秒灼烧一次，持续 2+0.5×等级 秒
    const R=1.5,dur=2+.5*lv,dps=12+h.int*.55*lv;
    storms.push({cx:t.x,cy:t.y+.5,R,delay:1,t:dur,tick:0,fxT:0,dps,own:h});
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
    quakes.push({x0,x1,y0,y1,t:dur,tick:0,fxT:0,dps,slow:.3,own:h});
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
  openHireCards();                                         // 开局免费选一个英雄
}

/* ================= UI ================= */
const uiMoney=document.getElementById('uiMoney'),uiWood=document.getElementById('uiWood'),
      uiLife=document.getElementById('uiLife'),uiWave=document.getElementById('uiWave'),
      info=document.getElementById('info'),invEl=document.getElementById('invItems'),
      toast=document.getElementById('toast'),ghost=document.getElementById('dragGhost');
let toastT=null;
function showToast(msg){
  toast.innerHTML=msg;toast.classList.add('show');
  clearTimeout(toastT);toastT=setTimeout(()=>toast.classList.remove('show'),1800);
}
function updateHUD(){
  uiMoney.textContent=Math.floor(gold);uiWood.textContent=Math.floor(wood);
  uiLife.textContent=lives;
  uiWave.textContent=wave+'/'+TOTAL_WAVES+
    (!started||over?'':resting?' · 备战'+Math.ceil(waveT)+'s':(wave?' · 战斗'+Math.floor(battleT)+'s':''));
  const nb=document.getElementById('nextBtn');
  const canNext=started&&!over&&resting&&wave<TOTAL_WAVES;
  nb.style.display=canNext?'':'none';
  if(canNext)nb.textContent='⏩ 下一波 +'+nextBonus()+'金';
  renderTrials();refreshHire();
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

/* ================= 角色卡片（招募 / 转职） =================
   开局和每次招募都弹三张职业卡；转职弹两张支线卡（带天赋说明）。
   卡片里的人物是 rpg3d.js 用同一套模型渲的大号预览（R3.cardShow）。 */
const cardsEl=document.getElementById('cards'),
      cardRow=document.getElementById('cardRow'),
      cardTitle=document.getElementById('cardTitle'),
      cardInfo=document.getElementById('cardInfo'),
      hireBtn=document.getElementById('hireBtn'),
      hireLvT=document.getElementById('hireLv');
let cardMode=null;                       // 'hire' | 'adv'
const ATTR_ICON={str:'⚔',agi:'🏹',int:'✦'};

function attrRows(base,grow,main){
  return ['str','agi','int'].map(k=>{
    const cc=CATS[k].color, hot=k===main;
    return `<div class="hcRow" style="color:${hot?cc:'#8fa2bb'}">
      <i style="color:${cc}">${ATTR_ICON[k]}</i>${CATS[k].label}
      <b style="color:${hot?cc:'#c8d4e4'}">${base[k].toFixed(1)}</b>
      <span class="gr">+${grow[k].toFixed(1)}</span></div>`;
  }).join('');
}
function closeCards(){
  cardMode=null;cardsEl.classList.remove('show');cardsEl.classList.remove('give');
  forgeBtn.style.display='none';forgeBtn.onclick=null;
  cardRow.innerHTML='';cardInfo.innerHTML='';cardInfo.classList.remove('show');
  R3.cardHide();
}
/* 招募：三张职业卡，选一张就把英雄放进该职业那一列的空位 */
function openHireCards(){
  if(heroes.length>=MAX_HEROES)return;
  const cost=heroCost(), free=cost===0;
  cardMode='hire';
  cardTitle.textContent=free?'选择你的第一位英雄（免费）':`招募第 ${heroes.length+1} 位英雄 · ${cost} 金`;
  const views=[];
  cardRow.innerHTML='';
  ['warrior','archer','mage'].forEach((cls,i)=>{
    const b=CLASSES[cls];
    const col=COL_CLASS.indexOf(cls);
    const full=freeRow(col)<0;                       // 该职业的3格都占满了
    const afford=gold>=cost;
    const ok=!full&&afford;
    const el=document.createElement('div');
    el.className='chcard'+(free?' free':'')+(ok?'':' no');
    el.innerHTML=`<div class="hcName" style="color:${b.color}">${b.name}</div>
      <canvas width="200" height="240"></canvas>
      <div class="hcStats">${attrRows(b.attr,b.grow,b.main)}</div>
      <div class="hcBuy">${full?'该职业已满':!afford?'金币不足':free?'免费获得':cost+' 金'}</div>`;
    if(ok)el.onclick=()=>{
      const row=freeRow(col);
      if(row<0)return;
      gold-=cost;
      const h=makeHero(cls,row,col);
      heroes.push(h);
      sel={col,row};
      closeCards();updateHUD();renderInfo();refreshHire();
      showToast(`<b style="color:${b.color}">${b.name}</b> 已加入战场`);
    };
    cardRow.appendChild(el);
    views.push({canvas:el.querySelector('canvas'),cls,tier:0,branch:0,phase:i*2.1});
  });
  cardsEl.classList.add('show');
  R3.cardShow(views);
}
/* 该职业列里第一个没人的行 */
function freeRow(col){
  for(let r=ROW0;r<ROW0+HROWS;r++)if(!heroAt(col,r))return r;
  return -1;
}
/* 是不是出兵格（英雄只能站/拖到这9格里） */
function isHomeCell(c,r){return c>=0&&c<HCOLS&&r>=ROW0&&r<ROW0+HROWS;}
/* 转职：两张支线卡，带天赋技能说明 */
function openAdvCards(h){
  if(!h||h.tier||h.lv<ADV_LV)return;
  cardMode='adv';
  const can=gold>=ADV_GOLD&&wood>=ADV_WOOD;
  cardTitle.innerHTML=`${CLASSES[h.cls].name} Lv${h.lv} 转职 · <span style="color:var(--gold)">${ADV_GOLD}金</span> + <span style="color:var(--wood)">${ADV_WOOD}木</span>`;
  const views=[];
  cardRow.innerHTML='';
  ADV[h.cls].forEach((br,i)=>{
    const sp=SPECS[br.key], b=CLASSES[h.cls];
    // 转职后的三维（×1.35）与成长，给玩家一个直观对比
    const na={},ng={};
    for(const k of ['str','agi','int']){na[k]=b.attr[k]*1.35;ng[k]=b.grow[k];}
    const el=document.createElement('div');
    el.className='chcard'+(can?'':' no');
    el.innerHTML=`<div class="hcName" style="color:${b.color}">${br.name}</div>
      <canvas width="200" height="240"></canvas>
      <div class="hcStats">${attrRows(na,ng,b.main)}</div>
      <div class="hcTal"><div class="tn">【天赋】${sp.n}</div>
        <div class="td">${sp.d(1)}</div></div>
      <div class="hcBuy">${can?'选择这条路':'资源不足'}</div>`;
    if(can)el.onclick=()=>{
      if(gold<ADV_GOLD||wood<ADV_WOOD)return;
      gold-=ADV_GOLD;wood-=ADV_WOOD;
      h.tier=1;h.branch=i;h.specLv=1;
      calc(h);h.hp=h.maxHp;
      levelFx(h.x,h.row+.5);
      closeCards();updateHUD();renderInfo();
      showToast(`转职成功：<b style="color:${b.color}">${br.name}</b>（天赋 ${sp.n}）`);
    };
    cardRow.appendChild(el);
    views.push({canvas:el.querySelector('canvas'),cls:h.cls,tier:1,branch:i,phase:i*2.6});
  });
  cardsEl.classList.add('show');
  R3.cardShow(views);
}
/* 卡片右侧：该英雄当前的技能栏(1×4) */
function sideSkills(h,nm){
  const names=Object.keys(h.skills);
  let out='';
  for(let i=0;i<MAX_SLOTS;i++){
    const n=names[i];
    if(!n){out+=`<div class="row em" data-side="sk${i}">空</div>`;continue;}
    const d=SKB[n],up=n===nm&&h.skills[n]<MAX_SKILL_LV;
    out+=`<div class="row${n===nm?' hi':''}" data-side="sk${i}" style="border-color:${QC[d.q]};color:${CATS[d.cat].color}">
      <b>${n}</b><small>Lv${h.skills[n]}${up?` <span style="color:#f0c46a">→ Lv${h.skills[n]+1}</span>`:''}</small></div>`;
  }
  return out;
}
/* 卡片右侧：该英雄当前的装备栏（6行，带属性） */
function sideEquips(h){
  let out='';
  for(let i=0;i<MAX_EQUIP;i++){
    const e=h.equips[i];
    if(!e){out+=`<div class="row em" data-side="eq${i}">空</div>`;continue;}
    const d=eqDef(e),q=qOf(e);
    out+=`<div class="row" data-side="eq${i}" style="border-color:${q.c};color:${q.c}"><b>${d.n}</b><small>${eqDesc(d,e)}</small></div>`;
  }
  return out;
}
/* 背包里点技能书/装备 → 弹出当前英雄的卡片（按购买顺序从左往右），点谁给谁
   左边=物品详情（不再进信息区），每张卡右边=该英雄的技能栏/装备栏 */
function openGiveCards(idx){
  const it=inv[idx];
  if(!it){closeCards();return;}
  if(!heroes.length){showToast('还没有英雄');return;}
  const isBook=it.t==='book';
  const nm=isBook?it.name:eqDef(it).n;
  cardMode='give';
  const hint='<span style="font-size:10.5px;color:#8ea0ba;font-weight:400">（点卡片右边的格子可指定栏位，占用的就是替换）</span>';
  cardTitle.innerHTML=(isBook
    ? `把 <b style="color:${QC[SKB[nm].q]}">${nm}</b> 教给哪位英雄？`
    : `把 <b style="color:${qOf(it).c}">${nm}</b> 装备给哪位英雄？`)+hint;
  if(isBook){
    const d=SKB[nm];
    cardInfo.innerHTML=`<div class="in" style="color:${CATS[d.cat].color}">${nm}</div>
      <div class="iq"><span style="color:${QC[d.q]}">[${QN[d.q]}]</span> <span style="color:${CATS[d.cat].color}">${CATS[d.cat].label}系</span></div>
      <div class="id">${d.desc}</div>
      <div class="ix">学习费 <b style="color:var(--gold)">${bookCost(nm)}金</b><br>同名书可升级，上限 Lv${MAX_SKILL_LV}<br>每位英雄 ${MAX_SLOTS} 个技能位</div>`;
  }else{
    const d=eqDef(it),q=qOf(it);
    cardInfo.innerHTML=`<div class="in" style="color:${q.c}">${d.n}</div>
      <div class="iq" style="color:${q.c}">[${q.n}]</div>
      <div class="id">${eqDesc(d,it)}</div>
      <div class="ix">装备费 <b style="color:var(--gold)">${equipCost(it)}金</b><br>每位英雄 ${MAX_EQUIP} 个装备位<br>装满后先在面板里双击脱下</div>`;
  }
  cardInfo.classList.add('show');
  cardsEl.classList.add('give');
  const views=[];
  cardRow.innerHTML='';
  heroes.forEach((h,i)=>{
    const b=CLASSES[h.cls], a=advOf(h);
    // 这本书学得了吗（满级/技能位满都要拦下来）
    let why='';
    if(isBook){
      const lv=h.skills[nm]||0;
      const cost=BOOK_COST[SKB[nm].q]||0;
      if(lv>=MAX_SKILL_LV)why='已满级';
      else if(!lv&&Object.keys(h.skills).length>=MAX_SLOTS)why='技能位已满';
      else if(gold<cost)why='学费不足';
      else why='';
    }else if(gold<equipCost(it))why='金币不足';
    const ok=!why;
    const el=document.createElement('div');
    el.className='chcard'+(ok?'':' no');
    const cur=isBook?(h.skills[nm]||0):h.equips.length;
    el.innerHTML=`<div class="hcName" style="color:${b.color}">${a?a.name:b.name} <span style="opacity:.7;font-size:10px">Lv${h.lv}</span></div>
      <canvas width="200" height="240"></canvas>
      <div class="hcStats">${attrRows({str:h.str,agi:h.agi,int:h.int},b.grow,b.main)}</div>
      <div class="hcBuy">${why||(isBook?(cur?`升到 Lv${cur+1}`:'学习'):`装备（${cur}/${MAX_EQUIP}）`)}</div>`;
    if(ok)el.onclick=()=>{
      closeCards();
      applyItem(idx,h);
    };
    const pair=document.createElement('div');
    pair.className='chpair';
    const side=document.createElement('div');
    side.className='chside';
    side.innerHTML=isBook?sideSkills(h,nm):sideEquips(h);
    /* 点侧栏的格子 = 指定栏位，占用的那格就是**替换**。
       「技能位已满 / 装备位已满」正好靠这个解，所以这两种情况不拦。 */
    if(!why||why==='技能位已满')side.querySelectorAll('[data-side]').forEach(r=>{
      r.classList.add('pick');
      r.onclick=ev=>{
        ev.stopPropagation();
        const k=r.dataset.side, si=+k.slice(2);
        closeCards();
        applyItem(idx,h,k[0]==='s'?{sk:si}:{eq:si});
      };
    });
    pair.appendChild(el);pair.appendChild(side);
    cardRow.appendChild(pair);
    views.push({canvas:el.querySelector('canvas'),cls:h.cls,tier:h.tier,branch:h.branch,phase:i*2.1});
  });
  /* 装备还可以「存入熔炉」——按钮放在三张卡片下面（技能书不行：会绕过"买新书清旧书"的规则）。
     ⚠️ 存入时就把装备费付掉，之后取回/穿上都不再收费，背包里也不再标价。 */
  if(!isBook){
    const full=forge.length>=FORGE_MAX, ec=equipCost(it), poor=gold<ec;
    forgeBtn.style.display='block';
    forgeBtn.disabled=full||poor;
    forgeBtn.innerHTML=full?'熔炉已满'
      :`存入熔炉（${forge.length}/${FORGE_MAX}）${ec?` <span class="cost">${ec}金</span>`:''}`
       +`<span class="sub">${poor?'金币不足':'存进去就算买下，之后取回和穿戴都免费；不会被「出售装备」卖掉'}</span>`;
    forgeBtn.onclick=()=>{
      const item=inv[idx];if(!item||forge.length>=FORGE_MAX)return;
      const c=equipCost(item);
      if(gold<c)return;
      gold-=c;item.paid=1;
      forge.push(item);inv.splice(idx,1);
      closeCards();updateHUD();renderInv();renderInfo();
      showToast(`<b style="color:${qOf(item).c}">${eqDef(item).n}</b> 已存入熔炉`);
    };
  }
  cardsEl.classList.add('show');
  R3.cardShow(views);
}

/* dock 左侧的招募按钮：满3人就消失 */
function refreshHire(){
  if(heroes.length>=MAX_HEROES){hireBtn.style.display='none';return;}
  hireBtn.style.display='';
  const c=heroCost();
  hireLvT.textContent=c===0?'免费':c+'金';
  hireBtn.disabled=gold<c;
  hireBtn.style.opacity=gold<c?.45:1;
}
hireBtn.onclick=()=>{if(heroes.length<MAX_HEROES&&gold>=heroCost())openHireCards();};
document.getElementById('cardCancel').onclick=closeCards;
cardsEl.onclick=ev=>{if(ev.target===cardsEl)closeCards();};

function renderInfo(){
  if(over)return;
  if(openShop){info.innerHTML=shopHTML()+forgeHTML();bindForge();return;}
  const h=selHero();
  let html='';
  if(sel&&!h){
    const cls=COL_CLASS[sel.col],b=CLASSES[cls];
    const hc=heroCost();
    html=`<div class="card"><b style="color:${b.color}">${b.name}位</b> <span>${b.desc}</span><br>
      <span>HP ${b.hpB+b.attr.str*8} · 攻 ${b.wep+b.attr[b.main]} · 间隔 ${b.bat}s · 甲 ${b.baseArmor}</span><br>
      <span>力${b.attr.str}(+${b.grow.str}) 敏${b.attr.agi}(+${b.grow.agi}) 智${b.attr.int}(+${b.grow.int})</span></div>
      <button class="btn" id="buyAt" data-lock="${heroes.length>=MAX_HEROES?1:0}" ${heroes.length>=MAX_HEROES?'disabled':''}>
        招募英雄 ▸${heroes.length>=MAX_HEROES?'<br><span class="sub">已满3人</span>':'<br><span class="sub">第'+(heroes.length+1)+'个 <span class="cost">'+(hc||'免费')+(hc?'金':'')+'</span></span>'}</button>`;
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
        <span>HP <b id="hpVal">${Math.ceil(h.hp)}/${h.maxHp}</b> +${h.hpRegen.toFixed(1)}/s</span>
        <span>MP <b id="mpVal">${Math.floor(h.mp)}/${h.maxMp}</b> +${h.mpRegen.toFixed(1)}/s</span>
        <span>攻击 <b>${h.atk}</b></span>
        <span>攻速 <b>${h.ias}</b></span>
        <span>基础间隔 <b>${h.bat.toFixed(2)}s</b></span>
        <span>实际间隔 <b id="itvVal">${effInterval(h).toFixed(2)}s</b> <span class="dim">${(1/effInterval(h)).toFixed(2)}次/s</span></span>
        <span>护甲 <b>${h.armor}</b> ${Math.round(armorRed(h.armor)*100)}%</span>
        <span style="color:#ff9d9d">力 <b>${h.str}</b></span>
        <span style="color:#8ce8a8">敏 <b>${h.agi}</b></span>
        <span style="color:#8db8ff">智 <b>${h.int}</b></span>
        <span>抗 <b>${Math.round(h.mres*100)}%</b>${h.cdr?' CD-'+Math.round(h.cdr*100)+'%':''}${(h.block+(h.flat||0))?' 挡'+(h.block+(h.flat||0)):''}${h.blockP?' 减'+Math.round(h.blockP*100)+'%':''}${h.critAdd?' 暴'+Math.round(h.critAdd*100)+'%':''}</span>
      </div>${h.tier?`<div style="margin-top:2px;color:${b.color};font-size:9.5px">专精 <b>${SPECS[advOf(h).key].n}</b> Lv${h.specLv} — <span style="color:var(--ink-dim)">${SPECS[advOf(h).key].d(h.specLv)}</span></div>`:''}</div>
      <button class="autoBtn${h.autoLearn?' on':''}" data-auto="1">自动<br>学习</button>
      <div class="slotgrid sk">${sk.join('')}</div>
      <div class="slotgrid eq">${eq.join('')}</div>`;
    if(!h.tier){
      // 点开弹转职卡片（两条支线各一张，带天赋说明）
      const canBase=h.lv>=ADV_LV, can=canBase&&gold>=ADV_GOLD&&wood>=ADV_WOOD;
      html+=`<button class="btn" id="advOpen" data-lock="${canBase?0:1}" ${can?'':'disabled'}>
        转职 ▸<br><span class="sub">${canBase?'选择支线':'需Lv'+ADV_LV}</span> <span class="cost">${ADV_GOLD}金</span>+<span class="costw">${ADV_WOOD}木</span></button>`;
    }else if(h.specLv<SPEC_MAX){
      const sc=specCost(h.specLv);
      html+=`<button class="btn" data-spec="1" data-cost="${sc.g}" data-wood="${sc.w}" data-lock="0" ${gold>=sc.g&&wood>=sc.w?'':'disabled'}>
        专精升级 Lv${h.specLv+1}<br><span class="cost">${sc.g}金</span>+<span class="costw">${sc.w}木</span></button>`;
    }
  }else{
    const n=mobs.length+queue.length;
    html=`<div class="hint">${!started?'布阵阶段：买好英雄后点右上角 <b style="color:#8ab8d8">▶ 启动</b> 开始进攻':
      n?'第 '+wave+' 波'+(isBossWave(wave)?' <b style="color:#ff5d5d">· BOSS关</b>':isEliteWave(wave)?' <b style="color:#f0c46a">· 精英波</b>':'')+' — 剩余 '+n
       :'点左边建筑逛商店；背包里点技能书/装备再选英雄；英雄可在本职业那一列的法阵间拖动换行'}</div>`;
    html+=forgeHTML();
  }
  info.innerHTML=html;
  bindForge();
  const ba=document.getElementById('buyAt');
  if(ba)ba.onclick=()=>openHireCards();
  const au=info.querySelector('[data-auto]');
  if(au)au.onclick=()=>{
    const hh=selHero();if(!hh)return;
    hh.autoLearn=!hh.autoLearn;
    if(hh.autoLearn){
      showToast('已启用自动学习：商店刷出的同名技能书会自动升级');
      autoLearnPass();renderInv();
    }
    autoLearnAll=heroes.length>0&&heroes.every(o=>o.autoLearn);refreshAuto();
    renderInfo();
  };
  const ao=document.getElementById('advOpen');
  if(ao)ao.onclick=()=>openAdvCards(selHero());
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
  renderInfo();
}
function closeShop(){
  openShop=null;
}
function forgeHTML(){
  let g='';
  for(let i=0;i<FORGE_MAX;i++){
    const it=forge[i];
    if(!it){g+='<div class="fslot em"></div>';continue;}
    const d=eqDef(it),q=qOf(it);
    g+=`<div class="fslot" data-forge="${i}" style="border-color:${q.c};color:${q.c}">${d.s}</div>`;
  }
  return `<div class="forge"><div class="fh">熔炉<small>${forge.length}/${FORGE_MAX}</small></div>
    <div class="fgrid">${g}</div></div>`;
}
function shopHTML(){
  if(openShop==='skill'){
    return `<div class="card shopHead"><b>技能商店</b></div><div class="shopGrid">`+
      Object.entries(CATS).map(([cat,c])=>
        `<button class="btn" data-pack="${cat}" data-cost="0" data-wood="${PACK_COST}" data-lock="0" ${wood>=PACK_COST?'':'disabled'}>
          <b style="color:${c.color}">${c.label}</b> <span class="costw">${PACK_COST}木</span>
          <span class="sub">随机${PACK_N}本${c.label}系</span></button>`).join('')+
      `<button class="btn" data-pack="roll" data-cost="0" data-wood="${ROLL_COST}" data-lock="0" ${wood>=ROLL_COST?'':'disabled'}>
        <b style="color:#f0c46a">ROLL</b> <span class="costw">${ROLL_COST}木</span>
        <span class="sub">全池·最便宜（换掉旧书）</span></button></div>`;
  }
  if(openShop==='item'){
    return `<div class="card shopHead"><b>装备商店</b></div><div class="shopGrid eq">`+
      Object.entries(EQ_TIERS).map(([k,t])=>
        `<button class="btn" data-eqroll="${k}" data-cost="0" data-wood="${t.wood}" data-lock="0" ${wood>=t.wood?'':'disabled'}>
          <b>${t.n}</b> <span class="costw">${t.wood}木</span>
          <span class="sub">${t.w.common?'白'+t.w.common+'/':''}绿${t.w.fine}/蓝${t.w.rare}/紫${t.w.epic}${t.w.legend?'/<b style="color:var(--gold)">金'+t.w.legend+'</b>':''}%</span></button>`).join('')+
      `</div>`;
  }
  /* 金矿/伐木场：产出 = 工人数 × 等级。升级 = 每个工人都变强，招工人 = 多一份产出 */
  const isMine=openShop==='mine';
  const lv=isMine?mineLv:millLv, w=isMine?mineW:millW, unit=isMine?'金':'木';
  const cost=isMine?mineCost(lv):millCost(lv);
  const wcost=isMine?mineWkCost(w):millWkCost(w);
  const head=`<div class="card shopHead inc"><b>${isMine?'金矿':'伐木场'}</b>
    <span>Lv${lv}/${INCOME_MAX} · 工人 ${w}/${WORKER_MAX}</span>
    <span style="color:var(--${isMine?'gold':'wood'})">现产 +${w*lv} ${unit}/s</span></div>`;
  const up=lv>=INCOME_MAX
    ? `<button class="btn" disabled><b>工人效率</b> 已满</button>`
    : `<button class="btn" data-shop="${openShop}" data-cost="${cost}" data-lock="0" ${gold>=cost?'':'disabled'}>
        <b>升级工人效率</b> Lv${lv+1} <span class="cost">${cost}金</span>
        <span class="sub">每个工人 ${lv} → ${lv+1} ${unit}/s</span></button>`;
  const hire=w>=WORKER_MAX
    ? `<button class="btn" disabled><b>工人数量</b> 已满</button>`
    : `<button class="btn" data-worker="${openShop}" data-cost="${wcost}" data-lock="0" ${gold>=wcost?'':'disabled'}>
        <b>增加工人数量</b> ${w+1}/${WORKER_MAX} <span class="cost">${wcost}金</span></button>`;
  return head+`<div class="shopGrid inc">${up}${hire}</div>`;
}
/* 点熔炉里的装备 = 取回背包（再点背包就能选英雄穿） */
function bindForge(){
  info.querySelectorAll('[data-forge]').forEach(el=>{
    el.onclick=()=>{
      const i=+el.dataset.forge,it=forge[i];
      if(!it)return;
      forge.splice(i,1);inv.push(it);
      showToast(`<b style="color:${qOf(it).c}">${eqDef(it).n}</b> 已取回背包`);
      renderInv();renderInfo();
    };
  });
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
      locked?`第${T.minWave}波开`:(cd>0?Math.ceil(cd)+'s':(resting?'备战中':'就绪'));
  }
}

/* ---- 背包（技能书+装备混放）---- */
function buyPack(cat){
  const cost=cat==='roll'?ROLL_COST:PACK_COST;
  if(wood<cost)return;
  wood-=cost;
  inv=inv.filter(it=>it.t!=='book');   // 上次没用完的技能书不保留
  const pool=cat==='roll'?Object.keys(SKB):Object.keys(SKB).filter(n=>SKB[n].cat===cat);
  /* 同一次刷新不出重复技能书：抽一本就从本次候选池里拿掉（池子不够 PACK_N 本才重新填） */
  let left=pool.slice();
  for(let i=0;i<PACK_N;i++){
    if(!left.length)left=pool.slice();
    const n=pickBook(left);
    left.splice(left.indexOf(n),1);
    inv.push({t:'book',name:n});
  }
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
    const bc=bookCost(it.name);
    if(gold<bc)continue;             // 金币不够就先不吃这本
    gold-=bc;
    h.skills[it.name]++;calc(h);
    fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.6,t:.4,max:.4,color:CATS[SKB[it.name].cat].color});
    got.push(`${it.name}→Lv${h.skills[it.name]}`);
    inv.splice(i,1);
    if(invSel===i)invSel=null;
  }
  if(got.length)showToast('自动学习：'+got.join('、'));
}
function buyEquip(tier){
  const wd=EQ_TIERS[tier].wood||0;
  if(wood<wd)return;
  wood-=wd;
  for(let i=0;i<4;i++)inv.push(rollEquip(tier));   // 每档固定roll4件
  updateHUD();renderInfo();renderInv();
}
/* 背包排布：**左边固定 4 格技能书**（空的画虚线占位）→ 浅竖线 → 右边全是装备 */
const BOOK_SLOTS=4;
function invCell(it,i){
  const el=document.createElement('div');
  el.className='book';
  el.dataset.idx=i;
  if(it.t==='book'){
    const d=SKB[it.name];
    el.style.borderColor=QC[d.q];               // 边框=品质
    el.style.color=CATS[d.cat].color;           // 文字=属性系
    el.innerHTML=`${d.short}<small style="color:var(--gold)">${bookCost(it.name)}金</small>`;
  }else{
    const d=eqDef(it),q=qOf(it);
    el.style.borderColor=q.c;
    el.style.color=q.c;
    const ec=equipCost(it);
    el.innerHTML=d.s+(ec?`<small style="color:var(--gold)">${ec}金</small>`:'<small style="color:var(--ink-dim)">已付</small>');
  }
  return el;
}
/* 合成：小树枝×6 → 大树枝，大树枝×6 → 塞纳留斯的号角（背包里凑够自动合，可连锁） */
function craftInv(){
  for(let guard=0;guard<20;guard++){
    let did=false;
    for(const d of EQUIPS){
      if(!d.craft)continue;
      const idx=[];
      inv.forEach((it,i)=>{if(it.t==='eq'&&it.id===d.id)idx.push(i);});
      if(idx.length<d.craft.n)continue;
      for(let k=d.craft.n-1;k>=0;k--)inv.splice(idx[k],1);
      inv.push({t:'eq',id:d.craft.to});
      const nd=EQ_BY_ID[d.craft.to],q=QUALS[nd.q];
      showToast(`${d.craft.n} 个 <b>${d.n}</b> 合成 → <b style="color:${q.c}">${nd.n}</b>`);
      did=true;break;
    }
    if(!did)return;
  }
}
function renderInv(){
  craftInv();
  invEl.innerHTML='';
  const sb=document.getElementById('sellAll');
  const total=inv.reduce((s,it)=>s+sellValue(it),0);
  const nEq=inv.filter(canSell).length;
  sb.disabled=!nEq;
  sb.innerHTML=nEq?`出售${nEq}件<br><span style="color:var(--gold)">+${total}金</span>`:'出售<br>装备';
  const books=[];inv.forEach((it,i)=>{if(it.t==='book')books.push([it,i]);});
  const nb=Math.max(BOOK_SLOTS,books.length);   // 万一超过4本也不能吞掉
  for(let k=0;k<nb;k++){
    if(books[k])invEl.appendChild(invCell(books[k][0],books[k][1]));
    else{const e=document.createElement('div');e.className='book empty';invEl.appendChild(e);}
  }
  const sep=document.createElement('div');sep.className='invSep';invEl.appendChild(sep);
  inv.forEach((it,i)=>{if(it.t!=='book')invEl.appendChild(invCell(it,i));});
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
      const bc=bookCost(it.name);
      if(gold<bc){showToast(`学习 <b>${it.name}</b> 需要 <b style="color:var(--gold)">${bc}金</b>`);return;}
      gold-=bc;updateHUD();refreshAfford();
      h.skills[it.name]=cur+1;
    }
    calc(h);
    fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.6,t:.4,max:.4,color:CATS[SKB[it.name].cat].color});
  }else{
    const ec=equipCost(it);
    if(gold<ec){showToast(`装备 <b>${eqDef(it).n}</b> 需要 <b style="color:var(--gold)">${ec}金</b>`);return;}
    gold-=ec;updateHUD();refreshAfford();
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
    if(h.equips.length>=MAX_EQUIP){gold+=ec;showToast('装备位已满，拖到某件装备上可替换');return;}
    h.equips.push(it);
    const ratio=h.hp/h.maxHp;calc(h);h.hp=Math.round(h.maxHp*ratio);
    fx.push({type:'ring',x:h.x,y:h.row+.5,rr:.6,t:.4,max:.4,color:qOf(it).c});
  }
  inv.splice(idx,1);
  renderInv();
  renderInfo();   // 商店页/熔炉/英雄面板都可能要跟着变，统一重画
}
/* 背包：单击=弹英雄卡片选给谁（主要交互）；拖动到技能栏/装备栏=指定栏位覆盖（保留） */
let drag=null;
invEl.addEventListener('pointerdown',ev=>{
  const el=ev.target.closest('.book');if(!el||el.dataset.idx==null)return;   // 空占位格不响应
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
    // 单击 = 弹英雄卡片（详情在卡片层左边显示）；拖动到栏位仍然可用
    // ⚠️ 别在这里 closeShop()：用户要求学完/穿完还停在商店页，能直接接着 roll
    invSel=null;
    openGiveCards(idx);
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
  const gp=R3.pick(ev);
  if(!gp)return;
  const c=Math.floor(gp.x),r=Math.floor(gp.y);
  if(isHomeCell(c,r)){
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
      const d=eqDef(e),q=qOf(e);showToast(`<b style="color:${q.c}">${d.n}</b> [${q.n}]<br>${eqDesc(d,e)} · 双击脱下`);
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
  if(b.dataset.worker){
    const isMine=b.dataset.worker==='mine';
    const w=isMine?mineW:millW;
    if(w>=WORKER_MAX)return;
    const cost=isMine?mineWkCost(w):millWkCost(w);
    if(gold>=cost){
      gold-=cost;if(isMine)mineW++;else millW++;
      showToast(`${isMine?'金矿':'伐木场'}新工人上工了（${w+1}/${WORKER_MAX}）`);
      updateHUD();renderInfo();
    }
    return;
  }
});
/* 战场拖动：按住英雄可以在本职业那一列的出兵格之间换行 */
let hDrag=null;
cv.addEventListener('pointerdown',ev=>{
  if(!running)return;
  const gp=R3.pick(ev);
  if(!gp)return;
  const fx0=gp.x,fy0=gp.y;
  // 商店建筑（摆在战场左侧）
  const shop=R3.shopAt(fx0,fy0);
  if(shop){sel=null;invSel=null;setShop(shop);return;}
  // 先判宝箱（精英试炼掉落，点击开启）
  for(const ch of chests){
    if(!ch.dead&&Math.hypot(ch.x-fx0,ch.y-fy0)<.5){openChest(ch);return;}
  }
  // 英雄会推进到战斗区，点身上也能选中（不只是点老家格子）
  for(const h of heroes){
    if(Math.abs(h.x-fx0)<.5&&Math.abs(h.row+.5-fy0)<.5){
      sel={col:h.col,row:h.row};invSel=null;closeShop();renderInfo();
      hDrag={h,moved:false};cv.setPointerCapture&&cv.setPointerCapture(ev.pointerId);
      return;
    }
  }
  const c=Math.floor(fx0),r=Math.floor(fy0);
  if(c<0||c>=COLS||r<0||r>=ROWS)return;
  sel=isHomeCell(c,r)?{col:c,row:r}:null;
  invSel=null;
  if(sel)closeShop();
  renderInfo();
});
cv.addEventListener('pointermove',ev=>{
  if(!hDrag)return;
  const gp=R3.pick(ev);if(!gp)return;
  const r=Math.round(gp.y-.5);
  if(r!==hDrag.h.row)hDrag.moved=true;
  hDrag.row=r;
});
cv.addEventListener('pointerup',ev=>{
  if(!hDrag)return;
  const h=hDrag.h, r=hDrag.row;
  hDrag=null;
  if(r==null||r===h.row)return;
  if(!isHomeCell(h.col,r)){showToast('只能放在本职业那一列的出兵格上');return;}
  const other=heroAt(h.col,r);
  if(other){other.row=h.row;other.x=other.col+.5;}   // 同列两人直接换位
  h.row=r;h.x=h.col+.5;
  sel={col:h.col,row:h.row};
  renderInfo();
});
cv.addEventListener('pointercancel',()=>{hDrag=null;});
document.getElementById('launchBtn').addEventListener('click',ev=>{
  if(started)return;
  started=true;
  ev.currentTarget.style.display='none';
  startWave();
  renderInfo();
});
/* 提前开波奖励 = 剩余备战秒数 × 波数 × 2 */
function nextBonus(){return Math.max(0,Math.ceil(waveT))*wave*2;}
function goNextWave(auto){
  if(!started||over||!resting||wave>=TOTAL_WAVES)return;
  const bonus=nextBonus();
  gold+=bonus;
  if(!auto)showToast(`提前开波，省下的时间换成 <b style="color:var(--gold)">+${bonus}金</b>`);
  startWave();updateHUD();refreshAfford();
}
document.getElementById('nextBtn').addEventListener('click',()=>goNextWave(false));
/* ================= 右上角三个自动开关 ================= */
const autoBtnL=document.getElementById('autoLearnBtn'),
      autoBtnT=document.getElementById('autoTrialBtn'),
      autoBtnN=document.getElementById('autoNextBtn');
function refreshAuto(){
  autoBtnL.classList.toggle('on',autoLearnAll);
  autoBtnT.classList.toggle('on',autoTrial);
  autoBtnN.classList.toggle('on',autoNext);
}
autoBtnL.addEventListener('click',()=>{
  autoLearnAll=!autoLearnAll;
  for(const h of (heroes||[]))h.autoLearn=autoLearnAll;
  if(autoLearnAll&&running){autoLearnPass();renderInv();}
  refreshAuto();if(running)renderInfo();
  showToast(autoLearnAll
    ?'<b style="color:var(--gold)">自动学习</b> 已开启<br>全部英雄自动吃掉刷出的同名技能书（要扣学习费）'
    :'自动学习已关闭');
});
autoBtnT.addEventListener('click',()=>{
  autoTrial=!autoTrial;autoTrialT=0;refreshAuto();
  showToast(autoTrial
    ?'<b style="color:var(--gold)">自动试炼</b> 已开启<br>试炼 CD 一好就自动开（备战期不开）'
    :'自动试炼已关闭');
});
autoBtnN.addEventListener('click',()=>{
  autoNext=!autoNext;refreshAuto();
  showToast(autoNext
    ?'<b style="color:var(--gold)">自动开波</b> 已开启<br>清场后不等备战，直接下一波（照拿提前开波奖励）'
    :'自动开波已关闭');
});
refreshAuto();
document.getElementById('speedBtn').addEventListener('click',ev=>{
  speed=speed===1?2:1;
  ev.currentTarget.textContent='×'+speed;
  ev.currentTarget.classList.toggle('on',speed===2);
});
document.getElementById('startBtn').addEventListener('click',begin);

/* ================= 主循环 ================= */
/* 帧率：rAF 本身就跟屏幕刷新走（iPhone ProMotion 上可到 120Hz），逻辑全按 dt 推进。
   左上角那个帧率徽标已按用户要求去掉；`fpsCap` 留着（0=跟随屏幕，改成 60 就锁 60）。 */
let fpsCap=0;
let last=performance.now();
function loop(now){
  requestAnimationFrame(loop);
  if(fpsCap&&now-last<1000/fpsCap-1.5)return;   // 锁帧：跳过这一帧，dt 不丢
  const dt=Math.min((now-last)/1000,.05);last=now;
  gt+=dt;
  if(running&&!over)update(dt*speed);
  R3.draw();
}
reset();resize();
requestAnimationFrame(loop);
