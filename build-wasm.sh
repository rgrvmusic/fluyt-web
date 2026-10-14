#!/bin/bash
# SPDX-License-Identifier: MIT
# Fluyt web - the browser preview of Felucca's engines as Fluyt units.
# Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
#
# Like build.sh and build-microkorg2.sh in vendor/fluyt-logue, this script is MIT. What is
# compiled - Felucca's source, and the Fluyt bridge around it - is not: the modules it writes are
# GPL-3.0-only, because Felucca is. See LICENSING.md.
# Felucca is Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments.
#
# The driver for the whole web build, the way rfx/web/build-all-synths.sh drives rfx/plugins/.
#
#   ./build-wasm.sh                     all nine engines into dist/wasm/
#   ./build-wasm.sh fluyt_fm6_drumlogue just the ones named
#   FORCE_TABLES=1 ./build-wasm.sh      regenerate the 48 kHz tables even if they look current
#   EMCC=/path/to/emcc ./build-wasm.sh  a compiler that is not the one on PATH
#
# The build itself lives in plugins/, one Makefile per engine, and is the pattern rfx/plugins/ uses:
# a WASM_OUTPUT named <name>-synth.js, an EXPORTED_FUNCTIONS list that spells the regroove_synth_*
# entry points out by hand, and a `web` target that copies the pair into WEB_DIR. This script adds
# what a driver adds: the prerequisite checks, the engine list the page starts from, and one place
# to run the whole set. Nothing about an engine is decided here - each unit's flags come out of its
# own config.mk (plugins/platform.mk).
#
# No container, no device, no logue SDK: the bridge (shim/fluyt_engine.c) has no SDK dependency -
# only shim/fluyt_header.c and shim/fluyt_unit.c do, and neither is compiled here - so emcc and the
# submodule are the whole requirement.

set -e
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

OUT_DIR="${WEB_DIR:-$ROOT/dist/wasm}"
EMCC="${EMCC:-emcc}"

UNITS="fluyt_analog_drumlogue fluyt_trio_drumlogue fluyt_phase_drumlogue \
       fluyt_lofi_drumlogue fluyt_wheel_drumlogue fluyt_noise_drumlogue \
       fluyt_formant_drumlogue fluyt_drum_drumlogue fluyt_fm6_drumlogue"

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

if [ "$#" -eq 0 ]; then
    WANT="$UNITS"
else
    WANT="$*"
fi

if ! command -v "$EMCC" >/dev/null 2>&1; then
    echo -e "${RED}Error: $EMCC is not on PATH.${NC}" >&2
    echo "       Activate the emsdk first, e.g." >&2
    echo "         source ~/Applications/emsdk/emsdk_env.sh" >&2
    echo "       or point EMCC at the compiler you mean to use." >&2
    exit 1
fi

if [ ! -f "vendor/fluyt-logue/felucca/firmware/src/eng_analog.c" ]; then
    echo -e "${RED}Error: the submodule is not checked out.${NC}" >&2
    echo "       git submodule update --init --recursive" >&2
    exit 1
fi

echo "========================================"
echo "Building the Fluyt engines for the web"
echo "========================================"
echo "emcc:    $($EMCC --version | head -1)"
echo "Sources: vendor/fluyt-logue"
echo "Output:  $OUT_DIR"
echo ""

# ---------------------------------------------------------------- 1. tables ---

# Felucca's tables are correct for one rate and the build renders at that rate or not at all; see
# tools/gen-tables.sh. It is idempotent, and the units depend on it too, so that a single-unit
# `make -C plugins/fluyt_fm6_drumlogue web` works on its own.
"$ROOT/tools/gen-tables.sh"

# ---------------------------------------------------------------- 2. modules ---

echo ""

# One `make -C plugins/<unit> web` per engine, which is the form rfx/plugins/ uses: the master
# Makefile for the whole set, a unit Makefile for one, and the same recipe behind both. The engine
# list below is read afterwards from what actually landed, so it cannot offer an engine this run
# did not produce. set -e stops the run at the first engine that will not build, rather than
# carrying on and leaving a page that is missing one.
for unit in $WANT; do
    make -C "plugins/$unit" web WEB_DIR="$OUT_DIR"
done

# ---------------------------------------------------------------- 3. manifest ---

# The engine list the page starts from: the slug it names the part's module by, the unit's own name
# for the selector, and the file the glue and the binary share a stem with. Everything else about
# an engine - its preset names, its preset count, Felucca's own name for it - the module answers for
# itself once loaded, so this file cannot drift from the firmware the way a second copy of that
# data would.
ENTRIES=""
for unit in $WANT; do
    mkfile="plugins/$unit/Makefile"
    [ -f "$mkfile" ] || { echo -e "${RED}no such unit: $unit${NC}" >&2; exit 1; }

    slug=$(sed -n 's/^SLUG[[:space:]]*:=[[:space:]]*//p' "$mkfile")
    module="fluyt-$slug-synth.js"

    # Only list an engine whose pair is actually there: a partial build should give a shorter list
    # rather than a page that offers a module it will fail to fetch.
    [ -f "$OUT_DIR/$module" ] || continue

    # The drumlogue's own name for the unit ("FLUYT ANALOG"), unescaped. It is what the page shows
    # before a module has been loaded to ask, and it is read here rather than restated so this file
    # cannot disagree with the config.mk the build just used.
    name=$(sed -n 's/.*-DFLUYT_UNIT_NAME=\\"\(.*\)\\".*/\1/p' "vendor/fluyt-logue/$unit/config.mk" | tr -d '\\')
    [ -n "$name" ] || name="$slug"

    entry="{\"slug\":\"$slug\",\"name\":\"$name\",\"module\":\"$module\"}"
    if [ -z "$ENTRIES" ]; then ENTRIES="$entry"; else ENTRIES="$ENTRIES,$entry"; fi
done

mkdir -p "$OUT_DIR"
printf '[\n  %s\n]\n' "$(echo "$ENTRIES" | sed 's/},{/},\n  {/g')" > "$OUT_DIR/engines.json"

echo ""
echo "========================================"
echo -e "${GREEN}$(echo "$ENTRIES" | tr ',' '\n' | grep -c slug) modules in $OUT_DIR${NC}"
echo "$(du -sh "$OUT_DIR" | cut -f1) in all"
echo ""
