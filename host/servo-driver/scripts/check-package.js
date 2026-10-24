'use strict';

// Install the actual release archive outside the checkout. Fake transports alone
// cannot catch an omitted runtime file or a dependency supplied by the monorepo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-driver-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const exec = (file, args, cwd) => execFileSync(file, args, {
  cwd, encoding: 'utf8', env: { ...process.env, npm_config_logs_dir: temporary },
});
try {
  const [packed] = JSON.parse(exec(npm, ['pack', '--json', '--pack-destination', temporary], root));
  const names = packed.files.map(file => file.path);
  for (const required of ['index.js', 'StsServo.js', 'package.json', 'LICENSE', 'README.md', 'transport/SerialTransport.js'])
    assert(names.includes(required), `${required} is missing from the archive`);
  assert(names.every(name => !/^(test|scripts|results|backups|node_modules)\//.test(name)),
    'Development files leaked into the archive');
  fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ private: true }));
  exec(npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    path.join(temporary, packed.filename)], temporary);
  exec(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const driver = require('sts32xx-servo-driver');
    const metadata = require('sts32xx-servo-driver/package.json');
    assert.equal(metadata.license, 'MIT');
    const servo = new driver.StsServo({ serial: { path: '/dev/not-opened' } });
    assert.equal(servo.isConnected, false);
    assert.equal(driver.PacketEncoder.frame(2, driver.Instruction.PING).toString('hex'), 'ffff020201fa');
    assert.equal(driver.ArmCodec.encodeGravity({ session: 1, sequence: 1, gravityEffort: -10 }).length, 6);
    import('sts32xx-servo-driver').then(module => assert.equal(module.default.StsServo, driver.StsServo));
  `], temporary);
  console.log(`Verified ${packed.filename}: ${names.length} files, isolated install and CommonJS/ESM imports; no serial port opened.`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
