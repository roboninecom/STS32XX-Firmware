#!/usr/bin/env python3
"""Inspect, upload and recover publisher-supplied encoded STS firmware."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import time

import serial

import bootloader

FORMAT = "sts-gd32-encoded-v1"
BAUD_RATES = (1_000_000, 500_000, 250_000, 128_000, 115_200, 76_800, 57_600, 38_400)
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "backups" / "flash"


def exact_keys(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(f"{label} must contain exactly: {', '.join(keys)}")


def integer(value, lo, hi, label):
    if type(value) is not int or not lo <= value <= hi:
        raise ValueError(f"Invalid {label}; expected {lo}..{hi}")
    return value


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate manifest field: {key}")
        result[key] = value
    return result


def load_release(file):
    """Validate the complete bundle before opening a port; never transform it."""
    path = Path(file).resolve()
    manifest = json.loads(path.read_text(), object_pairs_hook=unique_object)
    exact_keys(manifest, ("format", "release", "image", "size", "sha256",
                          "target", "model_bytes", "extension"), "Manifest")
    if manifest["format"] != FORMAT or manifest["target"] != "gd32f130-sts-ttl":
        raise ValueError("Unsupported encoded format or hardware target")
    if not isinstance(manifest["release"], str) or not manifest["release"].strip():
        raise ValueError("Release name is required")
    name = manifest["image"]
    if (not isinstance(name, str) or not name or name in (".", "..") or
            "/" in name or "\\" in name or ":" in name):
        raise ValueError("Image must be a filename next to the manifest")
    size = integer(manifest["size"], 16, bootloader.MAX_IMAGE_SIZE, "image size")
    if size % 16:
        raise ValueError("Encoded size must be a multiple of 16 bytes")
    digest = manifest["sha256"]
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("sha256 must be 64 lowercase hexadecimal digits")
    models = manifest["model_bytes"]
    if not isinstance(models, list) or not models:
        raise ValueError("At least one supported model-byte pair is required")
    for pair in models:
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError("Each model-byte pair needs registers 3 and 4")
        for value in pair:
            integer(value, 0, 255, "model byte")
    exact_keys(manifest["extension"], ("major", "minor"), "Extension")
    if type(manifest["extension"]["major"]) is not int or manifest["extension"]["major"] != 9:
        raise ValueError("This uploader verifies extension v9 images only")
    integer(manifest["extension"]["minor"], 0, 255, "extension minor")
    image_path = path.parent / name
    # Bound reads even if the supplied file is larger than its declared size.
    with image_path.open("rb") as source:
        image = source.read(bootloader.MAX_IMAGE_SIZE + 1)
    if len(image) != size or hashlib.sha256(image).hexdigest() != digest:
        raise ValueError("Encoded image size or SHA-256 does not match the release manifest")
    # A common accidental input is a raw Cortex-M image with a plausible SP/PC.
    sp, pc = int.from_bytes(image[:4], "little"), int.from_bytes(image[4:8], "little")
    if 0x20000000 <= sp <= 0x20001000 and 0x08000000 <= pc < 0x08007000 and pc & 1:
        raise ValueError("Input resembles a raw firmware image; obtain the encoded release")
    return manifest, image


def persistent(table):
    return table[4:40] + table[78:87]


def check_device(table, manifest, servo_id, baud):
    if len(table) != 87 or table[5] != servo_id:
        raise RuntimeError("Register snapshot has the wrong length or ID")
    if list(table[3:5]) not in manifest["model_bytes"]:
        raise RuntimeError(f"Unsupported model bytes {list(table[3:5])}")
    if table[6] >= len(BAUD_RATES) or BAUD_RATES[table[6]] != baud:
        raise RuntimeError("Saved baud selector differs from the requested application baud")
    if table[40] != 0 or table[55] != 1 or table[65] != 0:
        raise RuntimeError("Requires torque off (40=0), persistence locked (55=1), no alarm (65=0)")


def verify_application(ser, manifest, servo_id, baud, table, before=None):
    check_device(table, manifest, servo_id, baud)
    if before is not None and persistent(table) != persistent(before):
        raise RuntimeError("Persistent settings changed; inspect the saved before/after snapshots")
    # Extension replies add a result byte before the eight capability bytes.
    caps = bootloader.exchange(ser, servo_id, 0x90, bytes([0x90, 8]), 9)
    version = manifest["extension"]
    if (caps[:5] != b"\x00ARMC" or caps[5:7] != bytes([version["major"], version["minor"]])
            or caps[8] != 1):
        raise RuntimeError("Application extension capabilities do not match the release")
    return caps


def save_report(directory, report):
    temporary = directory / "report.json.tmp"
    temporary.write_text(json.dumps(report, indent=2) + "\n")
    temporary.replace(directory / "report.json")


def execute(args, manifest, image):
    recovery = args.command == "recover"
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix=time.strftime("%Y%m%d-%H%M%S-"), dir=output))
    report = {"release": manifest, "port": args.port, "id": args.id, "baud": args.baud,
              "mode": args.command, "status": "preflight", "phase": "opening",
              "settings_verification": "unavailable in recovery" if recovery else "pending",
              "started_unix_s": time.time(), "acknowledged_blocks": 0}
    save_report(directory, report)  # Refuse to touch hardware without writable evidence.
    print(f"Report: {directory / 'report.json'}", flush=True)
    try:
        with serial.Serial(args.port, baudrate=bootloader.BOOT_BAUD if recovery else args.baud,
                           timeout=0, write_timeout=0.5) as ser:
            time.sleep(0.100)
            before = None
            if not recovery:
                before = bootloader.registers(ser, args.id)
                report["before_registers_hex"] = before.hex()
                save_report(directory, report)
                check_device(before, manifest, args.id, args.baud)
            print(f"Release: {manifest['release']}; encoded bytes: {len(image)}; target ID: {args.id}")
            print("Connect ONLY the intended servo. Keep torque disabled and the power supply connected.")
            if recovery:
                print("Recovery cannot check model or settings first. Confirm hardware compatibility yourself.")
            if not args.yes and input("Type FLASH to continue: ").strip() != "FLASH":
                report["status"] = "cancelled"
                return 1
            if not recovery:
                # A long confirmation pause must not bypass the original preflight.
                fresh = bootloader.registers(ser, args.id)
                check_device(fresh, manifest, args.id, args.baud)
                if persistent(fresh) != persistent(before):
                    raise RuntimeError("Settings changed after preflight; restart with a fresh snapshot")
            report["phase"] = "transfer"
            save_report(directory, report)
            if recovery:
                print("Probing for up to 60 seconds. Power-cycle the isolated servo NOW.", flush=True)

            def progress(done, total):
                report["acknowledged_blocks"] = done
                report["total_blocks"] = total
                if done % 16 == 0 or done == total:
                    print(f"Acknowledged {done}/{total} blocks", flush=True)

            bootloader.upload(ser, args.id, image, recovery, progress)
            report["transfer_complete"] = True
            report["phase"] = "application-verification"
            save_report(directory, report)
            # Retain the actual post-upload table even if a subsequent check fails.
            ser.baudrate = args.baud
            time.sleep(1.0)
            after = bootloader.registers(ser, args.id)
            report["after_registers_hex"] = after.hex()
            save_report(directory, report)
            caps = verify_application(ser, manifest, args.id, args.baud, after, before)
            report["capabilities_hex"] = caps.hex()
            report["settings_verification"] = "unavailable in recovery" if recovery else "unchanged"
            report["status"] = "verified"
            print("Upload and application checks passed. This is not firmware hash readback.")
            return 0
    except KeyboardInterrupt:
        report["status"] = "interrupted"
        report["error"] = "Interrupted; the device may require recovery"
        print(report["error"], file=sys.stderr)
        return 130
    except (OSError, RuntimeError, ValueError, serial.SerialException, EOFError) as error:
        report["status"] = "failed"
        report["error"] = str(error)
        print(str(error), file=sys.stderr)
        return 1
    finally:
        report["finished_unix_s"] = time.time()
        save_report(directory, report)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("inspect", "flash", "recover"):
        sub = commands.add_parser(command)
        sub.add_argument("--manifest", required=True, type=Path)
        if command != "inspect":
            sub.add_argument("--port", required=True)
            sub.add_argument("--id", required=True, type=int, choices=range(254), metavar="0..253")
            sub.add_argument("--baud", type=int, choices=BAUD_RATES, default=1_000_000)
            sub.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
            sub.add_argument("--yes", action="store_true", help="Skip the FLASH confirmation")
    args = parser.parse_args(argv)
    try:
        manifest, image = load_release(args.manifest)
        if args.command == "inspect":
            print(json.dumps({"manifest": manifest, "encoded_bytes_verified": len(image)}, indent=2))
            return 0
        return execute(args, manifest, image)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
