#!/usr/bin/make -f
# SPDX-License-Identifier: MIT
# Fluyt web - the browser preview of Felucca's engines as Fluyt units.
# Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
#
# Master Makefile for building every Fluyt engine for the browser, the same way
# rfx/plugins/Makefile is the master for the rfx plugins.
#
#   make web                             all nine, into ../dist/wasm/
#   make web WEB_DIR=...                 all nine, into that directory instead
#   make -C fluyt_fm6_drumlogue web      just that one - the form that has to work, because
#                                        rebuilding one engine while editing its page is the loop
#                                        this build serves
#   make clean
#
# WEB_DIR is passed down rather than re-derived, so `make web WEB_DIR=/path/to/rfx/web/rfxsynths`
# drops the whole set into that environment in one command.
#
# The nine are the DRUMLOGUE units. The microKORG2 units are a second output set - the bridge
# renders one held-open oscillator module per lane instead of the full voice - and are not built
# here; see ../README.md.

# Defaulted here and not only in platform.mk, because it is passed down to every unit: an unset
# WEB_DIR would be handed on as an empty one, and `WEB_DIR ?=` in platform.mk would then decline to
# fill it in. One assignment at the top is what keeps the default and an override the same value.
WEB_DIR ?= $(abspath ../dist/wasm)

UNITS = fluyt_analog_drumlogue \
        fluyt_trio_drumlogue \
        fluyt_phase_drumlogue \
        fluyt_lofi_drumlogue \
        fluyt_wheel_drumlogue \
        fluyt_noise_drumlogue \
        fluyt_formant_drumlogue \
        fluyt_drum_drumlogue \
        fluyt_fm6_drumlogue

.PHONY: all web clean $(UNITS)

all: web

web: $(UNITS)

# WEB_DIR is handed to the sub-make explicitly: without it, `make web WEB_DIR=...` would build all
# nine correctly and then copy them nowhere, because the variable would never reach the unit.
$(UNITS):
	@$(MAKE) -C $@ web WEB_DIR=$(WEB_DIR)

clean:
	@for unit in $(UNITS); do $(MAKE) -C $$unit clean; done
