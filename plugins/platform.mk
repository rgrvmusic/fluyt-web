#!/usr/bin/make -f
# SPDX-License-Identifier: MIT
# Fluyt web - the browser preview of Felucca's engines as Fluyt units.
# Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
#
# ---------------------------------------------------------------------------------------------
# The web build of one Fluyt unit, in the shape rfx/plugins/ already uses.
#
# This file is deliberately the same machine as a plugin Makefile in rfx/plugins/ - EMCC, a
# WASM_CFLAGS whose runtime methods and module name are spelled out, a WASM_EXPORTS that lists the
# regroove_synth_* entry points by hand, a WASM_OUTPUT named <name>-synth.js, and a `web` target
# that builds the pair and copies it into WEB_DIR. That is not decoration: the modules these
# produce are meant to be droppable into rfx/web/rfxsynths/ later, and a pair built any other way
# is a pair that has to be debugged there.
#
#   make web                             build and copy into dist/wasm/
#   make web WEB_DIR=/path/to/rfxsynths  build and copy there instead
#   make clean
#
# ---------------------------------------------------------------------------------------------
# Why the exports are listed rather than left to EMSCRIPTEN_KEEPALIVE
#
# rfx/web/replugged/worklets/synth-worklet-processor.js binds the module by name, in
# mapWasmFunctions():
#
#   create = _regroove_synth_create          note_off = _regroove_synth_note_off
#   destroy = _regroove_synth_destroy        all_notes_off = _regroove_synth_all_notes_off
#   reset = _regroove_synth_reset            process = _regroove_synth_process_f32
#   note_on = _regroove_synth_note_on        set_parameter_value = _regroove_synth_set_parameter
#
# and it throws outright if create is missing ("regroove_synth_create not found in WASM exports"),
# never sounds a note if note_on is missing, and reports no presets if the count name is not there.
# So a name that is one word off is not a warning in a console, it is silence. Listing them in
# EXPORTED_FUNCTIONS is what holds the build to the list: emcc fails the link on a name that no
# longer exists, where EMSCRIPTEN_KEEPALIVE alone would quietly export whatever it currently
# compiles and let the worklet find nothing.
#
# The count is the one place the worklet asks for two names. getPresetCount() checks
# _regroove_synth_bank_get_num_presets first and falls through to _regroove_synth_get_preset_count;
# wasm/wasm_bindings.c answers to both, so either reading of it works.
# ---------------------------------------------------------------------------------------------

EMCC ?= emcc

# This file's own directory, so a unit Makefile can be run from anywhere.
FLUYT_ROOT := $(abspath $(dir $(abspath $(lastword $(MAKEFILE_LIST))))/..)
VENDOR     := $(FLUYT_ROOT)/vendor/fluyt-logue
FELUCCA    := $(VENDOR)/felucca
GEN_DIR    := $(FLUYT_ROOT)/build/gen
UNIT_DIR   := $(VENDOR)/$(UNIT)

# Where the built pair lands. dist/wasm/ is this repository's own page; point WEB_DIR at
# rfx/web/rfxsynths/ to drop the pair straight into that environment instead.
WEB_DIR ?= $(FLUYT_ROOT)/dist/wasm

# Where emcc writes it - build/, next to the generated tables, and gitignored with them.
#
# Not this unit's own directory, which is where `emcc -o $(WASM_OUTPUT)` would put it. A pair
# built by hand is then a pair left lying in a source tree: 18 files and 470 KB of compiled
# engine, which `git status` offers to commit and which a fresh `git add` takes. The unit
# directory holds what was written about the unit - a config.mk and a rows.def - and nothing
# that a compiler made. The pair is only ever used through WEB_DIR in any case; where the
# compiler left it on the way there is not a fact anyone needs to keep.
OBJ_DIR := $(FLUYT_ROOT)/build/wasm
WASM_OUTPUT := fluyt-$(SLUG)-synth.js

# ---------------------------------------------------------------------------------------------
# The unit's own flags, read out of its own config.mk rather than restated here.
#
# That is the point: a unit whose config.mk is wrong fails this build, rather than the build
# agreeing with a second copy of the same mistake. vendor/.../tools/hostcheck.sh reads them the
# same way, and so does fluyt-logue's own build.
#
# The escape in -DFLUYT_UNIT_NAME=\"FLUYT\ ANALOG\" is what keeps the name one word, and it is why
# UDEFS is passed as one variable rather than spelled out in the recipe: make hands the text
# through to the shell untouched, and the shell is what resolves \" to a quote and "\ " to a space.
# ---------------------------------------------------------------------------------------------
UDEFS := $(shell sed -n 's/^UDEFS[[:space:]]*\(+*\)=[[:space:]]*//p' $(UNIT_DIR)/config.mk | tr '\n' ' ')

# The three flags that make Felucca's fixed-point arithmetic portable to a second toolchain: the
# FM-1's char is signed, its arithmetic wraps, and its DSP puns types (so no strict aliasing).
COPT := $(shell sed -n 's/^USE_COPT[[:space:]]*:*=[[:space:]]*//p' $(UNIT_DIR)/config.mk | tr '\n' ' ')

