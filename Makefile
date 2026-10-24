ARM_PREFIX ?= arm-none-eabi-
ARM_CC := $(ARM_PREFIX)gcc
HOST_CC ?= cc
PYTHON ?= python3
ARM_OBJCOPY := $(ARM_PREFIX)objcopy
ARM_OBJDUMP := $(ARM_PREFIX)objdump
ARM_SIZE := $(ARM_PREFIX)size
ARM_READELF := $(ARM_PREFIX)readelf

# Reject old diagnostic options rather than silently building a motion image.
ifneq ($(strip $(MOTOR_TEST)$(MOTOR_RELEASE)$(FLASH_DUMP)$(FLASH_PROBE)),)
$(error Removed build option; use the default build or TIMING_PROBE=1/arm)
endif
ifneq ($(strip $(TIMING_PROBE)),)
ifeq ($(filter $(TIMING_PROBE),1 arm),)
$(error TIMING_PROBE must be 1 or arm)
endif
endif
PROFILE := motor-release$(if $(TIMING_PROBE),-timing)$(if $(filter arm,$(TIMING_PROBE)),-arm)
FIRMWARE_DIR := build/$(PROFILE)

CFLAGS := -std=c11 -Wall -Wextra -Werror -Os -flto -mcpu=cortex-m3 -mthumb \
  -ffreestanding -fno-builtin -ffunction-sections -fdata-sections -MMD -MP -Iinclude -Iapp -Iplatform/gd32f130 \
  -Iplatform/gd32f130/vendor/CMSIS -Iplatform/gd32f130/vendor/SPL/Include
HOST_CFLAGS := -std=c11 -Wall -Wextra -Werror -O2 -fsanitize=address,undefined -Iinclude -Iapp -Iplatform/gd32f130
HOST_DEPFLAGS := -std=c11 -MM -MP -Iinclude -Iapp -Iplatform/gd32f130
LDFLAGS := -nostdlib -Wl,--gc-sections -Wl,-Map,$(FIRMWARE_DIR)/firmware.map \
  -T platform/gd32f130/linker.ld
APP_SOURCES := app/main.c app/runtime.c app/bus_service.c app/command_service.c \
  app/device.c app/protocol_service.c app/sensor_service.c app/output_safety.c app/storage_service.c app/arm_extension.c
PLATFORM_SOURCES := platform/gd32f130/board.c platform/gd32f130/memory.c \
  platform/gd32f130/uart.c platform/gd32f130/sensor_driver.c \
  platform/gd32f130/flash_driver.c platform/gd32f130/bridge_driver.c \
  platform/gd32f130/bridge_output.c platform/gd32f130/startup.c
CORE_SOURCES := core/protocol/protocol.c core/protocol/bus_timing.c \
  core/registers/registers.c core/registers/control_adapter.c \
  core/registers/storage_adapter.c \
  core/sensing/encoder.c core/sensing/adc.c \
  core/storage/storage.c core/storage/journal.c \
  core/control/trajectory.c core/control/controller.c core/control/arm_control.c core/control/arm_motion.c core/control/bridge_policy.c \
  core/control/pipeline.c core/control/protection.c core/status_led.c
SOURCES := $(APP_SOURCES) $(CORE_SOURCES) $(PLATFORM_SOURCES)
ifdef TIMING_PROBE
CFLAGS += -DFW_TIMING_PROBE
ifeq ($(TIMING_PROBE),arm)
CFLAGS += -DFW_ARM_TIMING_PROBE
endif
SOURCES += platform/gd32f130/diagnostics.c app/diagnostic_service.c
endif
OBJECTS := $(patsubst %.c,$(FIRMWARE_DIR)/%.o,$(SOURCES))

.PHONY: all firmware verify host-verify arm-host-verify teleop-host-verify flash-verify clean FORCE
all: firmware
firmware: $(FIRMWARE_DIR)/firmware.elf $(FIRMWARE_DIR)/firmware.bin $(FIRMWARE_DIR)/firmware.hex $(FIRMWARE_DIR)/firmware.size $(FIRMWARE_DIR)/manifest.txt
verify: firmware build/host/sensor_driver_test build/host/memory_test build/host/arm_motion_arithmetic_test build/host/arm_motion_test build/host/arm_plant_test build/host/arm_feedback_test build/host/arm_control_test build/host/uart_driver_test build/host/protocol_test build/host/service_test build/host/sensing_test build/host/sensor_service_test build/host/storage_test build/host/storage_service_test build/host/journal_plan_test build/host/motion_request_test build/host/trajectory_test build/host/controller_test build/host/protection_test build/host/bridge_policy_test build/host/control_pipeline_test build/host/telemetry_test build/host/status_led_test build/host/output_safety_test build/host/runtime_test
	build/host/sensor_driver_test
	build/host/memory_test
	build/host/arm_motion_arithmetic_test
	build/host/arm_motion_test
	build/host/arm_control_test
	build/host/arm_feedback_test
	build/host/arm_plant_test
	build/host/uart_driver_test
	build/host/protocol_test
	build/host/service_test
	build/host/sensing_test
	build/host/sensor_service_test
	build/host/storage_test
	build/host/storage_service_test
	build/host/journal_plan_test
	build/host/motion_request_test
	build/host/trajectory_test
	build/host/controller_test
	build/host/protection_test
	build/host/bridge_policy_test
	build/host/control_pipeline_test
	build/host/telemetry_test
	build/host/status_led_test
	build/host/output_safety_test
	build/host/runtime_test
	python3 tests/check_contract.py
	python3 tests/check_storage_fixture.py
	python3 tests/check_architecture.py
	python3 tests/check_profiles.py $(FIRMWARE_DIR)
	python3 tests/check_image.py $(FIRMWARE_DIR)/firmware.elf $(FIRMWARE_DIR)/firmware.bin "$(ARM_READELF)"

