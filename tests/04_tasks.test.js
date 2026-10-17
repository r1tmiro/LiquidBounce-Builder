import {group,ok,eq} from './harness.js';
import {Sim,ROLE} from '../src/shared/sim/sim.js';
import {WiresGame,DivertGame,ScanGame,FuelGame,UploadGame,StartGame,UnlockGame,EmptyGame} from '../src/renderer/js/systems/tasks.js';

export function run() {
 group('All eight task minigames');
 const originalWindow=globalThis.window;
 globalThis.window={addEventListener(){},removeEventListener(){}};
 const ctx=new Proxy({}, {get:(o,k)=>k==='createLinearGradient'?()=>({addColorStop(){}}):()=>{},set:()=>true});
 const canvas={width:720,height:460,getContext:()=>ctx,addEventListener(){},removeEventListener(){}};
 const make=Cls=>new Cls(canvas,{},{});
 try {
  const wires=make(WiresGame);
  for(const wire of wires.left){wires.onDown(60,wire.y);wires.onDown(600,wires.right.find(w=>w.hex===wire.hex).y)}
  ok(wires.done,'wiring completes after five colour matches');wires.render();wires.dispose();
  const divert=make(DivertGame);
  divert.sliders.forEach((s,i)=>divert.setSlider(i,390-s.target*280));divert.check();
  ok(divert.done,'power sliders lock at their visible targets');divert.render();divert.dispose();
  const scan=make(ScanGame);for(let i=0;i<3;i++){scan.pos=scan.target;scan.attempt()}
  ok(scan.done,'scan requires three successful timings');scan.render();scan.dispose();
  const fuel=make(FuelGame);fuel.onDown();for(let i=0;i<100;i++)fuel.update(.05);
  ok(fuel.done,'fuel tank fills while held');fuel.render();fuel.dispose();
  const empty=make(EmptyGame);empty.onDown();for(let i=0;i<100;i++)empty.update(.05);
  ok(empty.done,'garbage chute empties while held');empty.render();empty.dispose();
  const upload=make(UploadGame);upload.glitchTimer=100;for(let i=0;i<240;i++)upload.update(.05);
  ok(upload.done,'data upload can finish');upload.render();upload.dispose();
  const start=make(StartGame);start.update(4);for(const n of start.seq)start.onDown(120+(n-1)*100,220);
  ok(start.done,'reactor sequence accepts the displayed order');start.render();start.dispose();
  const unlock=make(UnlockGame);unlock.onDown(220,220);unlock.onDown(500,220);
  ok(unlock.done,'both manifold levers unlock');unlock.render();unlock.dispose();
 } finally {globalThis.window=originalWindow}
 group('Task authority and vote safety');
 const sim=new Sim({seed:77});for(let i=0;i<5;i++)sim.addPlayer({name:'Safety'+i});sim.start();
 const p=[...sim.players.values()].find(p=>p.role===ROLE.CREW), task=p.tasks[0];
 p.x=task.pos[0];p.z=task.pos[2];
 sim.command(p.id,{type:'task',id:task.id,progress:1});ok(!task.done,'completion requires an opened task session');
 sim.command(p.id,{type:'taskBegin',id:task.id});
 sim.command(p.id,{type:'task',id:task.id,progress:NaN});eq(task.progress,0,'non-finite task progress is rejected');
 sim.command(p.id,{type:'task',id:task.id,progress:1});ok(task.done,'nearby assigned task may complete');
 const unfinished=p.tasks.find(t=>!t.done);
 if(unfinished){p.x=42;p.z=25;sim.command(p.id,{type:'taskBegin',id:unfinished.id});sim.command(p.id,{type:'task',id:unfinished.id,progress:1});ok(!unfinished.done,'remote task completion is rejected')}
 sim.startMeeting('emergency',p.id,null);
 const target=[...sim.players.values()].find(t=>t.id!==p.id);
 sim.cmdVote(p,{target:target.id});sim.cmdVote(p,{target:null});
 eq(sim.meeting.votes.get(p.id),target.id,'one ballot per player');
 target.alive=false;sim.cmdVote(target,{target:p.id});ok(!sim.meeting.votes.has(target.id),'dead players cannot vote');
}
