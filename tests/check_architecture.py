"""Enforce portable core and application hardware boundaries transitively."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HEADERS = ROOT / "include"
APP_HEADERS = ROOT / "app"
TARGET_HEADERS = ROOT / "platform" / "gd32f130"
LOCAL_INCLUDE = re.compile(r'^#include\s+"([^"]+)"', re.M)
MMIO_TOKEN = re.compile(
    r"\b(?:GD32_[A-Z0-9_]*|MMIO|REG32|PROBE_REG32|"
    r"USART[0-9]?_[A-Z0-9_]*|TIMER[0-9]?_[A-Z0-9_]*|"
    r"FMC_[A-Z0-9_]*|__asm)\b"
)
ADDRESS = re.compile(r"0x(?:0800|2000|4000|4800|e000)[0-9a-fA-F]{4,}")
def includes(path):
    return LOCAL_INCLUDE.findall(path.read_text())


def code_only(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def resolve_include(owner, name):
    private = owner.parent / name
    if private.is_file():
        return private
    for folder in (HEADERS, APP_HEADERS, TARGET_HEADERS):
        candidate = folder / name
        if candidate.is_file():
            return candidate
    raise AssertionError(f"missing local header: {name} included by {owner}")


def visit(path, ancestors=()):
    identity = path.relative_to(ROOT)
    assert identity not in ancestors, f"include cycle: {ancestors + (identity,)}"
    result = {path}
    for name in includes(path):
        assert "/" not in name, (path, name)
        result.update(visit(resolve_include(path, name), ancestors + (identity,)))
    return result


all_headers = sorted(HEADERS.glob("*.h")) + sorted(APP_HEADERS.glob("*.h"))
for path in all_headers:
    visit(path)
    source = code_only(path.read_text())
    assert not MMIO_TOKEN.search(source) and not ADDRESS.search(source), path

core = sorted((ROOT / "core").rglob("*.c"))
assert core
for path in core:
    source = code_only(path.read_text())
    direct = includes(path)
    assert all("/" not in name for name in direct), (path, direct)
    assert not MMIO_TOKEN.search(source) and not ADDRESS.search(source), path
    reached = set()
    for name in direct:
        reached.update(visit(resolve_include(path, name)))
    assert all(header.is_relative_to(HEADERS) or
               header.is_relative_to(ROOT / "core") for header in reached), (path, reached)
    if path.parent.name in {"sensing", "motion", "control", "protection", "storage"}:
        assert HEADERS / "registers.h" not in reached, (path, "wire register dependency")
    for header in reached:
        text = code_only(header.read_text())
        assert not MMIO_TOKEN.search(text) and not ADDRESS.search(text), (path, header)
print(f"Portable core boundary: {len(core)} sources, {len(all_headers)} headers OK")

for path in sorted((ROOT / "app").rglob("*.c")):
    source = code_only(path.read_text())
    assert not MMIO_TOKEN.search(source) and not ADDRESS.search(source), path
    assert not re.search(r'"(?:platform/|gd32)', source), path
    assert not re.search(
        r"\b(?:state->|app\.)sensors\.(?:adc_dma|phase|encoder_ready|"
        r"encoder_failed|adc_ready|adc_failed|ticks)", source), path
print("Application hardware boundary: no MMIO or sensor-driver internals")
