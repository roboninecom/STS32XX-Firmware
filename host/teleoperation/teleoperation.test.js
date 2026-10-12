'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Teleoperation, mapPosition } = require('./Teleoperation');
const { Instruction } = require('../servo-driver');
const profile = {gravitySlewEffortPerS:1000,velocityFeedforward:{positiveGainQ8:0,negativeGainQ8:0,effortLimit:0},kpQ8:256,kdQ8:32,kiQ8:0,integralLimit:0,effortLimit:100,velocityFilterQ8:64};
function rig(protocol='legacy') {
  const calls = [], joints = [1,2].map(id => ({leaderId:id,followerId:id,mapping:'angle'}));
  const config = {protocol,joints,acceleration:10000,rampTimeMs:30,profiles:{1:profile,2:profile}};
  function servo(name) {
    const s = {bus:{discover:async()=>({ids:[1,2],alarms:new Map()})}, arm:{}, protocol:{}};
    s.protocol.read = async (id,address,length) => {
      const b = Buffer.alloc(length);
      if (address===0) {b.writeUInt16LE(100,9);b.writeUInt16LE(4000,11);b.writeUInt16LE(2050,56);}
      if(address===56) b.writeUInt16LE(2050);
      return b;
    };
    s.protocol.syncRead = async ids => ({responses:new Map(ids.map(id=>[id,Buffer.from([2,8])]))});
    s.protocol.write = async (id,address,data) => calls.push([name,'write',id,address,data]);
    s.protocol.syncWrite = async (address,entries) => calls.push([name,'sync',address,entries]);
    s.protocol.armCommand = async (id,instruction,payload) => calls.push([name,'arm',id,instruction,payload]);
    s.protocol.transaction = async fn => fn(s.protocol);
    s.arm.capabilities = async()=>({major:9,minor:0});
    for(const method of ['select','configure']) s.arm[method]=async(...args)=>calls.push([name,method,...args]);
    let sample=0;
    s.arm.feedback=async()=>({temperatureValid:true,temperatureValidated:30,
      sampleMs:++sample,sampleSequence:sample,ageMs:0,selected:true,armed:true,session:1,
      fresh:true,faults:0,driveEnabled:true,outputReady:true,acceptedSequence:1});
    return s;
  }
  const leader=servo('leader'),follower=servo('follower');
  let now=0;
  const t=new Teleoperation({leader,follower,config,clock:()=>now,sleep:async ms=>{now+=ms;}});
  return {t,leader,follower,calls,config,setTime:v=>{now=v;}};
}
test('stored limits map midpoint angles without stretching and gripper by range',()=>{
  const l={min:100,max:2100},f={min:400,max:1400};
  assert.equal(mapPosition(1100,l,f,{mapping:'angle'}),900);
  assert.equal(mapPosition(1300,l,f,{mapping:'angle'}),1100);
  assert.equal(mapPosition(1300,l,f,{mapping:'angle',direction:-1}),700);
  assert.equal(mapPosition(2100,l,f,{mapping:'angle'}),1400);
  assert.equal(mapPosition(1300,l,f,{mapping:'range'}),1000);
  assert.equal(mapPosition(2100,l,f,{mapping:'range',direction:-1}),400);
  assert.throws(()=>mapPosition(NaN,l,f,{mapping:'angle'}));
});
test('preflight reads limits without writes or factory extension probes',async()=>{
  const r=rig();r.leader.arm.capabilities=()=>{throw Error('Factory probe');};
  await r.t.preflight();assert.deepEqual(r.calls,[]);
  assert.equal(r.t.limits.follower[1].max,4000);
});
test('invalid stored limits and unexpected IDs fail before mutation',async()=>{
  const r=rig();r.leader.bus.discover=async()=>({ids:[1,2,3]});
  await assert.rejects(r.t.preflight(),/IDs/);assert.equal(r.calls.length,0);
  const x=rig();x.leader.protocol.read=async()=>Buffer.alloc(66);
  await assert.rejects(x.t.preflight(),/limits/);
});
test('extension uses saved bounds for mapping and rejects separate limits',async()=>{
  const r=rig('extension');await r.t.preflight();
  assert.equal(r.t.profiles[1].positionMinQ8,undefined);
  assert.equal(r.t.profiles[1].positionMaxQ8,undefined);
  assert.equal(r.t.profiles[1].velocityLimit,65535);
  const read=r.leader.protocol.syncRead;
  r.leader.protocol.syncRead=async ids=>({responses:new Map(ids.map(id=>[id,Buffer.from([0xff,0x7f])]))});
  assert((await r.t.sample()).targets.every(t=>t.position===4000));
  r.leader.protocol.syncRead=read;
  r.config.profiles[1]={...profile,positionMinQ8:200*256};
  await assert.rejects(r.t.preflight(),/removed.*legacy position limits/);
  assert.equal(r.calls.length,0);
});
test('missing extension gains fail instead of manufacturing tuning',async()=>{
  const r=rig('extension');delete r.config.profiles[2];
  await assert.rejects(r.t.preflight(),/Missing explicit/);assert.equal(r.calls.length,0);
});
test('startup refuses powered follower without switching it off',async()=>{
  const r=rig();await r.t.preflight();r.follower.protocol.read=async()=>Buffer.from([1]);
  await assert.rejects(r.t.initialize(),/already off/);assert.equal(r.calls.length,0);
});
for (const protocol of ['legacy', 'extension']) test(`${protocol}: startup follows a different pose without alignment`,async()=>{
  const r=rig(protocol);await r.t.preflight();
  r.follower.protocol.syncRead=async()=>({responses:new Map([[1,Buffer.from([0,4])],[2,Buffer.from([0,4])]])});
  let frames=0;
  await r.t.run({onFrame:()=>{frames++;},shouldStop:()=>frames===1});
  assert.equal(frames,1);
  if(protocol==='legacy') assert.equal(r.calls.find(c=>c[1]==='sync')[3][0].data.readUInt16LE(),2050);
  else {
    const writes=r.calls.filter(c=>c[1]==='arm'&&c[3]===Instruction.ARM_TARGETS);
    assert.equal(writes[0][4].readInt32LE(5),2050*256);
    assert(r.calls.some(c=>c[1]==='arm'&&c[3]===Instruction.ARM_TARGETS));
  }
});
test('asymmetric range mapping preserves explicit middle, endpoints and reversal',()=>{
  const l={min:100,max:4000},f={min:900,max:3500};
  const j={mapping:'range',leaderMiddle:2048,followerMiddle:2048};
  assert.equal(mapPosition(100,l,f,j),900);
  assert.equal(mapPosition(2048,l,f,j),2048);
  assert.equal(mapPosition(4000,l,f,j),3500);
  assert.equal(mapPosition(1074,l,f,j),1474);
  assert.equal(mapPosition(3024,l,f,j),2774);
  assert.equal(mapPosition(-10,l,f,j),900);
  assert.equal(mapPosition(5000,l,f,j),3500);
  assert.equal(mapPosition(100,l,f,{...j,direction:-1}),3500);
  assert.equal(mapPosition(4000,l,f,{...j,direction:-1}),900);
  assert.equal(mapPosition(2048,l,f,{...j,direction:-1}),2048);
  assert.throws(()=>mapPosition(2048,l,f,{...j,leaderMiddle:0}),/middle/);
});
test('legacy synchronized frames have zero speed/time and no leader writes',async()=>{
  const r=rig();await r.t.preflight();await r.t.initialize();await r.t.send(await r.t.sample());
  const sync=r.calls.find(c=>c[1]==='sync');assert.equal(sync[2],42);
  assert.equal(sync[3].length,2);assert.deepEqual([...sync[3][0].data.subarray(2)],[0,0,0,0]);
  assert(!r.calls.some(c=>c[0]==='leader'));
  assert(!r.calls.some(c=>c[1]==='write'&&c[3]<40));
});
test('extension broadcasts a complete frame with maximum speed',async()=>{
  const r=rig('extension');await r.t.preflight();await r.t.send(await r.t.sample());
  const c=r.calls.filter(c=>c[1]==='arm');assert.deepEqual(c.map(c=>c[3]),[Instruction.ARM_TARGETS]);
  assert.equal(c[0][4].readUInt16LE(9),65535);assert.equal(c[0][4].length,20);
  assert.equal(c[0][2],254);assert.equal(r.t.sequence,1);
});
test('frame aged while queued never reaches the bus',async()=>{
  const r=rig('extension');await r.t.preflight();const frame=await r.t.sample();
  r.follower.protocol.transaction=async fn=>{r.setTime(101);return fn(r.follower.protocol);};
  await assert.rejects(r.t.send(frame),/stale/);
  assert.equal(r.calls.length,0);assert.equal(r.t.sequence,0);
});
test('missing leader response rejects whole frame',async()=>{
  const r=rig();await r.t.preflight();r.leader.protocol.syncRead=async()=>({responses:new Map([[1,Buffer.from([0,8])]])});
  await assert.rejects(r.t.sample(),/Missing position/);assert.equal(r.calls.length,0);
});
test('sequence wraps through zero without starting a new session',async()=>{
  const r=rig('extension');await r.t.preflight();r.t.sequence=65534;
  const reported=[];
  for(const expected of [65535,0,1]) {
    await r.t.send(await r.t.sample());reported.push(r.t.sequence);
    const last=r.calls.at(-1);assert.equal(last[4].readUInt16LE(3),expected);
  }
  assert.deepEqual(reported,[65535,0,1]);assert.equal(r.t.session,1);
});
test('run failure turns off all owned followers',async()=>{
  const r=rig('extension');await r.t.preflight();r.follower.protocol.armCommand=async()=>{throw Error('lost response');};
  await assert.rejects(r.t.run(),/lost response/);
  assert.deepEqual(r.calls.filter(c=>c[1]==='write'&&c[3]===40&&c[4][0]===0).map(c=>c[2]),[1,2]);
});
test('torque-off cleanup attempts remaining joints after one write fails',async()=>{
  const r=rig('extension');r.t.prepared=new Set([1,2]);const seen=[];
  r.follower.protocol.write=async (id,address,data)=>{assert.equal(address,40);assert.equal(data[0],0);seen.push(id);if(id===1)throw Error('offline');};
  assert.equal((await r.t.disableTorque()).length,1);assert.deepEqual(seen,[1,2]);
});
test('normal exit holds current legacy position and never turns torque off',async()=>{
  const r=rig();await r.t.preflight();let frames=0;
  await r.t.run({onFrame:()=>{frames++;},shouldStop:()=>frames===1});
  assert.equal(frames,1);assert.equal(r.calls.filter(c=>c[1]==='sync').length,1);
  assert(!r.calls.some(c=>c[1]==='write'&&c[3]===40&&c[4][0]===0));
});
test('uncertain setup ACK is included in cleanup without enabling torque',async()=>{
  const r=rig('extension');await r.t.preflight();r.follower.arm.select=async(id,enabled)=>{if(enabled)throw Error('setup ACK lost');};
  await assert.rejects(r.t.run(),/setup ACK lost/);
  assert.equal(r.calls.filter(c=>c[1]==='write'&&c[3]===40&&c[4][0]===0).length,1);
  assert(!r.calls.some(c=>c[1]==='write'&&c[3]===40&&c[4][0]===1));
});
test('temperature and accepted sequence failures terminate monitoring',async()=>{
  const r=rig('extension');r.t.enabled.add(1);r.t.sequence=2;
  await assert.rejects(r.t.monitor(),/tracking/);
  r.follower.arm.feedback=async()=>({temperatureValid:true,temperatureRaw:30,temperatureValidated:60,ageMs:0});
  await assert.rejects(r.t.monitor(),/temperature/);
});
test('explicit follower rearm verifies torque off and never releases leader',async()=>{
  const r=rig('extension');await r.t.preflight();r.config.rearmPoweredFollower=true;
  const read=r.follower.protocol.read,write=r.follower.protocol.write;
  let torque=1;
  r.follower.protocol.read=async(id,address,length)=>address===40?Buffer.from([id===1?torque:0]):read(id,address,length);
  r.follower.protocol.write=async(id,address,data)=>{if(id===1&&address===40)torque=data[0];return write(id,address,data);};
  await r.t.initialize();
  assert.equal(torque,1);
  assert.equal(r.calls.filter(c=>c[1]==='write'&&c[3]===40&&c[4][0]===0).length,1);
  assert(!r.calls.some(c=>c[0]==='leader'));
});
test('extension startup never writes legacy goals that can auto-enable torque',async()=>{
  const r=rig('extension');await r.t.preflight();
  const write=r.follower.protocol.write;
  r.follower.protocol.write=async(id,address,data)=>{
    assert.notEqual(address,42,'legacy goals can auto-enable before extension selection');
    return write(id,address,data);
  };
  await r.t.initialize();assert.equal(r.t.prepared.size,2);
});
test('monitor exports one coherent normal feedback sample with timestamp',async()=>{
  const r=rig('extension');r.t.enabled.add(1);r.t.sequence=1;r.setTime(123);
  const samples=[];await r.t.monitor(x=>samples.push(x));
  assert.equal(samples.length,1);assert.equal(samples[0].id,1);
  assert.equal(samples[0].timestamp,123);assert.equal(samples[0].telemetry.acceptedSequence,1);
  assert.equal(samples[0].telemetry.temperatureValidated,30);
  assert.equal(samples[0].diagnostic,undefined);
});
test('broadcast transport failure leaves expected sequence unchanged',async()=>{
  const r=rig('extension');await r.t.preflight();
  r.follower.protocol.armCommand=async()=>{throw Error('transport disconnected');};
  await assert.rejects(r.t.send(await r.t.sample()),/transport disconnected/);
  assert.equal(r.t.sequence,0);
});
test('discovery mismatch identifies follower bus and missing responses',async()=>{
  const r=rig();r.follower.bus.discover=async()=>({ids:[]});
  await assert.rejects(r.t.preflight(),/Follower bus.*expected \[1,2\], found \[\]/);
});
for(const protocol of ['legacy','extension']) {
  test(`${protocol}: validated temperature below the limit passes the guard`,async()=>{
    const r=rig(protocol),feedback=r.follower.arm.feedback;
    r.follower.arm.feedback=async()=>({...await feedback(),temperatureValidated:35});
    await r.t.preflight();r.t.enabled.add(1);r.t.sequence=1;
    const samples=[];await r.t.monitor(x=>samples.push(x));
    assert.equal(samples[0].telemetry.temperatureValidated,35);
  });
  test(`${protocol}: invalid or hot validated temperature blocks preflight`,async()=>{
    const r=rig(protocol),feedback=r.follower.arm.feedback;
    r.follower.arm.feedback=async()=>({...await feedback(),temperatureValid:false});
    await assert.rejects(r.t.preflight(),/validated temperature unavailable/);
    r.follower.arm.feedback=async()=>({...await feedback(),temperatureValidated:60,ageMs:0});
    await assert.rejects(r.t.preflight(),/validated temperature guard/);
    assert.equal(r.calls.length,0);
  });
}
test('invalid validated telemetry stops runtime without raw fallback',async()=>{
  const r=rig('extension');r.t.enabled.add(1);
  r.follower.arm.feedback=async()=>({temperatureValid:false,temperatureRaw:20,temperatureValidated:20});
  await assert.rejects(r.t.monitor(),/validated temperature unavailable/);
});

