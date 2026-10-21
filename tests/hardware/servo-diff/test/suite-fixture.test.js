'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SuiteFixture, suiteImage } = require('../src/suite-fixture');
const { persistentBytes } = require('../src/register-image');
const { Instruction } = require('../../../../host/servo-driver');

function fakeRig() {
  const images = new Map([1, 2].map(id => {
    const image = Buffer.alloc(87);
    image[5] = id; image[18] = 0x8c; image[19] = 1;
    image[31] = id + 50; image[32] = 2;
    image[13] = 80; image[14] = 160; image[15] = 40;
    image[55] = 1; image[63] = 0;
    return [id, image];
  }));
  const saved = new Map([...images].map(([id, b]) => [id, Buffer.from(b)]));
  return { images, saved, events: [], writes: [], commands: [],
    templates: new Map([...saved].map(([id,b])=>[id,Buffer.from(b)])),
    async read(id, address, length) { return Buffer.from(images.get(id).subarray(address, address + length)); },
    async write(id, address, bytes) {
      const image = images.get(id);
      this.writes.push({ id, address, bytes });
      for (let i = 0; i < bytes.length; i++) {
        image[address + i] = bytes[i];
        if (image[55] === 0 && ((address + i >= 4 && address + i < 40) || address + i >= 78)) {
          saved.get(id)[address + i] = bytes[i];
        }
      }
    },
    async reset(id) {
      images.set(id, Buffer.from(saved.get(id)));
      images.get(id)[40] = 0; images.get(id)[55] = 1;
    },
    async command(id, instruction) {
      this.commands.push({id,instruction});
      if(instruction===Instruction.SAVE_RESET_TEMPLATE)this.templates.set(id,Buffer.from(images.get(id)));
      else if(instruction===Instruction.FACTORY_RESET){
        saved.set(id,Buffer.from(this.templates.get(id)));
        images.set(id,Buffer.from(saved.get(id)));images.get(id)[40]=0;
      }
    },
  };
}

test('suite config enables stimulus while retaining identity, topology, sensors and protections', () => {
  const rig = fakeRig();
  const before = rig.images.get(1);
  const after = suiteImage(before);
  assert.equal(after[18], 0x9c);
  assert.equal(after[19], 0x2f);
  assert.equal(after.readUInt16LE(16), 1000);
  assert.deepEqual([...after.subarray(34,40)], [40,80,80,25,0,50]);
  for (const address of [5,6,9,10,11,12,13,14,15,31,32,63]) assert.equal(after[address], before[address]);
  assert.equal(before[18], 0x8c, 'source image mutated');
});

test('setup records evidence before writes and cleanup restores device defaults with command 0x06', async () => {
  const rig = fakeRig();
  const originals = new Map([...rig.images].map(([id,b])=>[id,Buffer.from(b)]));
  let saved = false;
  const fixture = new SuiteFixture(rig, [1,2], async () => {
    assert.equal(rig.writes.length, 0);
    assert.equal(fixture.originals.size, 2);
    saved = true;
  });
  await fixture.prepare();
  assert.equal(saved, true);
  await rig.write(1,55,[0]); await rig.write(1,31,[99,3]); await rig.write(1,55,[1]);
  await fixture.restore();
  for (const [id,b] of originals) {
    assert.deepEqual(persistentBytes(rig.images.get(id)),persistentBytes(b));
    assert.equal(rig.images.get(id)[40],0);
    assert.equal(rig.images.get(id)[55],1);
  }
  assert.deepEqual(persistentBytes(rig.templates.get(1)),persistentBytes(originals.get(1)));
  assert.equal(rig.commands.filter(c=>c.instruction===Instruction.SAVE_RESET_TEMPLATE).length,0);
  assert.equal(rig.commands.filter(c=>c.instruction===Instruction.FACTORY_RESET).length,2);
});

test('restores both servos after setup fails midway', async () => {
  const rig = fakeRig();
  const originals = new Map([...rig.images].map(([id,b])=>[id,Buffer.from(b)]));
  const reset = rig.reset.bind(rig);
  let fail = true;
  rig.reset = async id => { if(id===2 && fail){fail=false;throw Error('setup reset timeout');}await reset(id); };
  const fixture = new SuiteFixture(rig,[1,2]);
  await assert.rejects(fixture.prepare(),/setup reset timeout/);
  await fixture.restore();
  for (const [id,b] of originals) assert.deepEqual(persistentBytes(rig.images.get(id)),persistentBytes(b));
});

