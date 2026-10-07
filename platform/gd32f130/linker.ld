ENTRY(Reset_Handler)

MEMORY {
    FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 0x7000
    BACKUP (rx) : ORIGIN = 0x08007000, LENGTH = 0x400
    EEPROM (rx) : ORIGIN = 0x08007400, LENGTH = 0x400
    BOOT (rx)   : ORIGIN = 0x08007800, LENGTH = 0x800
    RAM (rwx)   : ORIGIN = 0x20000000, LENGTH = 0x1000
}

_estack = ORIGIN(RAM) + LENGTH(RAM);
_min_stack = 0x500;

SECTIONS {
    .isr_vector ORIGIN(FLASH) : {
        KEEP(*(.isr_vector))
    } > FLASH
    .text : {
        KEEP(*(.text.Reset_Handler))
        *(.text .text.*)
        *(.rodata .rodata.*)
        . = ALIGN(4);
    } > FLASH
    _sidata = LOADADDR(.data);
    .data : {
        . = ALIGN(4);
        _sdata = .;
        *(.data .data.*)
        . = ALIGN(4);
        _edata = .;
    } > RAM AT > FLASH
    .bss (NOLOAD) : {
        . = ALIGN(4);
        _sbss = .;
        *(.bss .bss.* COMMON)
        . = ALIGN(4);
        _ebss = .;
    } > RAM
    _end = .;
    /DISCARD/ : { *(.comment) *(.note*) }
}

ASSERT(SIZEOF(.isr_vector) == 0xcc, "factory vector size must be 0xcc")
ASSERT(LOADADDR(.data) + SIZEOF(.data) <= ORIGIN(BACKUP), "image overlaps storage backup")
ASSERT(_end + _min_stack <= ORIGIN(RAM) + LENGTH(RAM), "static RAM exceeds stack reserve")
