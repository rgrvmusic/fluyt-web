# SPDX-License-Identifier: MIT
# Fluyt web - the browser preview of Felucca's engines as Fluyt units.
# Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
#
#   make          build dist/ - the wasm modules, then the page over them
#   make wasm     just the modules (dist/wasm/), for iterating on the C
#   make midi     write the tune out to src/tune/fluyt-tune.mid, after editing the notation
#   make check    load every module, read the tune back, and render it, in node
#   make serve    serve dist/ on :8000 - a browser will not run this from file://
#   make clean    remove dist/ and build/
#
# The result of `make` is dist/ and nothing else: it is what gets deployed, it is what `make serve`
# serves, and it is gitignored. The one built thing that *is* committed is the tune - it is the file
# the page plays, so it is a source file, written by `make midi` from the notation in src/js/tune.js
# and checked by `make midicheck` to still be what that notation says.

EMCC ?= emcc
PORT ?= 8000

DIST := dist
BUILD := build
WASM_DIR := $(DIST)/wasm

# The page is plain ES modules and a worklet, with no bundler and no build step of its own: src/ is
# already what the browser runs, so building is copying it next to the modules. Anything that would
# need compiling belongs in plugins/ with the rest of the C.
PAGE_SRC := src

.PHONY: all wasm page midi check smoke pagecheck midicheck tunecheck workletcheck serve clean

all: page

# --------------------------------------------------------------------------------------------
# wasm

wasm: $(WASM_DIR)/engines.json

# Rebuild when the build itself changes. Not when anything under vendor/ changes: that is a whole
# copy of Felucca and fluyt-logue, and walking it on every `make serve` would cost more than the
# build. A change to the engine sources is what `make clean && make` is for.
$(WASM_DIR)/engines.json: build-wasm.sh tools/gen-tables.sh wasm/wasm_bindings.c \
                          $(wildcard plugins/platform.mk plugins/Makefile plugins/*/Makefile)
	@command -v $(EMCC) >/dev/null 2>&1 || { \
	    echo "emcc is not on PATH. For the local toolchain:"; \
	    echo "    source ~/Applications/emsdk/emsdk_env.sh"; \
	    exit 1; }
	@./build-wasm.sh

# the modules are a prerequisite of everything below, so `make check` on a clean tree builds first
page: wasm
	@rm -rf $(DIST)/css $(DIST)/js $(DIST)/worklet
	@cp -r $(PAGE_SRC)/. $(DIST)/
	@echo "dist/ is ready - run 'make serve' and open http://localhost:$(PORT)/"

# --------------------------------------------------------------------------------------------
# the tune

# The page plays src/tune/fluyt-tune.mid, and the notation in src/js/tune.js is where it is written:
# this turns one into the other. Nothing depends on it - the file is committed - so it is a rule to
# run after editing the notation, not a step of the build.
midi:
	@node tools/tune-to-mid.mjs

# --------------------------------------------------------------------------------------------
# check

check: smoke pagecheck midicheck tunecheck workletcheck

smoke: wasm
	@node tools/smoke.mjs

pagecheck:
	@node tools/pagecheck.mjs

midicheck:
	@node tools/midicheck.mjs

tunecheck: wasm
	@node tools/tunecheck.mjs

workletcheck: wasm
	@node tools/workletcheck.mjs

# --------------------------------------------------------------------------------------------
# serve

# Not a convenience. The page is ES modules and loads an AudioWorklet, and a browser refuses both
# from file:// - so without a server there is nothing to check by hand.
serve: page
	@echo "http://localhost:$(PORT)/  -  ctrl-c to stop"
	@cd $(DIST) && python3 -m http.server $(PORT)

clean:
	rm -rf $(DIST) $(BUILD)

# The submodule carries the engine sources and Felucca itself. Without it there is nothing to build,
# so say what to run rather than letting the compiler report a missing header.
ifeq ($(wildcard vendor/fluyt-logue/felucca/firmware/src/eng_analog.c),)
$(warning vendor/fluyt-logue is empty - run: git submodule update --init --recursive)
endif
