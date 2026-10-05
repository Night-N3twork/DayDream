// Local-only acceptance harness: real host controllers, service worker, engine
// hooks and built Space application. No Wisp or public deployment is involved.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { rolldown } from 'rolldown';

const root = process.cwd();
const mime = file => ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' }[extname(file)] || 'application/octet-stream');
const nativeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><foreignObject width="100%" height="100%"><iframe xmlns="http://www.w3.org/1999/xhtml" id="space" style="width:100%;height:100%;border:0" src="./index.html?view=games"></iframe></foreignObject><script><![CDATA[window.__svgScript=true;]]></script></svg>';
const outcomes = [];
// Use Nebula's actual self-contained Base32 configuration, not a stand-in codec.
const loader = readFileSync('Nebula/src/components/settings/Loader.astro', 'utf8').replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
const ast = ts.createSourceFile('loader.ts', loader, ts.ScriptTarget.Latest, true);
let nebulaCodec;
function findCodec(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'codec') nebulaCodec = node.initializer.getText(ast);
  ts.forEachChild(node, findCodec);
}
findCodec(ast);
assert.ok(nebulaCodec);
const codecStatement = ts.transpileModule(`const codec=${nebulaCodec};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const injectorBuild = await rolldown({ input: resolve(root, 'src/apis/scriptInjection/index.ts') });
const injectorOutput = await injectorBuild.generate({ format: 'iife', name: 'FixtureInjector' });
const injectorCode = injectorOutput.output.find(chunk => chunk.type === 'chunk').code;
await injectorBuild.close();

for (const host of ['Nebula', 'Daydream']) {
  const requests = [];
  const errors = [];
  const workers = [];
  const physicalNavigations = [];
  const controllerDir = host === 'Daydream' ? 'src/core/SJ/controller/dist' : 'Nebula/node_modules/@mercuryworkshop/scramjet-controller/dist';
  const bridgeDir = host === 'Daydream' ? 'src/apis/proxyContext/generated' : 'Nebula/src/utils/proxyContext-generated';
  const fileRoutes = {
    '/engine.js': 'node_modules/@mercuryworkshop/scramjet/dist/scramjet.js',
    '/engine.wasm': 'node_modules/@mercuryworkshop/scramjet/dist/scramjet.wasm',
    '/api.js': `${controllerDir}/${host === 'Daydream' ? 'api.js' : 'controller.api.js'}`,
    '/inject.js': `${controllerDir}/${host === 'Daydream' ? 'inject.js' : 'controller.inject.js'}`,
    '/controller-sw.js': `${controllerDir}/${host === 'Daydream' ? 'sw.js' : 'controller.sw.js'}`,
    '/bridge.js': `${bridgeDir}/proxy-context-adapter.js`,
    '/obscura.js': 'src/pkgs/Obscura/dist/obscura.iife.js'
  };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://fixture/').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (fileRoutes[path]) {
      const file = resolve(root, fileRoutes[path]); res.setHeader('Content-Type', mime(file)); res.end(readFileSync(file)); return;
    }
    if (path === '/sw.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(`importScripts('/controller-sw.js');addEventListener('fetch',e=>{if($scramjetController.shouldRoute(e))e.respondWith($scramjetController.route(e))});`); return;
    }
    if (path.startsWith('/source/')) {
      const url = new URL(decodeURIComponent(path.slice('/source/'.length))); requests.push(url.href);
      if (url.pathname === '/index.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end(nativeSvg); return; }
      if (url.hostname === 'game.example') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head></head><body><h1 id="game-ready">controlled game</h1></body></html>'); return; }
      if (url.pathname === '/probe.txt') { res.setHeader('Content-Type', 'text/plain'); res.end('document-fetch-through-host'); return; }
      if (url.hostname === 'space.example') {
        const file = resolve(root, 'Space-v2/dist', url.pathname.slice(1) || 'index.html');
        if (file.startsWith(resolve(root, 'Space-v2/dist') + '/') && existsSync(file)) { res.setHeader('Content-Type', mime(file)); res.end(readFileSync(file)); return; }
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('fixture resource unavailable'); return;
    }
    if (path === '/raw') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body>raw child</body></html>'); return; }
    if (path === '/existing-injector.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(injectorCode); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><head><script src="/engine.js"></script><script src="/api.js"></script><script src="/bridge.js"></script>${host === 'Daydream' ? '<script src="/obscura.js"></script><script src="/existing-injector.js"></script>' : ''}</head><body><iframe id="outer" style="width:100%;height:90vh"></iframe><iframe id="raw" src="/raw"></iframe><script>
    (async()=>{
      const reg=await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
      if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));
      window.transportRequests=[];
      const nativeFetch=fetch.bind(window);
      const transport={ready:true,init:async()=>{},connect:()=>{throw Error('No Wisp in fixture')},request:async(url,method,body,headers)=>{
        transportRequests.push(url.href);const response=await nativeFetch('/source/'+encodeURIComponent(url.href));
        return {body:await response.arrayBuffer(),headers:[...response.headers],status:response.status,statusText:response.statusText};
      }};
      ${host === 'Daydream' ? 'const codec={encode:__obscura.encode,decode:__obscura.decode};' : codecStatement}
      window.controller=new $scramjetController.Controller({serviceworker:reg.active,transport,config:{prefix:'/proxy/',scramjetPath:'/engine.js',wasmPath:'/engine.wasm',injectPath:'/inject.js',codec}});
      ${host === 'Daydream' ? `FixtureInjector.scriptInjectionRegistry.register({id:'task3-existing',match:()=>true,scripts:[{kind:'inline',code:'window.__existingInjector=true;'}]});FixtureInjector.installScriptInjector(controller);` : ''}
      window.disposeAdapter=SpaceProxyContext.installScramjetProxyContext(controller,await (await nativeFetch('/bridge.js')).text());
      await controller.wait();window.frame=controller.createFrame(document.getElementById('outer'));
      window.hookEvidence=[];
      $scramjet.Tap.tap(frame.hooks.init.post,({window:w,client})=>hookEvidence.push({url:client.meta.origin.href,early:!!w[Symbol.for('proxy-context-v1.document')],ready:w[Symbol.for('proxy-context-v1.document')]?.ready}));
      frame.go('https://space.example/index.svg'); window.hostReady=true;
    })().catch(e=>window.hostError=String(e));
    </script></body></html>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  page.context().on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  page.on('request', request => { if (request.isNavigationRequest()) physicalNavigations.push(request.url()); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.hostReady || window.hostError, { timeout: 30_000 });
    assert.equal(await page.evaluate(() => window.hostError), undefined);
    // Do not poll contentWindow from the hooked outer realm while the child is
    // loading: that accessor legitimately hooks an early blank subcontext and
    // changes the engine bootstrap path. Observe frame navigation natively.
    let appFrame;
    for (let attempt = 0; attempt < 100; attempt++) {
      appFrame = page.frames().find(frame => frame.parentFrame()?.parentFrame() === page.mainFrame());
      if (appFrame) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(appFrame, 'real HTML child navigated');
    await appFrame.waitForFunction(() => window.proxy?.mode === 'delegated');
    const evidence = await page.evaluate(async () => {
      const outer = document.getElementById('outer').contentWindow;
      const app = outer.document.getElementById('space').contentWindow;
      const game = app.document.createElement('iframe'); app.document.body.appendChild(game);
      await app.proxy.navigate(game,'https://game.example/game');
      const fetched = await app.proxy.fetch('https://space.example/probe.txt');
      return {mode:app.proxy.mode,local:!!app.proxy.local,fetched,gameSrc:game.src,outerMime:outer.document.contentType,svgScript:outer.__svgScript,
        rawAsserted:!!document.getElementById('raw').contentWindow[Symbol.for('proxy-context-v1.document')],existingInjector:app.__existingInjector,hooks:hookEvidence,requests:transportRequests};
    });
    assert.equal(evidence.mode, 'delegated'); assert.equal(evidence.local, false);
    assert.equal(evidence.outerMime, 'text/html'); assert.equal(evidence.rawAsserted, false);
    assert.equal(evidence.svgScript, true);
    assert.equal(evidence.fetched, 'document-fetch-through-host');
    assert.ok(evidence.hooks.some(h => h.url.includes('/index.html') && h.early && h.ready));
    if (host === 'Daydream') assert.equal(evidence.existingInjector, true);
    await page.waitForFunction(() => transportRequests.includes('https://game.example/game'));
    const rewrittenGame = await page.evaluate(urls => urls.some(url => {
      const parsed=new URL(url);
      return parsed.pathname.startsWith(frame.prefix) && controller.config.codec.decode(parsed.pathname.slice(frame.prefix.length))==='https://game.example/game';
    }), physicalNavigations);
    assert.ok(rewrittenGame,'game navigation has exactly the owning host frame prefix and decodes to the original URL');
    assert.ok(!evidence.requests.some(url => /space\.example\/(?:w\/|b\/|c\/|u\/config|sw\.js)/.test(url)), 'Space local proxy assets/transport must not start');
    assert.deepEqual(workers, [], 'Space does not construct a worker in delegated mode');
    assert.deepEqual(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(reg=>new URL(reg.active.scriptURL).pathname)), ['/sw.js']);
    await page.evaluate(() => {
      window.oldOuterWindow=document.getElementById('outer').contentWindow;
      window.oldOuterDocument=oldOuterWindow.document;
      window.oldOuterState=oldOuterWindow[Symbol.for('proxy-context-v1.document')];
      const app = document.getElementById('outer').contentDocument.getElementById('space').contentWindow;
      window.oldRuntime=app.proxy; window.oldTarget=app.document.createElement('iframe');
      frame.go('https://space.example/index.svg');
    });
    let navigated = false;
    for (let attempt=0; attempt<150; attempt++) {
      const next=page.frames().find(frame=>frame.parentFrame()?.parentFrame()===page.mainFrame());
      if (next && next !== appFrame && await next.evaluate(()=>window.proxy?.mode==='delegated').catch(()=>false)) { navigated=true; break; }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(navigated,'new document independently renegotiates');
    assert.ok(await page.evaluate(async()=>{try{await oldRuntime.navigate(oldTarget,'https://game.example/stale');return false;}catch{return true;}}),'old document session is invalidated by real navigation');
    // Native A-to-B navigation really replaces the inner Window/document while
    // retaining this WindowProxy. Only lifecycle events are synthetic here;
    // both generations received authentic engine init.pre/init.post callbacks.
    const generationRestore = await page.evaluate(() => {
      const win=document.getElementById('outer').contentWindow;
      const state=win[Symbol.for('proxy-context-v1.document')];
      const initiallyReady=state.ready;
      win.dispatchEvent(new win.PageTransitionEvent('pagehide',{persisted:true}));
      const hiddenReady=state.ready;
      win.dispatchEvent(new win.PageTransitionEvent('pageshow',{persisted:true}));
      return {sameWindowProxy:win===oldOuterWindow,newDocument:win.document!==oldOuterDocument,newState:state!==oldOuterState,
        previousStateDisposed:oldOuterState.disposed,initiallyReady,hiddenReady,restoredReady:state.ready};
    });
    assert.equal(generationRestore.sameWindowProxy,true);
    assert.equal(generationRestore.newDocument,true);
    assert.equal(generationRestore.newState,true);
    assert.equal(generationRestore.previousStateDisposed,true);
    assert.equal(generationRestore.initiallyReady,true);
    assert.equal(generationRestore.hiddenReady,false);
    assert.equal(generationRestore.restoredReady,true,'second native document generation revalidates on persisted pageshow');
    await page.evaluate(() => disposeAdapter());
    const disposedRestoreReady = await page.evaluate(() => {
      const win=document.getElementById('outer').contentWindow;
      win.dispatchEvent(new win.PageTransitionEvent('pageshow',{persisted:true}));
      return win[Symbol.for('proxy-context-v1.document')].ready;
    });
    assert.equal(disposedRestoreReady,false,'disposed generation cannot be revived by persisted pageshow');
    const rejected = await page.evaluate(async () => {
      const app = document.getElementById('outer').contentDocument.getElementById('space').contentWindow;
      try { await app.proxy.navigate(app.document.createElement('iframe'),'https://game.example/lost'); return false; } catch {return true;}
    });
    assert.ok(rejected, 'lost session blocks navigation');
    outcomes.push({ host, passed: true, evidence, generationRestore, disposedRestoreReady, requests, workers, physicalNavigations, errors });
  } catch (error) {
    outcomes.push({ host, passed: false, error: String(error), hostError: await page.evaluate(() => window.hostError).catch(() => null), hooks: await page.evaluate(() => window.hookEvidence).catch(() => null), frames: await page.evaluate(() => {
      const result=[]; const visit=w=>{try{const c=w[$scramjet.SCRAMJETCLIENT];const originalFrame=c?.descriptors.get('window.frameElement',w);result.push({url:w.location.href,mode:w.proxy?.mode,ready:w[Symbol.for('proxy-context-v1.document')]?.ready,client:!!c,frame:!!w.frameElement?.[Symbol.for('controller frame handle')],originalFrame:!!originalFrame,originalControlled:!!originalFrame?.[Symbol.for('controller frame handle')],globalSame:c?.global.window===w});for(let i=0;i<w.frames.length;i++)visit(w.frames[i]);}catch(e){result.push(String(e));}};visit(window);return result;
    }).catch(() => null), requests, errors });
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
}
console.log(JSON.stringify(outcomes, null, 2));
if (outcomes.some(result => !result.passed)) process.exitCode = 1;
