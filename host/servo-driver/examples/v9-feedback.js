'use strict';

const { StsServo } = require('sts32xx-servo-driver');

async function inspect(port, id) {
  const servo = new StsServo({ serial: { path: port, baudRate: 1000000 } });
  try {
    await servo.connect();
    const capabilities = await servo.arm.capabilities(id, { timeoutMs: 100, rejectOnAlarm: true });
    if (capabilities?.major !== 9) throw new Error(`Servo ${id} requires extension v9`);
    return { capabilities,
      configuration: await servo.arm.configuration(id),
      feedback: await servo.arm.feedback(id),
      tuning: await servo.arm.tuning(id),
    };
  } finally { await servo.close(); }
}

async function main() {
  const [port, id, extra] = process.argv.slice(2);
  if (port === '--help') { console.log('node examples/v9-feedback.js PORT ID'); return; }
  if (!port || extra || !/^\d+$/.test(id ?? '') || Number(id) < 1 || Number(id) > 253)
    throw new Error('Provide PORT and ID (1–253)');
  console.log(JSON.stringify(await inspect(port, Number(id)), null, 2));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { inspect };