test('monitor rejects stale or repeated samples and performs only one feedback read', async()=>{
  const r=rig('extension');r.t.enabled.add(1);r.t.sequence=1;
  const sample=await r.follower.arm.feedback();let reads=0;
  r.follower.arm.feedback=async()=>{reads++;return sample;};
  r.follower.protocol.read=async()=>{throw Error('Extra legacy read');};
  await r.t.monitor();assert.equal(reads,1);
  await assert.rejects(r.t.monitor(),/did not advance/);
  sample.ageMs=3;await assert.rejects(r.t.monitor(),/stale sensor/);
});

test('local velocity gains and gravity slew are part of each atomic configuration',async()=>{
  const r=rig('extension');
  r.config.profiles[1]={...profile,velocityFeedforward:{positiveGainQ8:100,negativeGainQ8:200,effortLimit:50}};
  await r.t.preflight();await r.t.initialize();
  const calls=r.calls.filter(c=>c[2]===1);
  assert(calls.findIndex(c=>c[1]==='configure')<calls.findIndex(c=>c[1]==='select'&&c[3]===true));
  const configured=calls.find(c=>c[1]==='configure')[3];
  assert.equal(configured.velocityFeedforward.effortLimit,50);
  assert.equal(configured.gravitySlewEffortPerS,1000);
  const x=rig('extension');x.config.profiles[1]={...profile,
    velocityFeedforward:{positiveGainQ8:1,negativeGainQ8:1,effortLimit:101}};
  await assert.rejects(x.t.preflight(),/effortLimit/);
});

