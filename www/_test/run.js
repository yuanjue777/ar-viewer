#!/usr/bin/env node
/* 方块战线·无头浏览器验证脚本（固化下来，别每次重写，省 token）
 *
 * 用法（先 build，再跑）：
 *   python3 www/_build_artifact.py /tmp/rpgtest/test.html
 *   NODE_PATH=/opt/node22/lib/node_modules node www/_test/run.js <场景>
 *
 * 场景：
 *   shot   布阵阶段 + 中期战斗，各截一张（看布局/模型/特效）
 *   cards  招募卡→转职卡→技能书授予，全流程点一遍并断言
 *   sim    波次平衡快跑（逻辑时钟加速，16秒真实≈700秒逻辑），打印每波掉命
 *   eq     装备特效体检：真打一场看 proc 有没有触发（只打印数字）
 *   probe  数值体检：只打印数字不截图（改完数值/转职/装备先跑这个，最省 token）
 *   models 九条转职支线的模型与攻击动作，各截「静止/出手」两张（m0_* m1_* m2_*）
 *   crop   只截某块区域放大看（--clip=x,y,w,h）
 *
 * 参数：--out=<目录，默认/tmp/rpgtest>  --wide=<视口宽,默认900>  --tall=<高,默认420>
 * 截图输出在 <out>/*.png，用 Read 工具直接看。
 */
const {chromium}=require('playwright');
const path=require('path');
const CHROME='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const argv=process.argv.slice(2);
const scene=argv.find(a=>!a.startsWith('--'))||'shot';
const arg=(k,d)=>{const m=argv.find(a=>a.startsWith('--'+k+'='));return m?m.slice(k.length+3):d;};
const OUT=arg('out','/tmp/rpgtest');
const W=+arg('wide',900), H=+arg('tall',420);

/* 测试用的开局：给钱 + 塞满英雄技能，方便看特效 */
const SEED=`
  gold=99999;wood=99999;
  if(heroes.length<3){
    heroes.length=0;
    heroes.push(makeHero('warrior',ROW0,2),makeHero('archer',ROW0+1,1),makeHero('mage',ROW0+2,0));
  }
  heroes.forEach(h=>{h.lv=8;h.tier=1;h.branch=0;h.specLv=3;calc(h);h.hp=h.maxHp;h.mp=h.maxMp;});
  heroes[2].skills={'火球术':3,'冰风暴':3,'召唤熊德':2,'地狱火':2};
  heroes[1].skills={'剑雨':3,'多重射击':3,'致命一击':2};
  heroes[0].skills={'大地震颤':3,'忍受':3,'荆棘光环':2};
  heroes.forEach(h=>calc(h));
  updateHUD();renderInfo();
`;

