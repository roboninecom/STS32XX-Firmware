'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ArmCodec, ArmExtension, Instruction, PacketEncoder,
  RequestScheduler, StsProtocol } = require('..');

const ffOff = {positiveGainQ8:0,negativeGainQ8:0,effortLimit:0};
const settings = {gravitySlewEffortPerS:1000,velocityFeedforward:ffOff};
const encodeOne = target => ArmCodec.encodeTargets([{id:2,target}],9);

class FakeTransport extends EventEmitter {
  constructor() { super(); this.writes = []; }
  async write(packet) {
    this.writes.push(Buffer.from(packet));
    if (packet[2] !== 0xFE) {
      const length = packet[4] === Instruction.ARM_READ ? packet[6] : 0;
      const payload = Buffer.alloc(1 + length);
      this.emit('data', PacketEncoder.frame(packet[2], 0, payload));
    }
  }
}

test('arm command uses extension framing and status byte', async () => {
  const transport = new FakeTransport();
  const protocol = new StsProtocol(new RequestScheduler(transport),
    { baudRate: 1_000_000 });
  const data = await protocol.armCommand(2, Instruction.ARM_READ,
    Buffer.from([0x90, 8]), { expectedDataLength: 8 });
  assert.equal(data.length, 8);
  assert.equal(transport.writes[0][4], Instruction.ARM_READ);
  assert.deepEqual([...transport.writes[0].subarray(5, 7)], [0x90, 8]);
  await protocol.armCommand(0xFE, Instruction.ARM_TARGETS, Buffer.from([7, 0]));
  assert.equal(transport.writes[1][2], 0xFE);
  assert.equal(transport.writes[1][4], Instruction.ARM_TARGETS);
});

test('configuration matches the firmware little-endian test vector', () => {
  const bytes = ArmCodec.encodeConfig({
    ...settings, kpQ8: 256, kdQ8: 0, kiQ8: 0, integralLimit: 0,
    effortLimit: 700, velocityLimit: 5000, accelerationLimit: 30000,
    velocityFilterQ8: 64, rampTimeMs: 30,
  });
  assert.equal(bytes.toString('hex'),
    '0001000000000000bc0288133075401e000000000000e803');
  assert.throws(() => ArmCodec.encodeConfig({
    ...ArmCodec.decodeConfig(bytes), accelerationLimit:30001}),
  /accelerationLimit/);
});

test('ramp time is explicit and bounded in base configuration', () => {
  const config = {...settings,kpQ8:256,kdQ8:0,kiQ8:0,integralLimit:0,effortLimit:100,
    velocityLimit:1000,accelerationLimit:1000,velocityFilterQ8:64,};
  for(const rampTimeMs of [undefined,0,256,1.5])
    assert.throws(()=>ArmCodec.encodeConfig({...config,rampTimeMs}),/rampTimeMs/);
  for(const rampTimeMs of [1,30,255])
    assert.equal(ArmCodec.decodeConfig(ArmCodec.encodeConfig({...config,rampTimeMs})).rampTimeMs,rampTimeMs);
});

test('targets contain only identity, position and speed', () => {
  const target={sequence:1,positionQ8:-6400,speedLimit:1200};
  assert.equal(encodeOne(target).toString('hex'),'090002010000e7ffffb004');
  for(const acceleration of [0,3000,30001])
    assert.throws(()=>encodeOne({...target,acceleration}),/acceleration/);
  assert.throws(()=>encodeOne({...target,braking:0}),/braking/);
  assert.equal(encodeOne({...target,sequence:0}).readUInt16LE(3),0);
});

test('group targets use one broadcast with no staging or start', async () => {
  const calls=[];
  const wire={ armCommand: async (id,instruction,params) => {
    calls.push({id,instruction,params:Buffer.from(params)});
    return Buffer.alloc(0);
  } };
  const bus={ has:id => id===1 || id===2,
    protocol:wire };
  const arm=new ArmExtension(bus);
  arm.capabilities=async()=>({major:9,minor:0});
  const target=id => ({sequence:1,positionQ8:id*256,
    speedLimit:100});
  await arm.setTargets([
    {id:1,target:target(1)},{id:2,target:target(2)}],9);
  assert.deepEqual(calls.map(c=>[c.id,c.instruction]),
    [[0xFE,Instruction.ARM_TARGETS]]);
  assert.equal(calls[0].params.length,20);
  assert.equal(calls[0].params[2],1);assert.equal(calls[0].params[11],2);
});