build/host/memory_test: tests/memory_test.c platform/gd32f130/memory.c
	@mkdir -p $(dir $@)
	$(HOST_CC) $(HOST_CFLAGS) -Wno-unknown-attributes -ffreestanding -fno-builtin \
	  -Dmemcpy=runtime_memcpy -Dmemset=runtime_memset $^ -o $@

build/host/arm_motion_arithmetic_test: tests/arm_motion_arithmetic_test.c core/control/arm_motion.c include/arm_motion.h
	@mkdir -p $(@D)
	$(HOST_CC) $(HOST_CFLAGS) $< -o $@
	$(HOST_CC) $(HOST_DEPFLAGS) -MT $@ $< > $@.d

build/host/protocol_test: tests/protocol_test.c tests/fixtures/initial_wire.h core/protocol/protocol.c core/registers/registers.c include/protocol.h include/registers.h

build/host/service_test: tests/service_test.c tests/fixtures/initial_wire.h app/protocol_service.c app/device.c core/protocol/protocol.c core/registers/registers.c core/registers/control_adapter.c

build/host/sensing_test: tests/sensing_test.c core/sensing/encoder.c core/sensing/adc.c include/sensing.h

build/host/sensor_service_test: tests/sensor_service_test.c app/sensor_service.c app/protocol_service.c app/device.c core/registers/control_adapter.c core/sensing/encoder.c core/sensing/adc.c core/registers/registers.c core/protocol/protocol.c

build/host/storage_test: tests/storage_test.c tests/support/storage_legacy_fixture.c core/storage/storage.c core/storage/journal.c core/registers/storage_adapter.c core/registers/registers.c include/storage.h include/storage_journal.h tests/fixtures/2026-09-25-target-storage-readback.bin

build/host/storage_service_test: tests/storage_service_test.c tests/support/storage_legacy_fixture.c app/storage_service.c core/storage/storage.c core/storage/journal.c core/registers/registers.c app/storage_service.h include/storage_journal.h tests/fixtures/2026-09-25-target-storage-readback.bin

build/host/journal_plan_test: tests/journal_plan_test.c tests/support/storage_legacy_fixture.c core/storage/storage.c core/storage/journal.c include/storage.h include/storage_journal.h tests/fixtures/2026-09-25-target-storage-readback.bin

build/host/motion_request_test: tests/motion_request_test.c core/registers/control_adapter.c core/registers/registers.c include/motion_request.h

build/host/trajectory_test: tests/trajectory_test.c core/control/trajectory.c include/trajectory.h

build/host/controller_test: tests/controller_test.c core/control/controller.c core/registers/control_adapter.c core/registers/registers.c include/controller.h

build/host/arm_motion_test: tests/arm_motion_test.c core/control/arm_motion.c include/arm_motion.h

build/host/arm_plant_test: tests/arm_plant_test.c core/control/arm_control.c core/control/arm_motion.c include/arm_control.h

build/host/arm_feedback_test: tests/arm_feedback_test.c core/control/arm_control.c core/control/arm_motion.c include/arm_control.h

build/host/arm_control_test: tests/arm_control_test.c core/control/arm_control.c core/control/arm_motion.c include/arm_control.h

build/host/protection_test: tests/protection_test.c core/control/protection.c core/registers/control_adapter.c core/registers/registers.c include/protection.h

build/host/bridge_policy_test: tests/bridge_policy_test.c core/control/bridge_policy.c platform/gd32f130/bridge_output.c include/bridge_policy.h include/bridge_output.h

build/host/control_pipeline_test: tests/control_pipeline_test.c core/control/pipeline.c core/control/controller.c core/control/bridge_policy.c platform/gd32f130/bridge_output.c core/registers/control_adapter.c core/control/trajectory.c core/control/protection.c core/registers/registers.c include/control_pipeline.h

build/host/output_safety_test: tests/output_safety_test.c app/output_safety.c app/output_safety.h

RUNTIME_TEST_SOURCES := platform/gd32f130/bridge_output.c tests/runtime_test.c app/runtime.c app/arm_extension.c app/bus_service.c \
  app/command_service.c app/protocol_service.c app/device.c app/sensor_service.c \
  app/output_safety.c core/protocol/protocol.c core/protocol/bus_timing.c \
  core/registers/registers.c core/registers/control_adapter.c \
  core/registers/storage_adapter.c \
  core/sensing/encoder.c core/sensing/adc.c \
  core/storage/storage.c core/storage/journal.c \
  core/control/trajectory.c core/control/controller.c core/control/arm_control.c core/control/arm_motion.c core/control/bridge_policy.c \
  core/control/pipeline.c core/control/protection.c core/status_led.c
