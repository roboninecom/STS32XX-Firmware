# Keep project commands at the repository root; firmware owns its build rules.
PYTHON ?= python3

.PHONY: all firmware verify clean host-verify arm-host-verify teleop-host-verify flash-verify
all: firmware

firmware verify clean:
	$(MAKE) -C firmware $@

host-verify:
	npm test

arm-host-verify:
	node --test host/servo-driver/test/arm-extension.test.js

teleop-host-verify:
	node --test tools/teleoperation/test/*.test.js

flash-verify:
	$(PYTHON) -m unittest discover -s tools/flash/tests -v