test('expired queued arm packet is rejected before reaching the bus', async () => {
  let release;
  const transport = new FakeTransport();
  transport.write = async packet => {
    transport.writes.push(Buffer.from(packet));
    await new Promise(resolve => { release = resolve; });
  };
  const scheduler = new RequestScheduler(transport);
  const first = scheduler.send(Buffer.from([1]));
  const second = scheduler.send(Buffer.from([2]), { deadlineMs: 1 });
  const secondRejected = assert.rejects(second, /expired before transmission/);
  await new Promise(resolve => setTimeout(resolve, 10));
  release();
  await first;
  await secondRejected;
  assert.equal(transport.writes.length, 1);
});

test('persistent gravity shares C vector and rejects removed dynamic compensation', async () => {
  const command={session:0x1235,sequence:1,gravityEffort:-70};
  assert.equal(ArmCodec.encodeGravity(command).toString('hex'),'35120100baff');
  assert.equal(ArmCodec.encodeGravity({...command,sequence:0}).readUInt16LE(2),0);
  for(const patch of [{sequence:65536},{ttlMs:501},{slewEffortPerS:0},{gravityEffort:1001},{dynamicEffort:0}])
    assert.throws(()=>ArmCodec.encodeGravity({...command,...patch}));
  let major=1;const calls=[];
  const arm=new ArmExtension({has:()=>true,protocol:{armCommand:async(id,op,b)=>{
    if(op===Instruction.ARM_READ&&b[0]===0x90)return Buffer.from([65,82,77,67,major,0,0,1]);
    calls.push([op,b.toString('hex')]);return Buffer.alloc(0);
  }}});
  await assert.rejects(arm.updateGravity(2,command),/v9/);assert.equal(calls.length,0);
  major=9;await arm.capabilities(2);await arm.updateGravity(2,command);
  assert.deepEqual(calls,[[0x99,'35120100baff']]);
  assert.equal(arm.updateFeedforward,undefined);
  assert.equal(arm.compact,undefined);
});

test('short extension read rejection reports status instead of a response timeout', async () => {
  const transport = new FakeTransport();
  transport.write = async packet => {
    transport.emit('data', PacketEncoder.frame(packet[2], 0, Buffer.from([1])));
  };
  const protocol = new StsProtocol(new RequestScheduler(transport));
  await assert.rejects(protocol.armCommand(2, Instruction.ARM_READ,
    Buffer.from([0xA0, 23]), { expectedDataLength: 23, timeoutMs: 20 }), error => {
    assert.equal(error.name, 'InvalidPacketError');
    assert.deepEqual(error.details, { id: 2, instruction: Instruction.ARM_READ, extensionStatus: 1 });
    return true;
  });
});

test('short success and another servo rejection cannot satisfy an extension read', async () => {
  const transport = new FakeTransport();
  transport.write = async packet => {
    transport.emit('data', PacketEncoder.frame(3, 0, Buffer.from([2])));
    transport.emit('data', PacketEncoder.frame(packet[2], 0, Buffer.from([0])));
    transport.emit('data', PacketEncoder.frame(packet[2], 0, Buffer.from([0, 42, 43])));
  };
  const protocol = new StsProtocol(new RequestScheduler(transport));
  const data = await protocol.armCommand(2, Instruction.ARM_READ,
    Buffer.from([0x90, 2]), { expectedDataLength: 2 });
  assert.deepEqual([...data], [42, 43]);
});

