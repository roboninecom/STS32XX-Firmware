'use strict';

const { StsServo, BAUD_RATES } = require('sts32xx-servo-driver');

async function discover(port, baudRate = 1000000) {
  const servo = new StsServo({ serial: { path: port, baudRate } });
  try {
    const found = await servo.connect();
    const devices = [];
    for (const id of found.ids) {
      devices.push({ id, alarms: found.alarms.get(id) ?? [],
        registers: await servo.bus.read(id, ['presentPosition', 'presentVoltage', 'servoStatus']),
      });
    }
    return devices;
  } finally { await servo.close(); }
}

async function main() {
  const [port, baud = '1000000', extra] = process.argv.slice(2);
  if (port === '--help') { console.log('node examples/discover.js PORT [BAUD]'); return; }
  if (!port || extra || !BAUD_RATES.includes(Number(baud))) throw new Error('Provide PORT and a supported BAUD');
  console.log(JSON.stringify(await discover(port, Number(baud)), null, 2));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { discover };
