# SPDX-License-Identifier: MIT
# fluyt_analog_drumlogue - Felucca's ANALOG engine, for the browser.
#
# Felucca's eng_analog.c (ENG_ANALOG), through the same shim/fluyt_engine.c bridge the drumlogue unit
# compiles, over the panel that unit ships (its own rows.def). FLUYT_TARGET_MICROKORG2 is absent
# from its config.mk, so the bridge renders the full voice - Felucca's ADSR, its filter envelope,
# its LFO - rather than the microKORG2's oscillator module, whose envelope is held open because the
# instrument supplies its own. The full voice is what makes an engine recognisable, and a preview
# is for recognising.
#
# Every -D below comes out of this unit's own config.mk and is read there rather than restated
# here, so a unit whose config is wrong fails this build too. See ../platform.mk.
#
# Felucca's virtual-analog voice: the one every other engine here is heard against.
#
#   make web                                      build and copy into ../../dist/wasm/
#   make web WEB_DIR=/path/to/rfx/web/rfxsynths   drop it into that environment instead
#   make clean

UNIT        := fluyt_analog_drumlogue
SLUG        := analog
WASM_MODULE := FluytAnalogModule

include ../platform.mk