test('v9 monitoring waits for the post-target capture without polling extra telemetry', async () => {
  const r=rig('extension'); await r.t.preflight(); r.t.enabled.add(1);
  const frame=await r.t.sample(); await r.t.send(frame);
  const read=r.follower.arm.feedback; let reads=0;
  r.follower.arm.feedback=async id=>{
    reads++;
    const s=await read(id);
    if(r.t.clock()<3) return {...s,acceptedSequence:0,fresh:false};
    return s;
  };
  await r.t.monitor();
  assert.equal(reads,1); assert.equal(r.t.clock(),3);
  assert.equal(r.calls.filter(c=>c[1]==='arm'&&c[3]===Instruction.ARM_TARGETS).length,1);
});

test('v9 rejected target remains a sequence failure after the publication interval', async () => {
  const r=rig('extension'); await r.t.preflight(); r.t.enabled.add(1);
  await r.t.send(await r.t.sample());
  const read=r.follower.arm.feedback;
  r.follower.arm.feedback=async id=>({...await read(id),acceptedSequence:0});
  await assert.rejects(r.t.monitor(),/tracking/);
  assert.equal(r.t.sequence,1); // Expected command identity is not rewritten to hide rejection.
});

test('generic extension waits for fresh ready output before its first target',async()=>{
  const r=rig('extension');await r.t.preflight();
  const read=r.follower.arm.feedback;
  r.follower.arm.feedback=async id=>({...await read(id),
    fresh:r.t.clock()>=20,outputReady:r.t.clock()>=20,driveEnabled:r.t.clock()>=20});
  await r.t.initialize();
  assert(r.t.clock()>=20);assert(!r.calls.some(c=>c[1]==='arm'&&c[3]===Instruction.ARM_TARGETS));
  await r.t.send(await r.t.sample());
  assert.equal(r.calls.filter(c=>c[1]==='arm'&&c[3]===Instruction.ARM_TARGETS).length,1);
});

