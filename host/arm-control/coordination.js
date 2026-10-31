'use strict';

// Equal distance/speed ratios approximate a shared arrival time. Acceleration
// and braking remain local to each motor; this is not a shared trajectory.
function coordinatedSpeeds(distances, caps) {
  const duration = Math.max(...distances.map((distance, i) => distance / caps[i]));
  return distances.map((distance, i) => duration > 0
    ? Math.max(1, Math.min(caps[i], Math.round(distance / duration))) : 1);
}

module.exports = { coordinatedSpeeds };
