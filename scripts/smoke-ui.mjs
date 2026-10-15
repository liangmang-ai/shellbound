import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Local room callbacks exercise menu layout only. Real two-client networking is
// covered separately by test:coop; these fixtures do not represent WeChat API tests.
const bundle = await build({ entryPoints: ['src/app.js'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const js = bundle.outputFiles[0].text;
const html = `<!doctype html><html><meta charset="utf-8"><style>
html,body{margin:0;background:#14262c;overflow:hidden}canvas{display:block;width:100vw;height:100vh}
</style><canvas></canvas><script type="module">
import { createApp } from '/app.js';
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),fillText=ctx.fillText.bind(ctx);
window.__draws=[];
ctx.fillText=function(value,x,y,maxWidth){
  const text=String(value),m=this.measureText(text),t=this.getTransform(),r=canvas.getBoundingClientRect();
  const points=[[x-m.actualBoundingBoxLeft,y-m.actualBoundingBoxAscent],[x+m.actualBoundingBoxRight,y-m.actualBoundingBoxAscent],
    [x+m.actualBoundingBoxRight,y+m.actualBoundingBoxDescent],[x-m.actualBoundingBoxLeft,y+m.actualBoundingBoxDescent]]
    .map(([px,py])=>({x:r.x+(t.a*px+t.c*py+t.e)*r.width/canvas.width,y:r.y+(t.b*px+t.d*py+t.f)*r.height/canvas.height}));
  window.__draws.push({text,font:this.font,size:Number(/([\\d.]+)px/.exec(this.font)[1])*Math.hypot(t.a,t.b)*r.width/canvas.width,
    left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))});
  return fillText(value,x,y,...(maxWidth===undefined?[]:[maxWidth]));
};
let time=1000;
window.__render=()=>{window.__draws=[];window.__app.frame(time+=200);};
window.__app=createApp({canvas,width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,
  multiplayerFactory(options){window.__net=options;return {create(){},join(){},close(){},start(){},input(){},pause(){}};}});
window.__tap=label=>{
  const s=window.__app.getSnapshot(),b=s.buttons.find(b=>b.label===label||b.label.startsWith(label));
  if(!b)throw Error('Missing button '+label);
  const p={button:0,x:s.layout.ox+(b.x+b.w/2)*s.layout.scale,y:s.layout.oy+(b.y+b.h/2)*s.layout.scale};
  window.__app.handlePointer('down',p);window.__app.handlePointer('up',p);window.__render();
};
window.__room=(ready=false,guest=false)=>{
  window.__net.onRoom({code:'123456',playerId:guest?'p2':'p1',hostId:'p1',mapId:'greenhouse',difficultyId:'easy',phase:'waiting',
    players:[{id:'p1',connected:true},...(ready?[{id:'p2',connected:true}]:[])]});window.__render();
};
window.__render();
</script></html>`;
const server = http.createServer((request, response) => {
  response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : 'text/html;charset=utf-8');
  response.end(request.url === '/app.js' ? js : html);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
const viewports = [[640, 320], [740, 360], [844, 390], [932, 430], [1024, 768]];
const separate = (a, b, tolerance = 1) => a.right <= b.left + tolerance || b.right <= a.left + tolerance
  || a.bottom <= b.top + tolerance || b.bottom <= a.top + tolerance;
const close = (a, b, label) => assert.ok(Math.abs(a - b) <= .01, `${label}: ${a} differs from ${b}`);
const results = [];
const dprBaselines = new Map();
let browser;
try {
  await mkdir('artifacts', { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const [width, height] of viewports) for (const dpr of [1, 2, 3]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${port}`);
      await page.waitForFunction(() => window.__app);
      const tap = label => page.evaluate(label => window.__tap(label), label);
      const check = async state => {
        await page.evaluate(() => window.__render());
        const { draws, snapshot } = await page.evaluate(() => ({ draws: window.__draws, snapshot: window.__app.getSnapshot() }));
        const description = `${width}×${height}, DPR ${dpr}, ${state}`;
        assert.deepEqual(errors, [], `${description}: no browser exceptions`);
        assert.ok(draws.length > 0, `${description}: actual Canvas text was observed`);
        for (const draw of draws.filter(draw => draw.text.trim())) {
          assert.ok(draw.left >= -1 && draw.right <= width + 1 && draw.top >= -1 && draw.bottom <= height + 1,
            `${description}: text stays on screen: ${draw.text}`);
          assert.ok(Number.isFinite(draw.size) && draw.size > 0,
            `${description}: visible text retains a positive Canvas font size: ${draw.text}`);
          assert.ok(/^(?:(?:normal|bold|400|700) )?[\d.]+px sans-serif$/.test(draw.font),
            `${description}: native-compatible font shorthand: ${draw.text} (${draw.font})`);
          if (['开始突围   →', '创建房间', '输入房间码加入', '开始双人突围'].includes(draw.text)
            || state === 'menu' && draw.text === '双人合作') {
            assert.ok(draw.size >= 17.99, `${description}: main entry stays at least 18 screen pixels: ${draw.text}`);
          }
        }
        for (let i = 0; i < draws.length; i++) for (let j = i + 1; j < draws.length; j++) {
          assert.ok(separate(draws[i], draws[j]), `${description}: text overlap: ${draws[i].text} / ${draws[j].text}`);
        }
        const { scale, ox, oy } = snapshot.layout;
        const targets = snapshot.buttons.map(button => ({ label: button.label,
          left: ox + button.x * scale, top: oy + button.y * scale,
          right: ox + (button.x + button.w) * scale, bottom: oy + (button.y + button.h) * scale }));
        for (const draw of draws) {
          const target = targets.find(target => target.label === draw.text);
          if (!target) continue;
          assert.ok(draw.left >= target.left - 1 && draw.right <= target.right + 1
            && draw.top >= target.top - 1 && draw.bottom <= target.bottom + 1,
          `${description}: button caption stays inside its touch target: ${draw.text}`);
        }
        for (const target of targets) {
          assert.ok(target.left >= -.01 && target.right <= width + .01 && target.top >= -.01 && target.bottom <= height + .01,
            `${description}: touch target stays on screen: ${target.label}`);
          assert.ok(target.right > target.left && target.bottom > target.top,
            `${description}: ${target.label} retains a positive touch target`);
        }
        for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
          assert.ok(separate(targets[i], targets[j], .01), `${description}: touch overlap: ${targets[i].label} / ${targets[j].label}`);
        }
        const signature = { draws: draws.map(({ text, size }) => ({ text, size })), targets };
        const key = `${width}x${height}-${state}`;
        if (dpr === 1) dprBaselines.set(key, signature);
        else {
          const baseline = dprBaselines.get(key);
          assert.deepEqual(signature.draws.map(draw => draw.text), baseline.draws.map(draw => draw.text));
          assert.deepEqual(signature.targets.map(target => target.label), baseline.targets.map(target => target.label));
          signature.draws.forEach((draw, index) => close(draw.size, baseline.draws[index].size, `${description}: DPR-independent font ${draw.text}`));
          signature.targets.forEach((target, index) => {
            for (const edge of ['left', 'top', 'right', 'bottom']) close(target[edge], baseline.targets[index][edge], `${description}: DPR-independent hit ${target.label}/${edge}`);
          });
        }
        const screenshot = dpr === 1 && (width === 640 && ['menu', 'coop', 'join-filled', 'room-ready'].includes(state)
          || width === 844 && ['menu', 'coop', 'room-ready'].includes(state));
        const file = screenshot ? `artifacts/restored-ui-${width}x${height}-${state}.png` : undefined;
        if (file) await page.screenshot({ path: file });
        results.push({ width, height, dpr, state, file, ...signature });
      };
      await check('menu'); await tap('双人合作'); await check('coop');
      await tap('输入房间码加入'); await check('join');
      for (const digit of '123456') await tap(digit);
      await check('join-filled'); await tap('加入房间'); await check('connecting');
      await page.evaluate(() => window.__room()); await check('room-waiting');
      await page.evaluate(() => window.__room(true)); await check('room-ready');
      await page.evaluate(() => window.__room(true, true)); await check('room-guest');
      await page.evaluate(() => window.__net.onError('网络连接暂时中断，请检查网络后重新创建或加入房间'));
      await check('error');
      console.log(`UI passed: ${width}×${height}, DPR ${dpr}, 9 states`);
    } catch (error) {
      await page.screenshot({ path: `artifacts/restored-ui-failure-${width}x${height}-dpr${dpr}.png` });
      throw error;
    } finally { await page.close(); }
  }
  await writeFile('artifacts/restored-ui-metrics.json', JSON.stringify(results, null, 2));
  console.log(`Restored UI smoke passed: ${results.length} states, Canvas text and touch targets independent of DPR.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
