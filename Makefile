# Keep project commands at the repository root; firmware owns its build rules.
PYTHON ?= python3

.PHONY: all firmware verify clean host-verify flash-verify
all: firmware

firmware verify clean:
	$(MAKE) -C firmware $@

host-verify:
	npm test

flash-verify:
	$(PYTHON) -m unittest discover -s tools/flash/tests -v