test('output readiness timeout prevents all targets and still turns off owned axes',async()=>{
  const r=rig('extension');await r.t.preflight();const read=r.follower.arm.feedback;
  r.follower.arm.feedback=async id=>({...await read(id),fresh:false,outputReady:false});
  await assert.rejects(r.t.run(),/output readiness timeout/);
  assert(!r.calls.some(c=>c[1]==='arm'&&c[3]===Instruction.ARM_TARGETS));
  assert.equal(r.calls.filter(c=>c[1]==='write'&&c[3]===40&&c[4][0]===0).length,2);
});

test('normal extension exit retains the last target without cleanup commands',async()=>{
  const r=rig('extension');await r.t.preflight();let frames=0,lastCommandCount=0;
  await r.t.run({onFrame:()=>{frames++;lastCommandCount=r.calls.length;},shouldStop:()=>frames===1});
  assert.equal(frames,1);
  assert.equal(r.calls.length,lastCommandCount);
  assert(!r.calls.some(c=>c[1]==='write'&&c[3]===40&&c[4][0]===0));
  assert(!r.calls.some(c=>c[1]==='arm'&&[0x94,0x95].includes(c[3])));
  assert.equal(r.t.enabled.size,2);
});

test('host temperature protection still removes output from all owned followers',async()=>{
  const r=rig('extension');await r.t.preflight();
  const read=r.follower.arm.feedback;
  r.follower.arm.feedback=async id=>({...await read(id),temperatureValidated:r.t.clock()>250?60:30});
  await assert.rejects(r.t.run(),/temperature/);
  assert.deepEqual(r.calls.filter(c=>c[1]==='write'&&c[3]===40&&c[4][0]===0).map(c=>c[2]),[1,2]);
});

