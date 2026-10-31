#include "storage_adapter.h"
#include "app_runtime.h"
#include "command_service.h"
#include "board.h"
#include "storage_service.h"
#include "flash_driver.h"
#include "status_led_driver.h"
#include "bridge_driver.h"
#include "arm_extension.h"

#include <stdint.h>

/* Static composition root; policy and scheduling live in runtime.c. */
static app_state_t app;

/* Release startup's register/storage scratch before entering the permanent
 * loop; inlining it otherwise keeps that stack frame live through planning. */
static __attribute__((noinline)) void initialize(void)
{
    if (!board_init_safe()) board_halt_safe();
    status_led_driver_init();

    register_table_t initial = {0};
    registers_factory_defaults(&initial);
    initial.byte[REG_FIRMWARE_MAJOR] = 3;
    initial.byte[REG_FIRMWARE_MINOR] = 10;
    initial.byte[REG_IDENTITY_BYTE2] = 0;
    initial.byte[REG_MODEL_MAJOR] = 9;
    initial.byte[REG_REPORTED_MODEL_MINOR] = 3; /* Fallback identity until storage is valid. */
    initial.byte[REG_ID] = 2; /* Test-target fallback, not a release default. */
    initial.byte[REG_CONFIGURATION_FLAGS] = 0x5cu; /* Test-target fallback configuration. */
    const uint8_t *backup_page =
        flash_driver_page_view(STORAGE_PAGE_BACKUP);
    const uint8_t *primary_page =
        flash_driver_page_view(STORAGE_PAGE_PRIMARY);
    storage_selection_t selection = storage_inspect(backup_page, primary_page);
    const uint8_t *payload = storage_selection_payload(
        selection, backup_page, primary_page);
    app.storage_source = selection.source;
    if (payload != 0) {
        for (unsigned i = 0; i < STORAGE_MIRROR_BYTES; ++i)
            app.storage_mirror.byte[i] = payload[i];
    }
    if (app.storage_source != STORAGE_SOURCE_NONE &&
        !storage_copy_mirror_to_registers(&app.storage_mirror, &initial, false)) {
        app.storage_source = STORAGE_SOURCE_NONE;
    }
    if (app.storage_source == STORAGE_SOURCE_BACKUP) {
        if (!storage_service_recover(&app.storage_mirror)) {
            board_halt_safe();
        }
        app.storage_source = STORAGE_SOURCE_PRIMARY;
    }
    initial.byte[REG_TORQUE_ENABLE] = 0;
    initial.byte[REG_LOCK] = 1;
    registers_set_u16(&initial, REG_TORQUE_LIMIT, registers_u16(&initial, REG_MAX_TORQUE));
    device_init(&app.device, &initial);
    bus_service_init(&app.bus, &app.device, command_service_apply, &app, initial.byte[REG_BAUD_RATE]);
    arm_control_init(&app.arm, 0, 0);
    protocol_service_bind_extension(&app.bus.protocol,
                                    arm_extension_process, &app);
    sensor_service_init(&app.sensor_service);
    status_led_init(&app.status_led);
    app.sensor_active = sensor_driver_init(&app.sensors,
                                             (initial.byte[REG_CONFIGURATION_FLAGS] & 0x20u) != 0u);
    if (!app.sensor_active) app.device.registers.byte[REG_SERVO_STATUS] |= 0x02u;
    app.bridge_config = initial.byte[REG_CONFIGURATION_FLAGS];
    bool bridge_capable = app.sensor_active &&
        bridge_driver_init(app.bridge_config);
    output_safety_init(&app.output, bridge_capable);
    /* Include startup sensor faults in the first externally visible state. */
    protocol_service_publish(&app.bus.protocol);

}

int firmware_main(void)
{
    initialize();
    uint32_t last_watchdog_tick = sensor_driver_ticks(&app.sensors);
    for (;;) {
        app_runtime_poll(&app);
        uint32_t tick = sensor_driver_ticks(&app.sensors);
        if (tick != last_watchdog_tick) {
            last_watchdog_tick = tick;
            board_watchdog_feed();
        }
    }
}
