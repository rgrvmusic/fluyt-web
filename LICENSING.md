# Fluyt web licensing

Copyright (C) 2026 Gerard Braad - **Regroove | RGRV**.

This repository is two things under two licences, and which one applies to a file depends on
whether that file reaches the browser as source or as a compiled engine.


## The web code - MIT

The page and everything it is made of is **MIT**, copyright (C) 2026 Gerard Braad
(Regroove | RGRV). The full text is in [LICENSE](LICENSE). That is:

| | |
| --- | --- |
| `src/` | the two pages, the stylesheet, the JavaScript, the AudioWorklet |
| `src/tune/fluyt-tune.mid` | the tune itself - an original work, written for this page, MIT like the rest of `src/`. It is the only file here that is not source: it is the MIDI file the page plays, generated from the notation in `src/js/tune.js` by `make midi` |
| `wasm/wasm_bindings.c` | the browser ABI - the only C here that is MIT |
| `plugins/`, `build-wasm.sh`, `Makefile` | the build |
| `tools/` | the checks |

Nothing here is anyone else's music. The tune is original and the file is generated from this
repository's own notation, so there is no sample, no transcription and no quotation to clear - and
none to attribute.


## The compiled modules - GPL-3.0-only

`dist/wasm/` - the nine `.js`/`.wasm` pairs the build produces - is **GPL-3.0-only**, and so is
each one of them on its own. They are not merely built from GPL code, they *contain* it: a module
has Felucca's engine, Felucca's support code, the Fluyt bridge and the unit's own entry points
compiled into it, which is the point of the `#include "fluyt_engine.c"` at the top of
`wasm/wasm_bindings.c` and of `shim/fluyt_unit.c` beside it. A module is a derivative work of
everything in it.

So `wasm_bindings.c` being MIT does not make a module MIT. It is the same exception
[`fluyt-logue`](https://github.com/rgrvmusic/fluyt-logue) draws for its own build scripts: the code
written *for* the GPL work stays MIT, and the GPL work it is compiled into stays GPL.

**Corresponding source.** For these modules that is this repository at the commit that built them,
plus the `vendor/fluyt-logue` submodule at its pinned commit - every module is built from
`wasm/wasm_bindings.c` and that submodule and nothing else. The submodule is
[`fluyt-logue`](https://github.com/rgrvmusic/fluyt-logue) itself: the Fluyt bridge, the
nine units' configuration, and Felucca nested inside it. So the source offer is that repository and
this one, and the page footer links to it.


## Felucca

Felucca is a **git submodule** inside `vendor/fluyt-logue/felucca/`, pinned to tag
`v1.0.2` (`db70550344f36cb10657d1652f567b5932ac4b2b`), and is **unmodified**: this repository has no
patch, no cherry-pick and no local change against it - `build-wasm.sh` compiles Felucca's files
exactly as upstream ships them, through the bridge in the submodule. Felucca is **GPL-3.0-only**,
copyright (C) 2026 Leo Kuroshita ([@kurogedelic](https://github.com/kurogedelic)), Hügelton
Instruments; its own `LICENSE` and `LICENSING.md` are inside the submodule.

Everything in Felucca that a module here compiles in is GPL-3.0-only, with the two carried-through
exceptions that are part of Felucca upstream and are recorded in full in Felucca's own
`LICENSING.md`, and again in `fluyt-logue`'s `docs/LICENSING.md`:

| File | Licence | Where it is used |
| --- | --- | --- |
| `firmware/src/fm6_core.c` - a port of **msfa** by Google Inc. and Pascal Gauthier, from Dexed (<https://github.com/asb2m10/dexed>), to integer C | Apache-2.0 | pulled in by `eng_fm6.c`, so it is in **FLUYT FM6** |
| `firmware/src/eng_phase.c` - the PHASE waveforms, a C port of the oscillator of CrispyZebra (<https://github.com/hugelton/CrispyZebra>) | GPL-3.0 | **FLUYT PHASE** |


## The generated tables

`build/gen/` holds `felucca_tables.h` and `felucca_fm6.h`, produced at build time by **Felucca's own
generators** run against the submodule, at 48 kHz instead of Felucca's 44.1 kHz. The generators are
Felucca's (`felucca/tools/gen_tables.py`, `gen_fm6_patches.py`, GPL-3.0-only), the output is derived
from Felucca's source and tables, and it is GPL-3.0-only for the same reason. `tools/gen-tables.sh`
generates it into `build/`, outside the submodule, so the submodule is never left dirty - and it is
not checked in, so a release made from this repository builds it from the pinned submodule, which
`make` does.

**Why 48 kHz is not cosmetic.** Felucca generates these tables for a sample rate, and
`fluyt_init` merely records the rate it is handed - nothing resamples. So the tables here are
generated at 48 kHz and the page constructs its `AudioContext` at 48000 to match. At the default
44.1 kHz of most hardware, every engine would play 8.8% flat and slow. It is not a detail: it is
the difference between the preview and the unit.


## The logue SDK - four headers, BSD 3-Clause

Four of the logue SDK's drumlogue headers are vendored in `vendor/logue-sdk/`: `unit.h`,
`runtime.h`, `attributes.h` and `sample_wrapper.h` - 364 lines, copied verbatim and unmodified,
with the SDK's own `LICENSE` beside them. They are what the device's entry points are declared in
(`shim/fluyt_unit.c`, in the submodule), and those are what `wasm/wasm_bindings.c` calls, so a
module reaches its engine through the same functions the hardware calls and needs the declarations
to compile. `vendor/logue-sdk/README.md` records where they came from and the commit they were
taken at.

The SDK is **BSD 3-Clause**, Copyright (c) 2018 KORG INC. - compatible with this repository's MIT
and with the GPL-3.0-only modules, and the four headers stay BSD-3 in the modules they are compiled
into.

Nothing else of the SDK is here. No engine, no LUT, no runtime and no `_unit_base.c`: the shim's
engine translation unit has no SDK dependency at all - which is why these modules are cheap to
build - and a unit that defines every entry point it is called through needs none of the weak
fallbacks that file provides. For the same reason a full checkout is not required, though one can
be used where it is wanted: `make web LOGUE_SDK=/path/to/logue-sdk` builds against it.


## Regroove | RGRV

Fluyt web is by **Gerard Braad (Regroove | RGRV)**. It is the preview for
[Fluyt](https://github.com/rgrvmusic/fluyt-logue), the drumlogue and microKORG2 units that carry the
developer id `0x72677276` - "rgrv" - with unit ids `0x464C5901`..`0x464C5909`.


## Trademarks

"drumlogue" and "microKORG2" are trademarks of KORG Inc. "Felucca" and "Hügelton Instruments" are
names of Hügelton Instruments. Fluyt is independent work: it is not affiliated with, endorsed by or
supported by KORG or by the owners of the FM-1.

