# SO-102 model

This is the existing simulation model, moved here unchanged from the local
`simulation/models/so102` workspace. The simulator uses the revised
`so-arm_description/urdf/so-arm.urdf` and its eight STL meshes. `source/` retains
the original URDF and Xacro; `mass-allocation.json` records the mass adjustments.
`source-hashes.json` pins every imported file to its copied bytes.

## Source and license metadata

The earlier import notes identify a user-supplied local directory named
`so-102_tests/so-arm102`. That original directory is no longer available at the
recorded location. No upstream repository, author attribution or license file
has been established from the available copy.

The preserved `package.xml` and `setup.py` both say
`TODO: License declaration`. This is incomplete metadata, not evidence of a
specific restrictive or permissive license. The copied assets are not assigned
the servo driver's MIT license. Their upstream attribution and distribution
terms still need to be established before a public release of this model.

## Model assumptions

The original CAD masses total approximately 6.765 kg. The revised model uses the
reported 1.225 kg whole-arm mass, including six motors and 20 g of separate
aluminum rods. Link mass allocation is provisional. Original centers of mass
are retained and inertia tensors are scaled by each link's mass ratio.

The complete bearing is provisionally assigned to the fixed base; its actual
rotating share is unmeasured. Motor-to-link assignment, rod placement and clamp
mass split also remain assumptions. Joint effort and velocity limits come from
the source model, not measured servo ratings.

These files support geometry viewing and illustrative simulation. They are not
a calibrated model of motor dynamics, friction or joint torque. Do not replace
the measured host gravity model with these provisional inertials automatically.
The viewer's encoder-angle map is stored separately in `../../encoder-angle-map.json`;
M5 rotation and gripper opening remain fixed display placeholders.
