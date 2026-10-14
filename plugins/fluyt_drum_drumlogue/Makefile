# SPDX-License-Identifier: MIT
# fluyt_drum_drumlogue - Felucca's DRUM engine, for the browser.
#
# Felucca's eng_drum.c (ENG_DRUM), through the same shim/fluyt_engine.c bridge the drumlogue unit
# compiles, over the panel that unit ships (its own rows.def). FLUYT_TARGET_MICROKORG2 is absent
# from its config.mk, so the bridge renders the full voice - Felucca's ADSR, its filter envelope,
# its LFO - rather than the microKORG2's oscillator module, whose envelope is held open because the
# instrument supplies its own. The full voice is what makes an engine recognisable, and a preview
# is for recognising.
#
# Every -D below comes out of this unit's own config.mk and is read there rather than restated
# here, so a unit whose config is wrong fails this build too. See ../platform.mk.
#
# The one engine whose notes are General MIDI drums rather than pitches: 36 kick, 38 snare, 39 
# clap, 42 closed hat, 46 open hat. A melodic engine swapped onto the drum part is allowed and 
# sounds like what it is - those numbers become low notes - which is a fair thing for a visitor 
# to discover.
#
#   make web                                      build and copy into ../../dist/wasm/
#   make web WEB_DIR=/path/to/rfx/web/rfxsynths   drop it into that environment instead
#   make clean

UNIT        := fluyt_drum_drumlogue
SLUG        := drum
WASM_MODULE := FluytDrumModule

include ../platform.mk
