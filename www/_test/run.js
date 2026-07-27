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
  const p=await b.newPage({viewport:{width:W,height:H},deviceScaleFactor:scene==='sim'?1:2});
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
    const fps=await p.evaluate(()=>new Promise(r=>{let n=0;const t0=performance.now();
      (function f(){n++;performance.now()-t0<2000?requestAnimationFrame(f):r((n/((performance.now()-t0)/1000)).toFixed(1));})();}));
    console.log('FPS(swiftshader软渲染，只看有没有崩，别当真机参考):',fps);
  }

  console.log('errors:',errs.length?errs.slice(0,6):'none');
  await b.close();
})();
