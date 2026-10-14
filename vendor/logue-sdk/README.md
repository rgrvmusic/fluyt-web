# The logue SDK's drumlogue headers, vendored

Four headers from the [logue SDK](https://github.com/korginc/logue-sdk), copied **verbatim and
unmodified**, with the SDK's own `LICENSE` beside them:

| File | Lines |
| --- | --- |
| `platform/drumlogue/common/unit.h` | 50 |
| `platform/drumlogue/common/runtime.h` | 258 |
| `platform/drumlogue/common/attributes.h` | 21 |
| `platform/drumlogue/common/sample_wrapper.h` | 35 |

Taken from `https://github.com/korginc/logue-sdk.git`, branch `main`, commit
`a891472af156dbc40c27b3b61282893398d63b98` (2025-12-26). The SDK is **BSD 3-Clause**, Copyright
(c) 2018 KORG INC.; `LICENSE` here is that licence, unmodified. The files are BSD-3 as they stand,
and stay BSD-3 in the WebAssembly modules they are compiled into - see
[`../../LICENSING.md`](../../LICENSING.md).

## Why these four, and why here

A Fluyt unit is a drumlogue unit, so the module this repository builds reaches its engine the way
the hardware does: through the `unit_*` entry points, which the bridge's `shim/fluyt_unit.c`
defines. Declaring them needs `unit.h`, and `unit.h` includes the other three. Nothing else of the
SDK is touched - no engine, no LUT, no runtime, and no `_unit_base.c`.

They are vendored rather than added as a submodule because the SDK is 102 MB and carries submodules
of its own (`platform/ext/CMSIS`, `tools/emsdk`), which `git submodule update --init --recursive`
would pull into every clone of this repository for 364 lines of declarations. The directory has the
same shape a checkout does, so pointing at a real one works unchanged:

```
make web LOGUE_SDK=/path/to/logue-sdk
```

Updating: copy the four files again with `cp -p`, at the commit this file names, and change the
commit here. A header that has moved is a build failure rather than a silent one - the unit wrapper
uses enum values and a packed descriptor from `runtime.h`, and either one changing shape stops
being what the runtime expects.
