import { chromium } from '../tools/browser.js';
const browser = await chromium();
try {
 const p=await browser.newPage(); await p.setViewport({width:1280,height:720});
 p.on('pageerror', e=>console.log('ERROR',e.message));
 p.on('console', m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,500))});
 await p.goto('http://127.0.0.1:7777');
 await p.waitForFunction(()=>window.__game?.ready,{timeout:60000});
 await p.click('#btn-single');
 await new Promise(r=>setTimeout(r,1500));
 await p.evaluate(()=>{const g=window.__game;g.input.exitLock();g.input.mouseDX=0;g.input.mouseDY=0;g.pitch=0;g.yaw=Math.PI/2;});
 await new Promise(r=>setTimeout(r,500));
 await p.screenshot({path:'artifacts/play-check.png'});
 console.log(await p.evaluate(()=>({pose:[window.__game.yaw,window.__game.pitch],camera:window.__game.view.camera.position.toArray(),actors:window.__game.actors.actors.size,role:window.__game.targets.get(window.__game.myPlayerId)?.role,draw:window.__game.view.renderer.info.render})));
} finally {await browser.close()}