(async()=>{
  const b=await chromium.launch({executablePath:CHROME,
    args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  const p=await b.newPage({viewport:{width:W,height:H},deviceScaleFactor:scene==='sim'?1:(scene==='models'?4:2)});
  const errs=[];
  p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  const shot=(n,clip)=>p.screenshot({path:path.join(OUT,n+'.png'),...(clip?{clip}:{})});

  await p.goto('file://'+path.join(OUT,'test.html'));
  await p.waitForTimeout(800);
  await p.evaluate(()=>document.getElementById('startBtn').click());
  await p.waitForTimeout(1100);                       // 开局会弹招募卡

  if(scene==='cards'){
    console.log('招募卡张数:',await p.evaluate(()=>document.querySelectorAll('#cardRow .chcard').length));
    await shot('k1_hire');
    await p.evaluate(()=>document.querySelectorAll('#cardRow .chcard')[0].click());
    await p.waitForTimeout(400);
    console.log('选完第1个 → 英雄数:',await p.evaluate(()=>heroes.length),
                '金:',await p.evaluate(()=>Math.floor(gold)),'(应仍是350，第1个免费)');
    await p.evaluate(()=>{gold=9999;wood=9999;heroes[0].lv=6;calc(heroes[0]);
      sel={col:heroes[0].col,row:heroes[0].row};renderInfo();});
    await p.waitForTimeout(300);
    await p.evaluate(()=>document.getElementById('advOpen').click());
    await p.waitForTimeout(1300);
    await shot('k2_adv');
    await p.evaluate(()=>document.querySelectorAll('#cardRow .chcard')[0].click());
    await p.waitForTimeout(400);
    console.log('转职 tier/branch:',await p.evaluate(()=>heroes[0].tier+'/'+heroes[0].branch));
    await p.evaluate(()=>{heroes.push(makeHero('archer',ROW0,1),makeHero('mage',ROW0+2,0));
      heroes.forEach(h=>{calc(h);h.hp=h.maxHp;h.mp=h.maxMp;});
      setShop('skill');buyPack('int');renderInv();});
    await p.waitForTimeout(400);
    await p.evaluate(()=>{const el=document.querySelector('#invItems .book');
      el.dispatchEvent(new PointerEvent('pointerdown',{clientX:100,clientY:400,bubbles:true}));
      window.dispatchEvent(new PointerEvent('pointerup',{clientX:100,clientY:400,bubbles:true}));});
    await p.waitForTimeout(1300);
    console.log('技能卡片层：左详情',await p.evaluate(()=>!!document.querySelector('#cardInfo.show')),
                '侧栏数',await p.evaluate(()=>document.querySelectorAll('#cardRow .chside').length),
                '技能格',await p.evaluate(()=>document.querySelectorAll('#cardRow .chside .row').length));
    await shot('k3_give');
    const before=await p.evaluate(()=>Object.keys(heroes[0].skills).length);
    await p.evaluate(()=>document.querySelectorAll('#cardRow .chcard')[0].click());
    await p.waitForTimeout(400);
    console.log('技能数:',before,'→',await p.evaluate(()=>Object.keys(heroes[0].skills).length));
    // 装备卡片层：右边应显示6行装备栏
    await p.evaluate(()=>{buyEquip('low');renderInv();});
    await p.waitForTimeout(300);
    await p.evaluate(()=>{const el=[...document.querySelectorAll('#invItems .book')].pop();
      el.dispatchEvent(new PointerEvent('pointerdown',{clientX:100,clientY:400,bubbles:true}));
      window.dispatchEvent(new PointerEvent('pointerup',{clientX:100,clientY:400,bubbles:true}));});
    await p.waitForTimeout(1300);
    console.log('装备卡片层：每卡装备行数',await p.evaluate(()=>document.querySelectorAll('#cardRow .chpair')[0].querySelectorAll('.chside .row').length));
    await shot('k4_eq');
    const beq=await p.evaluate(()=>heroes[0].equips.length);
    await p.evaluate(()=>document.querySelectorAll('#cardRow .chcard')[0].click());
    await p.waitForTimeout(300);
    console.log('装备数:',beq,'→',await p.evaluate(()=>heroes[0].equips.length));

    /* ---- 商店常驻：学完/穿完不应该把商店页顶掉 ---- */
    await p.evaluate(()=>{gold=99999;wood=99999;setShop('item');buyEquip('low');renderInv();});
    await p.waitForTimeout(300);
    console.log('买完装备 商店仍开着:',await p.evaluate(()=>openShop),
                '熔炉格数:',await p.evaluate(()=>document.querySelectorAll('#info .fslot').length));
    const clickInv=()=>p.evaluate(()=>{const el=[...document.querySelectorAll('#invItems .book')].pop();
      el.dispatchEvent(new PointerEvent('pointerdown',{clientX:100,clientY:400,bubbles:true}));
      window.dispatchEvent(new PointerEvent('pointerup',{clientX:100,clientY:400,bubbles:true}));});
    await clickInv();
    await p.waitForTimeout(900);
    console.log('点背包后 商店仍开着:',await p.evaluate(()=>openShop),
                '熔炉按钮(在卡片下方):',await p.evaluate(()=>{const b=document.getElementById('cardForge');
                  return b.style.display!=='none'&&b.parentElement.id==='cards';}));
    await shot('k5_forge');
    console.log('卡片层总宽/视口宽(应<=900，超了会横向滚动):',await p.evaluate(()=>{
      const r=document.getElementById('cardRow').getBoundingClientRect();
      const b=document.getElementById('cardBody').getBoundingClientRect();
      return [Math.round(r.width+150+10),Math.round(b.width),window.innerWidth];}));
    // 存入熔炉
    const g0=await p.evaluate(()=>gold);
    await p.evaluate(()=>document.getElementById('cardForge').click());
    await p.waitForTimeout(400);
    console.log('存入熔炉 → 熔炉件数:',await p.evaluate(()=>forge.length),
                '扣金:',g0-(await p.evaluate(()=>gold)),
                '信息区仍是商店:',await p.evaluate(()=>!!document.querySelector('#info .shopGrid')));
    // 点熔炉格子取回背包：应标记成已付费、不再标价
    await p.evaluate(()=>document.querySelector('#info .fslot[data-forge]').click());
    await p.waitForTimeout(300);
    console.log('取回背包 → 熔炉件数:',await p.evaluate(()=>forge.length),
                '背包装备数:',await p.evaluate(()=>inv.filter(i=>i.t==='eq').length),
                '取回的装备再穿要多少金:',await p.evaluate(()=>{
                  const it=inv.find(i=>i.paid);return it?equipCost(it):'没找到已付费装备';}));
    /* ---- 点侧栏格子 = 替换该栏位 ---- */
    await p.evaluate(()=>{heroes[0].equips=[{t:'eq',id:'doransword'},{t:'eq',id:'shortdagger'}];calc(heroes[0]);});
    await clickInv();
    await p.waitForTimeout(900);
    const b0=await p.evaluate(()=>heroes[0].equips.map(e=>eqDef(e).n).join('/'));
    await p.evaluate(()=>{const r=document.querySelectorAll('#cardRow .chpair')[0]
      .querySelectorAll('.chside .row')[1];r.click();});
    await p.waitForTimeout(400);
    console.log('点第2个装备格替换:',b0,'→',await p.evaluate(()=>heroes[0].equips.map(e=>eqDef(e).n).join('/')),
                '(第2格应被换掉，旧的退回背包)');

  }else if(scene==='sim'){
    /* 平衡测试：不 seed（裸跑），用逻辑时钟快跑，不等真实时间 */
    await p.evaluate(()=>document.querySelectorAll('#cardRow .chcard')[0].click());
    await p.waitForTimeout(300);
    await p.evaluate(()=>{
      heroes.push(makeHero('archer',ROW0,1),makeHero('mage',ROW0+2,0));
      heroes.forEach(h=>{calc(h);h.hp=h.maxHp;h.mp=h.maxMp;});
      document.getElementById('launchBtn').click();
      window.__log=[];let t=0;
      window.__sim=setInterval(()=>{
        for(let i=0;i<110;i++){update(0.05);t+=0.05;}
        window.__log.push({t:Math.round(t),wave,lives,mobs:mobs.length,
          alive:heroes.filter(h=>h.alive).length});
      },16);
    });
    await p.waitForTimeout(16000);
    const r=await p.evaluate(()=>{clearInterval(window.__sim);
      const L=window.__log,marks=[];let lw=0;
      for(const e of L)if(e.wave!==lw){lw=e.wave;marks.push(e);}
      return {marks,end:L[L.length-1]};});
    console.log('波次  命  场上怪  存活英雄');
    for(const m of r.marks)console.log(`  w${String(m.wave).padEnd(3)} ${String(m.lives).padEnd(4)} ${String(m.mobs).padEnd(7)} ${m.alive}`);
    console.log('结束:',JSON.stringify(r.end));

  }else if(scene==='eq'){
    /* 装备特效体检：真打一场，看每个 proc 有没有真的触发（只打印数字） */
    await p.evaluate(()=>document.querySelectorAll('#cardRow .chcard')[0].click());
    await p.waitForTimeout(300);
    await p.evaluate(()=>{
      gold=99999;wood=99999;heroes.length=0;
      heroes.push(makeHero('warrior',ROW0,2),makeHero('archer',ROW0+1,1),makeHero('mage',ROW0+2,0));
      heroes.forEach(h=>{h.lv=10;calc(h);h.hp=h.maxHp;h.mp=h.maxMp;});
      const eq=(h,ids)=>{h.equips=ids.map(id=>({t:'eq',id}));calc(h);h.hp=h.maxHp;h.mp=h.maxMp;};
      eq(heroes[0],['banditblade','kill1','warlord','sheepstick','echoblade','titan']);
      eq(heroes[1],['stormrider','blackblade','thunderedict','infinity','watcher','fullmoon']);
      eq(heroes[2],['forbidden','abysscurse','holypend','cenarius','goblinhorn','lovebow']);
      heroes[2].skills={'火球术':3,'闪电链':3};heroes.forEach(h=>calc(h));
      window.__g0=gold;window.__mob0=null;
      document.getElementById('launchBtn').click();
      window.__pk={blood:0,sheep:0,titan:0,storm:0,echo:0};
      window.__sim=setInterval(()=>{
        for(let i=0;i<80;i++){update(0.05);
          if(!window.__mob0&&mobs.length)window.__mob0=mobs[0];
          const K=window.__pk;   // 叠层每波会清零，所以记整场峰值
          K.blood=Math.max(K.blood,heroes[0].bloodS||0);
          K.sheep=Math.max(K.sheep,heroes[0].sheepS||0);
          K.titan=Math.max(K.titan,heroes[0].titanS||0);
          K.storm=Math.max(K.storm,heroes[1].stormT||0);
          K.echo =Math.max(K.echo, heroes[0].echoCd||0);
        }
      },16);
    });
    await p.waitForTimeout(9000);
    const r=await p.evaluate(()=>{clearInterval(window.__sim);
      const H=heroes,O={};
      O['波次/命']=[wave,lives];
      /* 平A触发的层数在实战里取决于站位（战士可能一直没摸到怪），
         所以再补一组**确定性**测试：手动让战士连A一只无敌假怪 30 下 */
      {const h=H[0];h.bloodS=0;h.sheepS=0;h.echoCd=0;calc(h);
       const a0=h.atk,g0=gold;let hits=0;
       const fake={x:h.x+1,y:h.row,row:h.row,r:.3,hp:1e9,maxHp:1e9,atk:0,armor:0,mres:0,
                   dead:false,reward:0,xp:0,color:'#fff',type:'normal'};
       mobs.push(fake);
       const od=damage;window.__hit=0;
       for(let i=0;i<30;i++){attack(h,h.x,h.row+.5,fake,1);hits++;}
       O['手动连A30下 → 嗜血/羊刀/攻击(前→后)/攻速/金币']=
         [h.bloodS,h.sheepS,[a0,h.atk],h.ias,Math.round(gold-g0)];
       O['假怪剩余最大血(黑刀不在战士身上应=1e9)']=fake.maxHp;
       fake.dead=true;mobs.splice(mobs.indexOf(fake),1);
       h.bloodS=0;h.sheepS=0;calc(h);}
      {const h=H[1];const fake={x:h.x+1,y:h.row,row:h.row,r:.3,hp:1e9,maxHp:1e9,atk:0,armor:10,mres:0,
                   dead:false,reward:0,xp:0,color:'#fff',type:'normal'};
       mobs.push(fake);
       for(let i=0;i<5;i++)attack(h,h.x,h.row+.5,fake,1);
       O['黑刀连A5下 → 假怪最大血(1e9×0.9^5)/护甲']=[Math.round(fake.maxHp),fake.armor];
       fake.dead=true;mobs.splice(mobs.indexOf(fake),1);}
      O['强盗之刃：金币净增(含击杀奖励)']=Math.round(gold-window.__g0);
      const K=window.__pk;
      O['峰值层数 嗜血(≤25)/羊刀(≤10)/泰坦(≤50)']=[K.blood,K.sheep,K.titan];
      O['回响之刃触发(CD峰值应≈2)']=+K.echo.toFixed(2);
      O['狂涌峰值(应≈3s)']=+K.storm.toFixed(2);
      O['当前 攻击/护甲/魔抗%']=[H[0].atk,H[0].armor,Math.round(H[0].mres*100)];
      O['杀人剑当前形态']=eqDef(H[0].equips[1]).n+' ['+QUALS[eqDef(H[0].equips[1]).q].n+'] 进度'+(H[0].equips[1].kills||0);
      O['狂涌buff剩余/攻速']=[+(H[1].stormT||0).toFixed(2),H[1].ias];
      O['黑刀：首只怪 最大血/原始血/护甲']=window.__mob0?[Math.round(window.__mob0.maxHp),Math.round(MOBS[window.__mob0.type].hp),window.__mob0.armor]:'no mob';
      O['禁制匕首：法师沉默/蓝量(满则说明没放技能)']=[H[2].silenced,Math.round(H[2].mp),H[2].maxMp];
      O['博爱之弩：法师间隔(基础1.6+0.2)']=H[2].bat;
      O['号角+哥布林：召唤强度×']=+H[2].sumB.toFixed(2);
      O['圣洁吊坠：治疗强度×']=H[2].healP;
      /* 减伤对照：怪攻100 打到 0甲英雄身上，看守望者(蓝) vs 穷鬼盾(紫) */
      {const h=H[0],sv=[h.equips,h.lv,h.tier];h.equips=[];h.lv=1;h.tier=0;calc(h);
       const hit=(id,a)=>{h.equips=id?[{t:'eq',id}]:[];calc(h);
         return Math.round(Math.max(0,a-h.block-(h.flat||0))*(1-armorRed(h.armor))*(1-(h.blockP||0)));};
       for(const a of [100,330])
         O['怪攻'+a+' 实际吃到 裸/小圆盾/守望者/穷鬼盾']=
           [hit(null,a),hit('smallshield',a),hit('watcher',a),hit('poorshield',a)];
       h.equips=sv[0];h.lv=sv[1];h.tier=sv[2];calc(h);h.hp=h.maxHp;}
      /* 单件装备的 DPS 增益排行：Lv15 转职游侠(精灵游侠)，只穿这一件 */
      {const h=H[1];h.equips=[];h.lv=15;h.tier=1;h.branch=1;h.specLv=5;h.bloodS=0;h.sheepS=0;h.stormT=0;calc(h);
       const dps=x=>{const cr=(x.critAdd||0);const cm=1.5+(x.critDmg||0);
         return x.atk*(1+cr*(cm-1))/effInterval(x)*(x.dmgMul||1);};
       const base=dps(h);
       const rows=EQUIPS.filter(e=>e.pool!=='evo').map(d=>{
         h.equips=[{t:'eq',id:d.id}];h.bloodS=d.proc==='blood'?25:0;h.sheepS=d.proc==='sheep'?10:0;
         h.stormT=d.proc==='storm'?3:0;calc(h);
         let v=dps(h);
         if(d.proc==='thunder')v+=(h.str+h.agi+h.int)/effInterval(h);   // 附加魔法伤按满伤算
         if(d.proc==='echo')v*=1+effInterval(h)/2>2?2:(1+Math.min(1,effInterval(h)/2));
         const pct=Math.round((v/base-1)*100);
         return {n:d.n,q:QUALS[d.q].n,c:EQUIP_COST[d.q],p:pct};
       }).sort((a,b)=>b.p-a.p);
       h.equips=[];h.bloodS=0;h.sheepS=0;h.stormT=0;calc(h);
       O['裸DPS(Lv15精灵游侠)']=Math.round(base);
       O['单件DPS增益排行(%)']=rows.map(r=>`${r.q}${r.n} +${r.p}%`);
      }
      return O;});
    for(const k in r){
      if(k==='单件DPS增益排行(%)'){console.log(k+':');for(const l of r[k])console.log('   '+l);}
      else console.log(k+':',JSON.stringify(r[k]));
    }

  }else if(scene==='probe'){
    /* 数值体检：**只打印数字不截图**（文字比图便宜太多，改完数值先跑这个） */
    await p.evaluate(()=>document.querySelectorAll('#cardRow .chcard')[0].click());
    await p.waitForTimeout(300);
    const r=await p.evaluate(()=>{
      const O={};
      gold=99999;wood=99999;heroes.length=0;
      heroes.push(makeHero('archer',ROW0,1),makeHero('mage',ROW0+1,0),makeHero('warrior',ROW0+2,2));
      O['基础BAT 法/游/战']=[CLASSES.mage.bat,CLASSES.archer.bat,CLASSES.warrior.bat];
      // 九条转职支线：转职后的关键派生值
      const bra=[];
      for(const h of heroes){
        h.lv=8;h.tier=1;h.specLv=4;
        ADV[h.cls].forEach((br,i)=>{
          h.branch=i;calc(h);
          bra.push(`${br.name}: atk${h.atk} bat${h.bat} 甲${h.armor} cdr${(h.cdr*100)|0}% 伤害×${(h.dmgMul||1).toFixed(2)}`);
        });
        h.tier=0;calc(h);
      }
      O['九支线']=bra;
      // 装备：池子规模 + 品质定价
      O['装备池 白/绿/蓝/紫/金']=['common','fine','rare','epic','legend']
        .map(q=>EQUIPS.filter(e=>e.q===q&&e.pool!=='evo').length);
      O['商店可roll(白/绿/蓝/紫)']=['common','fine','rare','epic']
        .map(q=>EQUIPS.filter(e=>e.q===q&&!e.pool).length);
      O['装备roll四档 金+木→出货率']=Object.entries(EQ_TIERS)
        .map(([k,t])=>`${t.n} ${t.cost}金+${t.wood}木 紫${t.w.epic}%${t.w.legend?' 金'+t.w.legend+'%':''}`);
      // 顶级档 roll 2000 次，看实际品质分布（金色应≈10%且只出3件金装）
      {const c={},names=new Set();
       for(let i=0;i<2000;i++){const it=rollEquip('top');const d=eqDef(it);
         c[QUALS[d.q].n]=(c[QUALS[d.q].n]||0)+1;if(d.q==='legend')names.add(d.n);}
       O['顶级roll×2000 实际分布']=c;
       O['顶级roll出的金装']=[...names];}
      O['装备费 白/绿/蓝/紫/金']=['doransword','heavyhammer','willowbow','dragonlance','titan']
        .map(id=>equipCost({t:'eq',id}));
      const m=heroes[1];m.tier=0;
      // 唯一特效：同名只算一件，异名叠加
      m.equips=[{t:'eq',id:'willowbow'}];calc(m);const b1=m.bat;
      m.equips=[{t:'eq',id:'willowbow'},{t:'eq',id:'willowbow'}];calc(m);const b2=m.bat;
      m.equips=[{t:'eq',id:'willowbow'},{t:'eq',id:'phantom'},{t:'eq',id:'fullmoon'}];calc(m);
      O['间隔唯一(柳月1/柳月2/柳月+幻烁+满月)']=[b1,b2,m.bat];
      m.equips=[{t:'eq',id:'lovebow'}];calc(m);O['博爱之弩(+0.2间隔)']=m.bat;
      m.equips=[{t:'eq',id:'rustblade'},{t:'eq',id:'rustblade'},{t:'eq',id:'gloomblade'}];calc(m);
      O['削甲 锈蚀×2+幽冥(应=5+15)']=m.sunder;
      m.equips=[{t:'eq',id:'manapend'}];calc(m);
      O['法力吊坠 全属性+10 力/敏/智']=[m.str,m.agi,m.int];
      m.equips=[{t:'eq',id:'twig'},{t:'eq',id:'twig'}];calc(m);
      O['小树枝×2 全属性']=[m.str,m.agi,m.int];
      m.equips=[];calc(m);
      // 合成链：6小树枝→大树枝，36小树枝→塞纳留斯的号角
      inv.length=0;for(let i=0;i<6;i++)inv.push({t:'eq',id:'twig'});renderInv();
      O['6小树枝→']=inv.map(it=>eqDef(it).n);
      inv.length=0;for(let i=0;i<36;i++)inv.push({t:'eq',id:'twig'});renderInv();
      O['36小树枝→']=inv.map(it=>eqDef(it).n);
      // 杀人剑进化链
      O['杀人剑进化链']=(()=>{const a=[];let d=EQ_BY_ID['kill1'];
        while(d){a.push(`${QUALS[d.q].n}${eqDesc(d)}`);d=d.evo?EQ_BY_ID[d.evo]:null;}return a;})();
      // 穿装备扣钱
      inv.length=0;inv.push({t:'eq',id:'willowbow'});
      const g0=gold;applyItem(0,heroes[0]);
      O['穿装备扣金']=g0-gold;
      // 波次耐久/伤害曲线（耐久和伤害已分离）
      O['每波总血/总攻(w1/5/8/10/15/20/25)']=[1,5,8,10,15,20,25].map(w=>{
        const sv=wave;wave=w;const L=waveComp(w);let hp=0,at=0;
        const m0=mobs.length;
        for(const e of L)spawnMob(e.t,{elite:e.elite,mul:e.mul,hmul:e.hmul,rs:e.rs});
        for(let i=m0;i<mobs.length;i++){hp+=mobs[i].maxHp;at+=mobs[i].atk;}
        mobs.length=m0;wave=sv;
        return `w${w}: 血${Math.round(hp)} 攻${Math.round(at)}(${L.length}只)`;});
      O['技能书 指定roll/全池roll/学习费绿蓝紫(金)']=[PACK_COST,ROLL_COST,BOOK_COST.qgreen,BOOK_COST.qblue,BOOK_COST.qpurple];
      O['移速(应全=1.3)']=Object.values(MOBS).map(m=>m.spd).concat([HERO_SPD]);
      O['小怪分工 血/攻/甲/抗/射程']=Object.entries(MOBS)
        .map(([k,m])=>`${k}: ${m.hp}血 ${m.atk}攻 ${m.armor}甲 ${Math.round(m.mres*100)}%抗 射程${m.atkR}`);
      // 经济曲线：交叉点（招人更划算 ⇔ L > W×√(b/a)）
      O['金矿 升级/工人']=[[1,2,3].map(mineCost),[1,2,3,4].map(mineWkCost)];
      O['伐木场 升级/工人']=[[1,2,3].map(millCost),[1,2,3,4].map(millWkCost)];
      // 召唤物移速应等于英雄推进速度
      O['召唤物移速==HERO_SPD']=Object.values(MINIONS).every(d=>d.spd===HERO_SPD);
      // 背包排布：左4格书 + 竖线 + 装备
      inv.length=0;inv.push({t:'book',name:'火球术'},{t:'eq',id:'doransword'});renderInv();
      const kids=[...document.getElementById('invItems').children].map(e=>e.className);
      O['背包排布']=kids.join(',');
      O['帧率徽标已删']=!document.getElementById('fps');
      return O;
    });
    for(const k in r)console.log(k+':',JSON.stringify(r[k]));

  }else if(scene==='models'){
    /* 九条转职支线的模型 + 攻击动作：每个 branch 截一张（英雄本阵区域放大） */
    await p.evaluate(()=>{const c=document.querySelectorAll('#cardRow .chcard');if(c.length)c[0].click();});
    await p.waitForTimeout(300);
    await p.evaluate(SEED);
    /* ① 转职卡片层：一张图看清一个职业的三条支线模型（3D 预览最大） */
    for(let i=0;i<3;i++){
      await p.evaluate(k=>{heroes.forEach(h=>{h.tier=0;h.branch=0;h.lv=8;calc(h);});
        closeCards();openAdvCards(heroes[k]);},i);
      await p.waitForTimeout(700);
      await shot('mc'+i+'_'+['warrior','archer','mage'][i]);
      console.log('转职卡',i,await p.evaluate(()=>[...document.querySelectorAll('#cardRow .chcard')].map(e=>e.textContent.slice(0,6)).join('/')));
    }
    await p.evaluate(()=>closeCards());
    /* ② 战场上的攻击动作：静止 / 出手各一张（贴脸放大） */
    const CLIP={x:182,y:118,width:118,height:126};
    for(let b=0;b<3;b++){
      await p.evaluate(br=>{
        heroes.forEach(h=>{h.tier=1;h.branch=br;h.specLv=3;calc(h);h.hp=h.maxHp;h.mp=h.maxMp;h.anim=0;});
        renderInfo();
      },b);
      await p.waitForTimeout(500);
      await shot('m'+b+'_idle',CLIP);
      // 动作峰值在 t=PEAK=.30，也就是 anim=animT*.70（三段曲线里命中的那一帧）
      await p.evaluate(()=>heroes.forEach(h=>{h.animT=animT(h);h.anim=h.animT*.70;}));
      await p.waitForTimeout(60);
      await shot('m'+b+'_atk',CLIP);
      console.log('branch',b,'=',await p.evaluate(()=>heroes.map(h=>ADV[h.cls][h.branch].name+'/animT='+animT(h)).join(' | ')));
    }

  }else{
    /* shot / crop */
    const clip=arg('clip','');
    await p.evaluate(()=>{const c=document.querySelectorAll('#cardRow .chcard');if(c.length)c[0].click();});
    await p.waitForTimeout(300);
    await p.evaluate(SEED);
    await p.waitForTimeout(600);
    const cl=clip?(([x,y,w,h])=>({x:+x,y:+y,width:+w,height:+h}))(clip.split(',')):null;
    await shot('s0_setup',cl);                        // 布阵：布局/建筑/法阵/传送门
    await p.evaluate(()=>{document.getElementById('launchBtn').click();});
    await p.waitForTimeout(3500);
    await shot('s1_fight',cl);                        // 战斗中：模型/特效/血条
    await p.evaluate(()=>{wave=12;trialCd.elite=0;startTrial('elite');});
    await p.waitForTimeout(3000);
    await shot('s2_trial',cl);                        // 精英试炼+宝箱
    // 底栏 UI：技能商店 2×2 + 背包两行（只截底栏那一条，省得看全屏）
    await p.evaluate(()=>{gold=99999;wood=99999;setShop('skill');buyPack('agi');buyEquip('low');renderInv();});
    await p.waitForTimeout(400);
    await shot('s3_bottom',{x:0,y:H-86,width:W,height:86});
    await p.evaluate(()=>setShop('item'));      // 装备商店：四档应排成 2×2
    await p.waitForTimeout(300);
    await shot('s4_eqshop',{x:0,y:H-86,width:W,height:86});
    await shot('s5_forge',{x:W-200,y:H-86,width:200,height:86});   // 熔炉那一角放大
    console.log('熔炉宽度/右边界/info右边界:',await p.evaluate(()=>{
      const f=document.querySelector('#info .forge').getBoundingClientRect();
      const i=document.getElementById('info').getBoundingClientRect();
      return [Math.round(f.width),Math.round(f.right),Math.round(i.right)];}));
    await p.evaluate(()=>setShop('skill'));       // 技能商店现在花木头
    await p.waitForTimeout(250);
    await shot('s6_skillshop',{x:0,y:H-86,width:W,height:86});
    await p.evaluate(()=>{closeShop();mobs.length=0;wave=9;startWave();});   // → 第10波 BOSS关
    await p.waitForTimeout(900);
    await shot('s7_boss',{x:0,y:0,width:W,height:120});                      // Boss总血条
    console.log('Boss关 只出1只/血量:',await p.evaluate(()=>[mobs.length,Math.round(mobs[0].maxHp)]));
    // 五种怪各来一只，看模型分工（步兵/长矛兵/狂徒/重甲兵/Boss）
    await p.evaluate(()=>{mobs.length=0;wave=8;
      ['normal','lancer','brute','tank','boss'].forEach((t,i)=>spawnMob(t,{lane:i%ROWS,dx:-i*3.2}));});
    await p.waitForTimeout(700);
    await shot('s8_mobs',{x:W*.34,y:60,width:W*.66,height:250});
    console.log('渲染开销 drawCalls/三角形/纹理:',await p.evaluate(()=>{
      const i=R3.info?R3.info():null;return i||'n/a';}));
    const fps=await p.evaluate(()=>new Promise(r=>{let n=0;const t0=performance.now();
      (function f(){n++;performance.now()-t0<2000?requestAnimationFrame(f):r((n/((performance.now()-t0)/1000)).toFixed(1));})();}));
    console.log('FPS(swiftshader软渲染，只看有没有崩，别当真机参考):',fps);
  }

  console.log('errors:',errs.length?errs.slice(0,6):'none');
  await b.close();
})();