test('extension rejection matching leaves legacy read lengths strict', async () => {
  const transport = new FakeTransport();
  transport.write = async packet => {
    transport.emit('data', PacketEncoder.frame(packet[2], 0, Buffer.from([2])));
    transport.emit('data', PacketEncoder.frame(packet[2], 0, Buffer.from([42, 43])));
  };
  const protocol = new StsProtocol(new RequestScheduler(transport));
  assert.deepEqual([...(await protocol.read(2, 56, 2))], [42, 43]);
  for (const expectedDataLength of [-1, 81, 1.5, NaN]) {
    await assert.rejects(protocol.armCommand(2, Instruction.ARM_READ,
      Buffer.from([0x90, 16]), { expectedDataLength }), /Expected arm data length/);
  }
});

test('one configuration validates all settings and verifies RAM readback', async () => {
  const config={...settings,kpQ8:256,kdQ8:0,kiQ8:0,integralLimit:0,effortLimit:300,
    velocityLimit:1000,accelerationLimit:1000,velocityFilterQ8:64,rampTimeMs:30,
    velocityFeedforward:{positiveGainQ8:256,negativeGainQ8:512,effortLimit:120}};
  assert.equal(ArmCodec.encodeConfig(config).subarray(16).toString('hex'),'000100027800e803');
  for(const velocityFeedforward of [undefined,{positiveGainQ8:1,negativeGainQ8:0,effortLimit:0},
    {...config.velocityFeedforward,effortLimit:301}])
    assert.throws(()=>ArmCodec.encodeConfig({...config,velocityFeedforward}),RangeError);
  for(const gravitySlewEffortPerS of [undefined,0,10001])
    assert.throws(()=>ArmCodec.encodeConfig({...config,gravitySlewEffortPerS}),/gravitySlew/);
  let saved,corrupt=false;
  const arm=new ArmExtension({has:()=>true,protocol:{armCommand:async(id,op,b)=>{
    if(op===Instruction.ARM_WRITE){assert.equal(b[0],0xA0);saved=Buffer.from(b.subarray(1));}
    else {assert.deepEqual([...b],[0xA0,24]);const r=Buffer.from(saved);if(corrupt)r[16]^=1;return r;}
  }}});
  arm.capabilities=async()=>({major:9,minor:0});
  assert.deepEqual(await arm.configure(2,config),config);
  corrupt=true;await assert.rejects(arm.configure(2,config),/verification/);
});

test('feedback and tuning decode signed fields, health and identity from one packet', async () => {
  const b=Buffer.alloc(54);
  b.writeUInt32LE(0xfffffffe);b.writeUInt16LE(65535,4);b.writeUInt16LE(7,6);
  b.writeUInt16LE(9,8);b.writeUInt16LE(11,10);b.writeUInt16LE(0x55bb,12);
  b.writeInt32LE(-6400,14);b.writeInt32LE(-51200,18);b.writeInt16LE(-970,22);
  b.writeInt16LE(-123,24);b[26]=120;b[27]=35;b[28]=4;b[29]=0;b.writeUInt16LE(2,30);
  b.writeInt32LE(25600,32);b.writeInt32LE(51200,36);
  [-1000,300,-200,100,-70,80].forEach((v,i)=>b.writeInt16LE(v,40+i*2));
  b.writeUInt16LE(65535,52);
  const feedback=ArmCodec.decodeFeedback(b.subarray(0,32)),tuning=ArmCodec.decodeTuning(b);
  for(const [key,value] of Object.entries(feedback))assert.equal(tuning[key],value);
  assert.equal(feedback.measuredPositionQ8,-6400);assert.equal(feedback.ageMs,2);
  assert.equal(feedback.sampleMs,0xfffffffe);assert.equal(feedback.session,7);
  assert.equal(feedback.acceptedSequence,9);assert.equal(feedback.gravitySequence,11);
  assert.equal(feedback.appliedEffort,-970);assert.equal(feedback.currentAdcDelta,-123);
  assert.equal(feedback.temperatureValidated,35);assert(feedback.temperatureValid);
  assert.equal(tuning.referencePositionQ8,25600);assert.equal(tuning.referenceVelocityQ8PerS,51200);
  assert.equal(tuning.gravityEffort,-70);assert.equal(tuning.velocityFeedforward,80);
  assert.equal(tuning.transitionBias,undefined);assert.equal(feedback.activeProfile,undefined);assert.equal(tuning.overrunCount,65535);
  assert.throws(()=>ArmCodec.decodeFeedback(b),/32/);
  assert.throws(()=>ArmCodec.decodeTuning(Buffer.alloc(56)),/54/);
  const reserved=Buffer.from(b.subarray(0,32));reserved[29]=1;
  assert.throws(()=>ArmCodec.decodeFeedback(reserved),/Reserved/);
  assert.throws(()=>ArmCodec.decodeTuning(b.subarray(0,53)),/54/);
  const calls=[];
  const arm=new ArmExtension({has:()=>true,protocol:{armCommand:async(id,op,p)=>{
    calls.push([...p]);return b.subarray(0,p[1]);
  }}});
  arm.capabilities=async()=>({major:9,minor:0});
  await arm.feedback(2);await arm.tuning(2);
  assert.deepEqual(calls,[[0xc1,32],[0xc2,54]]);
  b.writeUInt16LE(0x400,12);
  const sensorOnly=ArmCodec.decodeFeedback(b.subarray(0,32));
  assert(sensorOnly.temperatureValid && !sensorOnly.fresh && !sensorOnly.armed);
});

