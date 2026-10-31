'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {exportSettings}=require('../bundle');
const {loadConfiguration}=require('../../../host/arm-control/configuration');
const {configuration,rig}=require('../../../host/arm-control/test/fake-arm');
test('exported per-motor files reload and apply identical gains and motion settings',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sts-settings-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const config=configuration();config.profiles[1]={...config.profiles[1],accelerationLimit:15000,rampTimeMs:30};
 const source=path.join(root,'source.json');await fs.writeFile(source,JSON.stringify(config));
 const output=path.join(root,'output');await exportSettings(source,output);
 const loaded=await loadConfiguration(path.join(output,'controller.json'));assert.deepEqual(loaded,config);
 const r=rig(undefined,loaded);await r.controller.preflight();await r.controller.initialize();
 assert.equal(r.motors.get(1).config.accelerationLimit,15000);assert.equal(r.motors.get(1).config.rampTimeMs,30);
 await assert.rejects(exportSettings(source,output),{code:'EEXIST'});
});
test('invalid motor settings do not create an output directory',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sts-invalid-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const config=configuration();config.profiles[1]={...config.profiles[1],effortLimit:0};
 const source=path.join(root,'source.json');await fs.writeFile(source,JSON.stringify(config));
 const output=path.join(root,'output');await assert.rejects(exportSettings(source,output),/effortLimit/);
 await assert.rejects(fs.stat(output),{code:'ENOENT'});
});