test('reports restoration failure while still attempting the other servo', async () => {
  const rig = fakeRig();
  const fixture = new SuiteFixture(rig,[1,2]);
  await fixture.prepare();
  const reset=rig.reset.bind(rig);
  rig.reset=async id=>{if(id===1)throw Error('restore reset timeout');await reset(id);};
  await assert.rejects(fixture.restore(),/servo 1: restore reset timeout/);
  assert.ok(rig.events.some(e=>e.label==='suite-defaults-restored:2'));
});

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../src/runner');

async function runnerFixture(callback) {
  const rig = fakeRig();
  rig.open = async () => {};
  rig.close = async () => {};
  rig.health = async () => {};
  const resultsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'servo-suite-restore-'));
  try { await callback(rig, resultsDirectory); }
  finally { await fs.rm(resultsDirectory, { recursive: true, force: true }); }
}

const config = { factoryId:1, candidateId:2, baudRate:1_000_000, port:'/dev/fake' };
const fixtureCase = fn => ({ id:'test_fixture_failure', stages:['safe'], scope:'device',
  risk:'safe', module:'offline', covers:{}, run:fn });

test('runner records starting evidence and restores defaults after a safety hard stop', async () => {
  await runnerFixture(async (rig, resultsDirectory) => {
    const original = new Map([...rig.images].map(([id,b])=>[id,Buffer.from(b)]));
    const entry = fixtureCase(async () => {
      const files = await fs.readdir(resultsDirectory);
      const onDisk = JSON.parse(await fs.readFile(path.join(resultsDirectory,files[0],'report.json'),'utf8'));
      assert.equal(onDisk.events.filter(e=>e.label.startsWith('suite-original:')).length,2);
      assert.equal(rig.images.get(1)[18],0x9c);
      throw Error('unsafe stimulus');
    });
    entry.stopOnFailure = true;
    const {report} = await run(config,{cases:[entry],prepareSuite:true,
      allowPersistenceWrite:true,resultsDirectory,rigFactory:()=>rig});
    assert.match(report.cases[0].hardStop,/safety case/);
    assert.equal(report.cleanupError,undefined);
    for(const [id,b] of original)assert.deepEqual(persistentBytes(rig.images.get(id)),persistentBytes(b));
  });
});

test('runner saves final report with restoration failure and attempts both restorations', async () => {
  await runnerFixture(async (rig, resultsDirectory) => {
    const reset = rig.reset.bind(rig);
    const entry = fixtureCase(async () => {
      rig.reset = async id => {if(id===1)throw Error('final restoration timeout');await reset(id);};
      return {exact:{okay:true}};
    });
    const {report,directory} = await run(config,{cases:[entry],prepareSuite:true,
      allowPersistenceWrite:true,resultsDirectory,rigFactory:()=>rig});
    assert.match(report.cleanupError.message,/final restoration timeout/);
    assert.ok(report.events.some(e=>e.label==='suite-defaults-restored:2'));
    const saved = JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
    assert.equal(saved.cleanupError.message,report.cleanupError.message);
  });
});

test('cleanup loads the current device template rather than the old active image', async () => {
  const rig=fakeRig();
  const fixture=new SuiteFixture(rig,[1,2]);
  await fixture.prepare();
  rig.templates.get(1)[21]=77;
  await fixture.restore();
  assert.equal(rig.images.get(1)[21],77);
  assert.equal(rig.commands.some(c=>c.instruction===Instruction.SAVE_RESET_TEMPLATE),false);
});

test('required defaults case tests the command and leaves template defaults, not starting live settings', async () => {
  const rig=fakeRig();
  rig.images.get(1)[21]=19;
  rig.templates.get(1)[21]=42;
  const entry=require('../src/cases/restore_defaults')[0];
  const result=await entry.run({rig,id:1});
  assert.equal(result.exact.changedGainReplaced,true);
  assert.equal(rig.images.get(1)[21],42);
  assert.equal(rig.commands.filter(c=>c.instruction===Instruction.FACTORY_RESET).length,3);
  assert.equal(rig.commands.some(c=>c.instruction===Instruction.SAVE_RESET_TEMPLATE),false);
  assert.equal(rig.writes.some(w=>w.address===21&&w.bytes[0]===19),false);
  const {selectCases}=require('../src/runner');
  const {loadCases}=require('../src/load-cases');
  assert.equal(selectCases(loadCases(),{stage:'all'})[0].id,entry.id);
});