build/host/runtime_test: $(RUNTIME_TEST_SOURCES)

build/host/telemetry_test: tests/telemetry_test.c core/registers/control_adapter.c core/registers/registers.c include/control_adapter.h

build/host/status_led_test: tests/status_led_test.c core/status_led.c include/status_led.h

$(FIRMWARE_DIR)/config.txt: FORCE
	@mkdir -p $(dir $@)
	@{ printf 'profile=%s\n' '$(PROFILE)'; \
	   printf 'compiler=%s\n' '$(ARM_CC)'; \
	   printf 'flags=%s\n' '$(CFLAGS)'; \
	   printf 'link_flags=%s\n' '$(LDFLAGS)'; } > $@.tmp
	@cmp -s $@.tmp $@ || mv $@.tmp $@
	@rm -f $@.tmp

$(FIRMWARE_DIR)/%.o: %.c $(FIRMWARE_DIR)/config.txt
	@mkdir -p $(dir $@)
	"$(ARM_CC)" $(CFLAGS) -fstack-usage -c $< -o $@

$(FIRMWARE_DIR)/firmware.elf: $(OBJECTS) platform/gd32f130/linker.ld $(FIRMWARE_DIR)/config.txt
	"$(ARM_CC)" $(CFLAGS) -fstack-usage $(LDFLAGS) $(OBJECTS) -lgcc -o $@

$(FIRMWARE_DIR)/firmware.bin: $(FIRMWARE_DIR)/firmware.elf
	"$(ARM_OBJCOPY)" -O binary $< $@

$(FIRMWARE_DIR)/firmware.hex: $(FIRMWARE_DIR)/firmware.elf
	"$(ARM_OBJCOPY)" -O ihex $< $@

$(FIRMWARE_DIR)/firmware.size: $(FIRMWARE_DIR)/firmware.elf
	"$(ARM_SIZE)" -A $< > $@

$(FIRMWARE_DIR)/manifest.txt: $(FIRMWARE_DIR)/firmware.bin
	@{ printf 'profile=%s\n' '$(PROFILE)'; \
	   printf 'compiler=%s\n' "$$("$(ARM_CC)" --version | head -1)"; \
	   printf 'flags=%s\n' '$(CFLAGS)'; \
	   shasum -a 256 $<; } > $@

clean:
	rm -rf build

-include $(OBJECTS:.o=.d)
-include $(wildcard build/host/*.d)

# Fake MMIO exercises the target driver without adding a production HAL.
build/host/sensor_driver_test: tests/sensor_driver_test.c platform/gd32f130/sensor_driver.c

build/host/uart_driver_test: tests/uart_driver_test.c platform/gd32f130/uart.c core/protocol/bus_timing.c platform/gd32f130/uart_driver.h include/bus_timing.h tests/support/uart_driver_test_port.h

# All host executables have explicit source closures above. Profile/test flags
# also reach dependency generation, so conditional includes stay tracked.
HOST_TEST_TARGETS := build/host/sensor_driver_test build/host/arm_motion_test build/host/protocol_test build/host/service_test \
  build/host/arm_control_test build/host/arm_feedback_test build/host/arm_plant_test \
  build/host/sensing_test build/host/sensor_service_test \
  build/host/storage_test build/host/storage_service_test build/host/journal_plan_test \
  build/host/motion_request_test build/host/trajectory_test build/host/controller_test \
  build/host/protection_test build/host/bridge_policy_test build/host/control_pipeline_test \
  build/host/output_safety_test build/host/runtime_test \
  build/host/telemetry_test build/host/status_led_test \
  build/host/uart_driver_test
build/host/arm_motion_test: RUNTIME_FLAGS := -DFW_ARM_TIMING_PROBE
build/host/sensor_driver_test: RUNTIME_FLAGS := -DFW_SENSOR_HOST_TEST -Itests/support
build/host/uart_driver_test: RUNTIME_FLAGS := -DFW_UART_HOST_TEST -Itests/support
$(HOST_TEST_TARGETS):
	@mkdir -p $(dir $@)
	$(HOST_CC) $(HOST_CFLAGS) $(RUNTIME_FLAGS) $(filter %.c,$^) -o $@
	$(HOST_CC) $(HOST_DEPFLAGS) $(RUNTIME_FLAGS) -MT $@ $(filter %.c,$^) > $@.d

# Host interfaces are local to this repository; these targets are offline.
host-verify:
	node --test host/servo-driver/test/*.test.js tools/teleoperation/test/*.test.js tools/diagnostics/test/*.test.js tools/hw-diff-tests/test/*.test.js tools/settings/test/*.test.js tools/pose-recorder/test/*.test.js

arm-host-verify:
	node --test host/servo-driver/test/arm-extension.test.js

teleop-host-verify:
	node --test tools/teleoperation/test/*.test.js

flash-verify:
	$(PYTHON) -m unittest discover -s tools/flash/tests -v