test('obsolete motion FF fields are rejected instead of silently ignored', () => {
  const target={sequence:1,positionQ8:0,speedLimit:100};
  assert.throws(()=>encodeOne({...target,feedforward:0}),/removed/);
});

test('capability cache invalidates on discovery, disconnect and reset', async () => {
  const transport=new EventEmitter(),protocol=new EventEmitter(),bus=new EventEmitter();
  let reads=0;
  protocol.scheduler={transport};protocol.armCommand=async(id,op,b)=>{
    if(b[0]===0x90){reads++;return Buffer.from([65,82,77,67,9,0,0,1]);}
    return Buffer.alloc(32);
  };
  bus.protocol=protocol;bus.has=()=>true;
  const arm=new ArmExtension(bus);
  await arm.feedback(2);await arm.feedback(2);assert.equal(reads,1);
  transport.emit('disconnect');await arm.feedback(2);assert.equal(reads,2);
  bus.emit('discovery');await arm.feedback(2);assert.equal(reads,3);
  protocol.emit('reset',2);await arm.feedback(2);assert.equal(reads,4);
  arm.invalidate();await arm.feedback(2);assert.equal(reads,5);
});

test('mixed-version coordinated targets fail before any write', async () => {
  let writes=0;
  const arm=new ArmExtension({has:()=>true,protocol:{armCommand:()=>{writes++;}}});
  arm.capabilities=async id=>({major:id===1?9:8,minor:0});
  const target={sequence:1,positionQ8:0,speedLimit:100};
  await assert.rejects(arm.setTargets([{id:1,target},{id:2,target}],1),/v9/);
  assert.equal(writes,0);
});

test('concurrent capability probes do not invalidate each other', async () => {
  const arm=new ArmExtension({has:()=>true,protocol:{armCommand:async()=>{
    await new Promise(resolve=>setImmediate(resolve));
    return Buffer.from([65,82,77,67,9,0,0,1]);
  }}});
  const capabilities=await Promise.all([arm.capabilities(1),arm.capabilities(2)]);
  assert(capabilities.every(c=>c.major===9));
});

test('disconnect during discovery cannot populate the capability cache', async () => {
  const transport=new EventEmitter();let resolve;
  const arm=new ArmExtension({has:()=>true,protocol:{scheduler:{transport},
    armCommand:()=>new Promise(done=>{resolve=done;})}});
  const discovery=arm.capabilities(2);
  transport.emit('disconnect');
  resolve(Buffer.from([65,82,77,67,9,0,0,1]));
  await assert.rejects(discovery,/invalidated/);
});

test('protocol resets in transactions invalidate cached capabilities', async () => {
  const transport=new FakeTransport();let probes=0;
  transport.write=async packet=>{
    const length=packet[4]===Instruction.ARM_READ?packet[6]:0;
    const payload=Buffer.alloc(length+1);
    if(packet[4]===Instruction.ARM_READ&&packet[5]===0x90){
      Buffer.from([65,82,77,67,9,0,0,1]).copy(payload,1);probes++;
    }
    if(packet[4]!==Instruction.SYSTEM_RESET)
      transport.emit('data',PacketEncoder.frame(packet[2],0,payload));
  };
  const protocol=new StsProtocol(new RequestScheduler(transport));
  const arm=new ArmExtension({has:()=>true,protocol});
  await arm.feedback(2);await arm.feedback(2);assert.equal(probes,1);
  await protocol.transaction(wire=>wire.reboot(2));
  await arm.feedback(2);assert.equal(probes,2);
});


