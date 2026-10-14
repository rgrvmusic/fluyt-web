#!/bin/bash
# SPDX-License-Identifier: MIT
# Fluyt web - the browser preview of Felucca's engines as Fluyt units.
# Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
#
# Like build.sh in vendor/fluyt-logue, this script is MIT. What it produces - Felucca's
# generated lookup tables, and the GPL-3.0-only modules built from them - is not. See LICENSING.md.
# Felucca is Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments.
#
# Felucca's tables, generated for 48 kHz into build/gen/.
#
#   ./tools/gen-tables.sh                only if they are not already current
#   FORCE_TABLES=1 ./tools/gen-tables.sh regenerate regardless
#
# Felucca generates its own tables for 44.1 kHz; 48 kHz is the drumlogue's rate, and the drumlogue
# is the panel this build renders (see plugins/platform.mk). Everything the tables hold - pitch,
# envelope times, LFO rates, cutoff, levels, decay, the soft clip - would be 8.8% out at any other
# rate, and fluyt_init() only records the rate it is given without deriving anything from it. So
# this is the one place the rate is decided, and the page's AudioContext has to agree with it.
#
# The tables live in vendor/.../shim/gen/ for the logue units, but that directory is gitignored in
# that repository and so is not in the submodule; and writing into a submodule would leave it
# dirty. They are generated into build/ instead, which the compiler is then pointed at with
# -I$(GEN_DIR) - and because it comes first, that is where a unit's config.mk finds shim/gen.
#
# Both generators are pure computation writing to the path they are handed: neither reads anything
# relative to the working directory, so being run from here rather than from inside the submodule
# changes nothing about what comes out.

set -e
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FELUCCA="$ROOT/vendor/fluyt-logue/felucca"
GEN_DIR="${GEN_DIR:-$ROOT/build/gen}"
FLUYT_FS="${FLUYT_FS:-48000}"

if [ ! -d "$FELUCCA/tools" ]; then
    echo "gen-tables: the submodule is not checked out." >&2
    echo "            git submodule update --init --recursive" >&2
    exit 1
fi

mkdir -p "$GEN_DIR"

# Correct for one rate, and the header says which, so the regeneration is skipped only when the
# header is there, is newer than both generators, and is for the rate this build renders at - the
# same test vendor/.../build.sh makes. FORCE_TABLES overrides it.
tables_current() {
    [ -z "$FORCE_TABLES" ] &&
        [ -f "$GEN_DIR/felucca_tables.h" ] &&
        [ -f "$GEN_DIR/felucca_fm6.h" ] &&
        [ "$GEN_DIR/felucca_tables.h" -nt "$FELUCCA/tools/gen_tables.py" ] &&
        [ "$GEN_DIR/felucca_fm6.h" -nt "$FELUCCA/tools/gen_fm6_patches.py" ] &&
        grep -q "^#define FS $FLUYT_FS\$" "$GEN_DIR/felucca_tables.h"
}

if [ -z "${FORCE_TABLES:-}" ] && tables_current; then
    echo "tables: current ($FLUYT_FS Hz)"
    exit 0
fi

echo "tables: generating for $FLUYT_FS Hz -> $GEN_DIR/"

# FS is a module global that main() reads, so setting it here is what makes this the 48 kHz tables
# Felucca would have generated for itself.
python3 -c "
import sys
sys.path.insert(0, '$FELUCCA/tools')
import gen_tables
gen_tables.FS = $FLUYT_FS
gen_tables.main('$GEN_DIR/felucca_tables.h')
"

# gen_fm6_patches.py writes to sys.argv[1] and reads nothing of its own
python3 "$FELUCCA/tools/gen_fm6_patches.py" "$GEN_DIR/felucca_fm6.h"

# A header that came out for another rate would compile, link, and sound 8.8% wrong, so say so here
# rather than in a browser.
grep -q "^#define FS $FLUYT_FS\$" "$GEN_DIR/felucca_tables.h" ||
    { echo "gen-tables: the tables came out for another rate." >&2; exit 1; }

echo "tables: ok"
