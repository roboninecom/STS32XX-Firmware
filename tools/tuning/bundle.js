'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { ArmCodec } = require('../../host/servo-driver');
const { loadConfiguration } = require('../../host/arm-control/configuration');
const { GravityModel } = require('../../host/arm-control/GravityModel');
const { candidateProfile, hash } = require('./plan');

// Export files only. This is not a recommendation or a hardware write.
async function exportSettings(filename, directory) {
  const config = await loadConfiguration(filename), files = {};
  if (!config.joints?.length || config.joints.length > 6) throw new Error('Expected 1–6 configured motors');
  const ids = config.joints.map(j => j.followerId);
  if (new Set(ids).size !== ids.length || ids.some(id => !Number.isInteger(id) || id < 1 || id > 253))
    throw new Error('Invalid or duplicate follower IDs');
  const profiles = {};
  for (const id of ids) {
    if (!config.profiles?.[id]) throw new Error(`Missing motor ${id} profile`);
    const profile = candidateProfile(config, id);
    ArmCodec.encodeConfig(profile);
    profiles[id] = `motor-${id}.json`; files[profiles[id]] = profile;
  }
  let gravityModel;
  if (config.gravityModel) {
    const gravity = await GravityModel.load(path.resolve(path.dirname(filename), config.gravityModel));
    gravity.validateIds(ids);
    gravityModel = 'gravity.json'; files[gravityModel] = gravity.document;
  }
  files['controller.json'] = { ...config, profiles, ...(gravityModel ? { gravityModel } : {}) };
  files['manifest.json'] = { format: 'sts-tuning-settings', version: 1, createdAt: new Date().toISOString(),
    configHash: hash(config), files: Object.keys(files),
    note: 'Exported settings, not proof of validation. Retain tuning evidence and calibrate each arm separately.' };
  // Refuse to overwrite an existing collection. Validate everything before mkdir.
  await fs.mkdir(directory);
  for (const [name, document] of Object.entries(files))
    await fs.writeFile(path.join(directory, name), JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
  return { directory: path.resolve(directory), files: Object.keys(files) };
}
module.exports = { exportSettings };
