# SPDX-License-Identifier: MIT
# fluyt_lofi_drumlogue - Felucca's LOFI engine, for the browser.
#
# Felucca's eng_lofi.c (ENG_LOFI), through the same shim/fluyt_engine.c bridge the drumlogue unit
# compiles, over the panel that unit ships (its own rows.def). FLUYT_TARGET_MICROKORG2 is absent
# from its config.mk, so the bridge renders the full voice - Felucca's ADSR, its filter envelope,
# its LFO - rather than the microKORG2's oscillator module, whose envelope is held open because the
# instrument supplies its own. The full voice is what makes an engine recognisable, and a preview
# is for recognising.
#
# Every -D below comes out of this unit's own config.mk and is read there rather than restated
# here, so a unit whose config is wrong fails this build too. See ../platform.mk.
#
# Degraded, band-limited and noisy - the engine that sounds like a broken sampler on purpose.
#
#   make web                                      build and copy into ../../dist/wasm/
#   make web WEB_DIR=/path/to/rfx/web/rfxsynths   drop it into that environment instead
#   make clean

UNIT        := fluyt_lofi_drumlogue
SLUG        := lofi
WASM_MODULE := FluytLofiModule

include ../platform.mk