# ---------------------------------------------------------------------------------------------
# Compiler and linker flags
#
# EXPORTED_RUNTIME_METHODS is rfx's list plus the three this repository's own page and Node checks
# use: cwrap/ccall are what rfx's worklet calls into for set_text, and UTF8ToString/HEAPF32/HEAPU8
# are how a preset name or an audio buffer is read back without re-deriving a view by hand.
#
# ENVIRONMENT names node as well as web and worker. rfx's builds leave it unset, which means all
# of them; naming them explicitly is the same set minus the shells this will never run in, and node
# is in it because tools/smoke.mjs and tools/tunecheck.mjs load these modules in Node - which is
# what lets the pattern parser and every preset be checked without a browser.
#
# FILESYSTEM=0 is the one flag here rfx's plugins do not set. An engine reads no files - its tables
# are compiled in - so the whole fs/mount library is dead weight the worklet would carry: measured
# across the nine, it is 636 KB of modules rather than 820 KB. The node branch that wants
# require("node:fs") survives it either way, because that is the loader emscripten would use to find
# its own .wasm, and ENVIRONMENT=node emits it whether or not the filesystem is compiled in. That
# branch is never taken - instantiateWasm is supplied - but it is evaluated once at startup, which
# is why the Node harness supplies the CommonJS names a real host would.
#
# No -s EXPORT_ES6: the worklet loads this glue as CommonJS (src/worklet/fluyt-worklet.js), because
# Emscripten's current getBinarySync ignores wasmBinary and would try to fetch() the .wasm, which an
# AudioWorklet cannot do.
#
# INITIAL_MEMORY is what keeps one part from reserving 16 MB for a 50 KB engine - the page runs
# four module instances at once, each with statics of its own. ALLOW_MEMORY_GROWTH is what lets
# them grow past it if they need to.
# ---------------------------------------------------------------------------------------------
WASM_CFLAGS = -O3 \
              -s WASM=1 \
              -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","UTF8ToString","HEAPF32","HEAPU8"]' \
              -s ALLOW_MEMORY_GROWTH=1 \
              -s MODULARIZE=1 \
              -s EXPORT_NAME='$(WASM_MODULE)' \
              -s ENVIRONMENT=web,worker,node \
              -s FILESYSTEM=0 \
              -lm

WASM_LDFLAGS = -s INITIAL_MEMORY=8388608

WASM_EXPORTS = \
  -s EXPORTED_FUNCTIONS='[\
    "_malloc","_free",\
    "_regroove_synth_create",\
    "_regroove_synth_destroy",\
    "_regroove_synth_reset",\
    "_regroove_synth_note_on",\
    "_regroove_synth_note_off",\
    "_regroove_synth_all_notes_off",\
    "_regroove_synth_process_f32",\
    "_regroove_synth_set_parameter",\
    "_regroove_synth_set_parameter_int",\
    "_regroove_synth_get_parameter",\
    "_regroove_synth_get_parameter_max_value",\
    "_regroove_synth_get_num_params",\
    "_regroove_synth_get_param_str",\
    "_regroove_synth_get_preset_count",\
    "_regroove_synth_bank_get_num_presets",\
    "_regroove_synth_get_preset_name",\
    "_regroove_synth_load_preset",\
    "_fluyt_web_sample_rate",\
    "_fluyt_web_preset_index",\
    "_fluyt_web_engine_name"\
  ]'

# GEN_DIR comes first: that is what stands in for the shim/gen a logue build would have found
# inside the submodule. -I$(UNIT_DIR) is for the unit's rows.def; wasm_bindings.c includes the
# bridge the way tools/hostsim.c does.
WASM_INCLUDES = -I$(GEN_DIR) -I$(FLUYT_ROOT) -I$(UNIT_DIR) \
                -I$(VENDOR)/shim -I$(FELUCCA)/firmware/src

WASM_SOURCES = $(FLUYT_ROOT)/wasm/wasm_bindings.c

# ---------------------------------------------------------------------------------------------
# Targets
#
# `tables` is a prerequisite rather than an order-only one and is phony, so gen-tables.sh runs on
# every build - it stats two headers and greps them, and exits. It has to be reachable this way
# because `make -C plugins/fluyt_fm6_drumlogue web` has to work on its own, the way it does in
# rfx/plugins/: the tables are the one thing a single unit cannot build for itself, and a unit
# Makefile that assumed someone had run a driver first would fail the first time it was run alone.
# ---------------------------------------------------------------------------------------------
.PHONY: web tables clean

web: tables
	@echo "Building $(UNIT) for WebAssembly..."
	@mkdir -p $(OBJ_DIR)
	$(EMCC) $(WASM_CFLAGS) $(WASM_LDFLAGS) $(WASM_EXPORTS) $(COPT) $(WASM_INCLUDES) $(UDEFS) $(WASM_SOURCES) -o $(OBJ_DIR)/$(WASM_OUTPUT)
	@mkdir -p $(WEB_DIR)
	@cp $(OBJ_DIR)/$(WASM_OUTPUT) $(OBJ_DIR)/$(WASM_OUTPUT:.js=.wasm) $(WEB_DIR)/
	@echo "Built and copied to $(WEB_DIR)/"

tables:
	@$(FLUYT_ROOT)/tools/gen-tables.sh

clean:
	rm -f $(OBJ_DIR)/$(WASM_OUTPUT) $(OBJ_DIR)/$(WASM_OUTPUT:.js=.wasm)