test('retired powered takeover is rejected before transmission', async () => {
  const transport = new FakeTransport();
  const protocol = new StsProtocol(new RequestScheduler(transport), { baudRate: 1_000_000 });
  await assert.rejects(protocol.armCommand(2, 0x96, Buffer.from('34122a003512', 'hex')),
    /Invalid arm instruction/);
  assert.equal(transport.writes.length, 0);
});

test('v9.0 capabilities contain only protocol identity and controller interval', async () => {
  const caps = Buffer.from([65,82,77,67,9,0,0,1]);
  const calls = [];
  const arm = new ArmExtension({ has: id => id === 2, protocol: {
    armCommand: async (_id, instruction, bytes) => {
      calls.push([instruction, ...bytes]);
      return bytes[0] === 0x90 ? caps : Buffer.alloc(32);
    },
  }});
  assert.deepEqual(await arm.capabilities(2), {major:9, minor:0, tickMs:1});
  await arm.setTargets([{id:2,target:{sequence:1,positionQ8:0,
    speedLimit:100}}],7);
  await arm.feedback(2);
  assert.deepEqual(calls.map(call => call.slice(0,2)), [[0x90,0x90],[0x9a,7],[0x90,0xc1]]);
});

test('group validation rejects every malformed entry before I/O', async () => {
  let calls=0;
  const arm=new ArmExtension({has:()=>true,protocol:{armCommand:async()=>{calls++;}}});
  arm.capabilities=async()=>{calls++;return {major:9};};
  const target={sequence:1,positionQ8:0,speedLimit:100};
  const good=[1,2,3,4,5,6].map(id=>({id,target}));
  assert.equal(ArmCodec.encodeTargets(good,9).length,56);
  for(const entries of [[],[...good,{id:7,target}], [{id:1,target},{id:1,target}],
      [{id:1,target},{id:2,target:{...target,speedLimit:0}}],
      [{id:254,target}], [{id:2,target:{...target,session:9}}]])
    await assert.rejects(arm.setTargets(entries,9),RangeError);
  assert.equal(calls,0);
  assert.equal(arm.start,undefined);assert.equal(arm.submitTarget,undefined);
  assert.equal(ArmCodec.ADDRESS.target,undefined);
});

test('retired START and pending telemetry are rejected', async () => {
  const transport=new FakeTransport();
  const protocol=new StsProtocol(new RequestScheduler(transport));
  await assert.rejects(protocol.armCommand(2,0x92,Buffer.from([9,0])),/Invalid arm instruction/);
  assert.equal(transport.writes.length,0);
  const b=Buffer.alloc(32);b.writeUInt16LE(0x2000,12);
  assert.throws(()=>ArmCodec.decodeFeedback(b),/Unknown/);
});

test('removed control commands are unavailable and rejected before transmission', async () => {
  const transport = new FakeTransport();
  const protocol = new StsProtocol(new RequestScheduler(transport));
  const arm = new ArmExtension({ has: () => true, protocol });
  for (const instruction of [0x93, 0x94, 0x95, 0x97, 0x98])
    await assert.rejects(protocol.armCommand(2, instruction, Buffer.alloc(17)),
      /Invalid arm instruction/);
  assert.equal(transport.writes.length, 0);
  for (const name of ['arm', 'abort', 'velocityFeedforward', 'configureVelocityFeedforward', 'profiles', 'stageProfile', 'commitProfile', 'heartbeat', 'stopPowered'])
    assert.equal(arm[name], undefined);
  assert.equal(ArmCodec.ADDRESS.velocityFeedforward,undefined);
  assert.equal(ArmCodec.encodeVelocityFeedforward,undefined);
});