for (const interruptedDuring of ['sample', 'queued write']) {
  test(`normal extension interruption during ${interruptedDuring} retains the previous target`,async()=>{
    const r=rig('extension');await r.t.preflight();let frames=0;
    const read=r.leader.protocol.syncRead;
    r.leader.protocol.syncRead=async ids=>{
      const result=await read(ids);
      if(frames===1 && interruptedDuring==='sample') r.t.stopping=true;
      return result;
    };
    r.follower.protocol.transaction=async fn=>{
      if(frames===1 && interruptedDuring==='queued write') r.t.stopping=true;
      return fn(r.follower.protocol);
    };
    await r.t.run({onFrame:()=>{frames++;}});
    assert.equal(frames,1);
    assert.equal(r.t.sequence,1);
    assert.equal(r.calls.filter(c=>c[1]==='arm'&&c[3]===Instruction.ARM_TARGETS).length,1);
    assert(!r.calls.some(c=>c[1]==='write'&&c[3]===40&&c[4][0]===0));
  });
}


test('extension startup cannot override saved limits',async()=>{
  const r=rig('extension');await r.t.preflight();
  r.follower.protocol.syncRead=async ids=>({responses:new Map(ids.map(id=>[id,Buffer.from([0,0])]))});
  await assert.rejects(r.t.initialize(),/outside saved position limits/);
  assert(!r.calls.some(c=>c[1]==='write'&&c[3]===40&&c[4][0]===1));
  assert.throws(()=>new Teleoperation({leader:r.leader,follower:r.follower,
    config:{...r.config,startupBounds:{1:[0,4095]}}}),/startupBounds was removed/);
});


test('startup prepares all sessions before enabling and never calls a separate ARM',async()=>{
  const r=rig('extension');await r.t.preflight();await r.t.initialize();
  const setups=r.calls.filter(c=>c[1]==='select'&&c[3]===true);
  assert.deepEqual(setups.map(c=>[c[2],c[4]]),[[1,1],[2,1]]);
  const firstEnable=r.calls.findIndex(c=>c[1]==='write'&&c[3]===40&&c[4][0]===1);
  assert(setups.every(c=>r.calls.indexOf(c)<firstEnable));
  assert.equal(r.follower.arm.arm,undefined);
});

test('failed torque-enable startup is detected from feedback and cleared on every prepared axis',async()=>{
  const r=rig('extension');await r.t.preflight();
  const feedback=r.follower.arm.feedback;
  r.follower.arm.feedback=async()=>({...await feedback(),armed:false,session:0,fresh:false});
  await assert.rejects(r.t.run(),/startup ownership lost/);
  assert.deepEqual(r.calls.filter(c=>c[1]==='write'&&c[3]===40&&c[4][0]===0).map(c=>c[2]),[1,2]);
});
