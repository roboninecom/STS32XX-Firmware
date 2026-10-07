#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { StsServo } = require('../servo-driver');
const { Teleoperation } = require('./Teleoperation');

async function main() {
  const args = process.argv.slice(2);
  if (!args[0] || args.includes('--help')) {
    console.log('Usage: node host/teleoperation/cli.js CONFIG.json [--run]\nWithout --run: read-only preflight and one mapped leader sample. Two distinct serial ports required.');
    return;
  }
  if (args.slice(1).some(a => a !== '--run')) throw new Error('Unknown option');
  const config = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const directory = path.resolve(__dirname,'../../backups/teleoperation');
  fs.mkdirSync(directory,{recursive:true});
  const logPath = path.join(directory,`${new Date().toISOString().replace(/[:.]/g,'-')}.ndjson`);
  const paths = [config.leaderPort, config.followerPort];
  if (paths.some(p => typeof p !== 'string' || !p) || paths[0] === paths[1] || fs.realpathSync(paths[0]) === fs.realpathSync(paths[1]))
    throw new Error('Leader and follower must have distinct serial ports');
  const leader = new StsServo({serial:{path:paths[0],baudRate:config.baudRate ?? 1000000}});
  const follower = new StsServo({serial:{path:paths[1],baudRate:config.baudRate ?? 1000000}});
  const teleop = new Teleoperation({leader,follower,config});
  const logFd = fs.openSync(logPath,'wx');
  const record = event => fs.writeSync(logFd,JSON.stringify({wallTime:new Date().toISOString(),...event})+'\n');
  console.log(`Session log: ${logPath}`);
  const stop = () => { teleop.stopping = true; };
  process.on('SIGINT',stop); process.on('SIGTERM',stop);
  // Report transport errors; an awaited operation/next sample will terminate the loop.
  const fault = error => { console.error(`Serial fault: ${error?.message ?? error}`); process.exitCode=1; stop(); };
  for (const servo of [leader,follower]) {
    servo.on('fault',fault); servo.on('disconnect',stop);
  }
  try {
    await leader.open(); await follower.open();
    const preflight={type:'preflight',config,limits:await teleop.preflight()};
    record(preflight); console.log(JSON.stringify(preflight));
    const preview={type:'preview',frame:await teleop.sample()};
    record(preview); console.log(JSON.stringify(preview));
    if (args.includes('--run')) {
      let lastReport=0;
      const started=Date.now();
      await teleop.run({
        shouldStop:()=>Number.isFinite(config.durationMs)&&Date.now()-started>=config.durationMs,
        onTelemetry: sample=>record({type:'telemetry',...sample}),
        onCommand: frame=>record({type:'command',...frame}),
        onFrame: frame=>{
          record({type:'frame',...frame});
          if(Date.now()-lastReport>=1000){console.log(JSON.stringify({type:'frame',...frame}));lastReport=Date.now();}
        },
      });
      record({type:'stopped',follower:'powered hold requested'});
      console.log(JSON.stringify({type:'stopped',follower:'powered hold requested'}));
    }
  } catch(error) {
    record({type:'error',message:error.message}); throw error;
  } finally {
    process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop);
    await Promise.allSettled([leader.close(), follower.close()]);
    fs.closeSync(logFd);
  }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode=1; });