for (const oldMajor of [4,5,6,7,8]) test(`v${oldMajor} firmware is rejected before configuration, motion or feedback access`, async () => {
  const calls = [];
  const arm = new ArmExtension({ has: () => true, protocol: {
    armCommand: async (_id, instruction, data) => {
      calls.push([instruction, ...data]);
      return Buffer.from([65,82,77,67,oldMajor,0,0,1]);
    },
  }});
  const config = {...settings,kpQ8:256,kdQ8:0,kiQ8:0,integralLimit:0,effortLimit:100,
    velocityLimit:100,accelerationLimit:100,velocityFilterQ8:64,
    rampTimeMs:30,};
  await assert.rejects(arm.configure(2,config), /v9 required/);
  await assert.rejects(arm.setTargets([{id:2,target:{sequence:1,positionQ8:0,
    speedLimit:100}}],1), /v9 required/);
  await assert.rejects(arm.tuning(2), /v9 required/);
  assert.deepEqual(calls, [[0x90,0x90,8]]);
});

test('v9 rejects removed timers and expired-state flags', () => {
  const config = {...settings,kpQ8:256,kdQ8:0,kiQ8:0,integralLimit:0,effortLimit:100,
    velocityLimit:100,accelerationLimit:100,velocityFilterQ8:64,
    rampTimeMs:30,};
  assert.deepEqual(ArmCodec.decodeConfig(ArmCodec.encodeConfig(config)),config);
  assert.equal(ArmCodec.encodeConfig(config).length,24);
  assert.throws(()=>ArmCodec.encodeConfig({...config,timeoutMs:0}),/removed/);
  assert.throws(()=>ArmCodec.decodeConfig(Buffer.alloc(32)),/24/);
  const gravity={session:1,sequence:1,gravityEffort:0};
  assert.equal(ArmCodec.encodeGravity(gravity).length,6);
  assert.throws(()=>ArmCodec.encodeGravity({...gravity,ttlMs:0}),/removed/);
  for (const flag of [0x4,0x40,0x200,0x800]) {
    const data=Buffer.alloc(32);data.writeUInt16LE(flag,12);
    assert.throws(()=>ArmCodec.decodeFeedback(data),/Unknown/);
  }
  const feedback=ArmCodec.decodeFeedback(Buffer.alloc(32));
  assert.equal(feedback.holding,undefined);
  assert.equal(feedback.temperatureCandidatePending,undefined);
  assert.equal(feedback.expired,undefined);
  assert.equal(feedback.gravityStale,undefined);
});


test('v9 rejects separate position bounds instead of silently discarding them',()=>{
  const config={...settings,kpQ8:256,kdQ8:0,kiQ8:0,integralLimit:0,
    effortLimit:100,velocityLimit:100,accelerationLimit:100,
    velocityFilterQ8:64,rampTimeMs:30};
  for(const key of ['positionMinQ8','positionMaxQ8'])
    assert.throws(()=>ArmCodec.encodeConfig({...config,[key]:0}),/removed.*legacy position limits/);
  const decoded=ArmCodec.decodeConfig(ArmCodec.encodeConfig(config));
  assert.equal(decoded.positionMinQ8,undefined);
  assert.equal(decoded.positionMaxQ8,undefined);
});


test('selection encodes mode and session together and rejects invalid setup before I/O', async () => {
  const calls=[];
  const arm=new ArmExtension({has:()=>true,protocol:{armCommand:async(id,op,bytes)=>{
    calls.push([id,op,bytes.toString('hex')]);return Buffer.alloc(0);
  }}});
  arm.capabilities=async()=>({major:9});
  await arm.select(2,true,0x1234);
  await arm.select(2,false,0);
  assert.deepEqual(calls,[[2,0x91,'b8013412'],[2,0x91,'b8000000']]);
  for(const args of [[true,0],[true,65536],[true,-1],[true,1.5],[true,undefined],
      [false,1],[false,undefined],[1,7],[true,{}]])
    assert.throws(()=>arm.select(2,...args),/Selection/);
  assert.equal(calls.length,2);
  assert.equal(arm.arm,undefined);
  assert.equal(ArmCodec.ADDRESS.arm,undefined);
});
