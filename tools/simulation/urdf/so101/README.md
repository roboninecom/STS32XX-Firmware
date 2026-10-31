# SO-101 follower model

URDF and 13 referenced STL meshes copied unchanged from
[The Robot Studio's SO-ARM100 repository](https://github.com/TheRobotStudio/SO-ARM100/tree/a758567c3978dfeefe282ede0500085a48fe8f78/Simulation/SO101),
commit `a758567c3978dfeefe282ede0500085a48fe8f78`.

Source: The Robot Studio, SO-101. Distributed under the upstream
[Apache 2.0 license](LICENSE.txt). `source.json` lists upstream paths and SHA-256
checksums. The viewer uses `so101_new_calib.urdf`; leader-specific parts and the
older calibration variant are not bundled.

The importer removes collisions only in temporary preview files. It preserves
visual geometry, joint transforms and inertial properties. See the
[viewer guide](../../README.md) for encoder mapping and calibration assumptions.
