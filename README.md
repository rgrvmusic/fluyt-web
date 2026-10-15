Fluyt demo for the web
======================


### Felucca's engines, played in a browser

[Fluyt](https://github.com/rgrvmusic/fluyt-logue) ships Felucca's nine sound engines as
logue units - nine for the KORG drumlogue, nine for the microKORG2. This is how they sound before
you install anything: the same engines, from the same sources, compiled to WebAssembly, playing a
short tune on a page you can open.

It is a preview, not a port and not an emulation. Each engine here is Felucca's C, at the same
48 kHz, through the same bridge the units use - what differs is the panel, which is this page
instead of a drumlogue.

- The page opens on a four-part tune - bass, lead, pad and drums, on four different engines.
- Every part's engine and preset can be changed **while it plays**, without a click.
- `Random` gives the bass, the lead and the chords three different engines, drawn at random -
  press it as often as you like, and a few presses have been over most of the nine.
- Six tunes ship with it - a sea shanty, chiptune, synthpop, house, bossa nova and a ballad - and each
  brings the engines it was written for, so choosing one is a change you can hear and not only one you
  can read.
- **Load MIDI** plays a `.mid` of your own on the engines that are already on screen.
- A second page adds a keyboard and a MIDI input, for playing an engine rather than hearing the
  tune.
- The tunes are **Standard MIDI Files**, bundled and parsed in the page, so a file written here or
  in a DAW reaches the engines the same way.


#### The two pages

| | |
| --- | --- |
| `index.html` | The tune, the picker, Load MIDI, the part selectors and the Random button. Small, self-contained, no permissions. This is the one that goes in the itch.io iframe. |
| `keyboard.html` | The same, plus an on-screen keyboard, the computer keyboard (Z-row and Q-row, `←`/`→` to shift octave) and a WebMIDI input. |

They are two pages rather than one because a cross-origin iframe - which is what the itch.io embed
is - does not reliably get WebMIDI permission, and a page offering an input selector it cannot use
is worse than one that does not offer it.


#### Building

```sh
git clone --recurse-submodules <this repository>
cd fluyt-web
source ~/Applications/emsdk/emsdk_env.sh     # emcc 6.0.9
make                                          # -> dist/
make check                                    # engines, page and tune
make serve                                    # http://localhost:8000/
```

`make serve` is not a convenience. The page is ES modules and it loads an `AudioWorklet`, and a
browser refuses both from `file://` - so opening `dist/index.html` directly gives a blank page
whatever is right with the build.


| | |
| --- | --- |
| `make` | `dist/` - the nine modules, then the page over them. This is what gets deployed. |
| `make wasm` | just `dist/wasm/`, for iterating on the C |
| `make midi` | write the notation in `src/js/tunes/` out to `src/tune/`, after editing it |
| `make check` | `smoke` + `pagecheck` + `swapcheck` + `midicheck` + `tunecheck` + `workletcheck` + `songcheck`, below |
| `make serve` | `dist/` on `:8000` |
| `make clean` | remove `dist/` and `build/` |

Nothing built is committed: `dist/` and `build/` are gitignored, and the repository is source-only -
with one deliberate exception. The `src/tune/*.mid` files are committed, because they are not build
products of the page: they are the files the page plays, the way a `.c` file is what a compiler reads.
Each is written from its notation by `make midi`, and `midicheck` fails if a tune and its file have
drifted apart.


#### The checks

| | |
| --- | --- |
| `tools/smoke.mjs` | each of the nine modules loads through the worklet's own loader, names itself, and renders every preset it claims - so a module that loads and stays silent fails here |
| `tools/pagecheck.mjs` | every module parses and its imports resolve, every file a page asks for is there - in the markup or built at runtime - and every id a script looks up is in the markup |
| `tools/swapcheck.mjs` | the engine swap, from the main thread: that a swap does not start a page that is stopped, that one made while it plays joins the tune where it is, and that neither the incoming nor the outgoing node is ever heard at a gain that would make a click |
| `tools/midicheck.mjs` | every tune: that each `src/tune/*.mid` is still what its notation says, that it reads back through `src/js/smf.js` as those notes on those steps, and that the grid, the length and the awkward files are handled the way the comments claim |
| `tools/tunecheck.mjs` | every tune, on every engine, on every part, offline: non-finite samples, silence, and the mix against full scale |
| `tools/workletcheck.mjs` | the worklet itself, run outside a browser: where every note lands, whether the frame count is right, the loop point, mid-tune joins, stop, and a pattern handed to a stopped part |
| `tools/songcheck.mjs` | changing the tune, from the main thread: that only the parts whose engine differs are rebuilt, that the notes arrive before the transport that plays them, that a swap while playing restarts the loop at the top, and that a file which is not a MIDI file costs a message and nothing else |

`midicheck` is what stands between the two halves of a tune. It builds the file from the notation
and compares the bytes, then reads the committed file back with the parser the page loads and
compares every `on`/`off` entry against the notation - so a reader that loses a note, or moves one by
a step, fails here rather than in a browser. It does that for every tune in `src/js/tunes/`, so a tune
whose notation and file disagree is the only thing that has to be added with it. The rest of it is the
reader's own decisions: one fixture per grid on the ladder, a file that is on none of them, a format 0
file (everything on one track, told apart by channel), a note held past the end of the file, a note of
no length, an off with no on, a file with no tempo, a file that changes tempo, and a file with more
parts than the page has.

`swapcheck` is the page half of the swap - `Part`, in `src/js/fluyt.js` - driven with three fake
browser objects instead of a real one, because that class needs an `AudioContext` and a worklet to run
at all and so had only ever been exercised by ear. It is where a stopped page that `Random` appeared
to start was caught: a part kept the last transport it was handed and passed it to any node it built,
so a node swapped in while the page was stopped was given an epoch already in the past, and started
playing. `Random` leaves the drums alone, which is why three parts of the four came back.

`tunecheck` is what catches a preset that is not there without needing a browser, and it writes
`build/tunecheck/<tune>.wav` - one file per tune, each as the page opens it, trimmed as the page trims
it - so they can be listened to. The engine × part matrix stays per tune, because what
it is for is the worst case reachable by *any* assignment: summing one part's loudest moment across
all nine engines is not the same number as rendering the engines a tune happens to name.

`songcheck` is `swapcheck`'s counterpart for changing the tune - `Player.setSong`, the one place that
happens, driven against four fake parts and a fake context. It is what says that a tune swapped in
while the page is playing ends playing, on one epoch, at the new tune's step length, rather than on
the old tune's phase; that the notes go over before the engines, so a new node is not handed the
outgoing tune's pattern; and that a file which is not a MIDI file is refused before anything is
stopped, so the tune that is playing keeps playing. `selectTune`'s own `fetch` cannot run under Node,
so it is `pagecheck` that holds the url it fetches - the file says so rather than implying more.

`workletcheck` stands in for an `AudioWorkletGlobalScope` and drives the real processor, which is
the only way the sample-accurate scheduling gets checked by anything but an ear. It measures the
frame each note starts on and asserts each one is at or after its step and less than a frame past
it, that every quantum renders exactly 128 frames across however many blocks a step split it into,
that the second pass begins exactly one period after the first - which is where a pattern indexed
one step too long shows up as a skipped beat - that a node joining a tune already playing lands
on the tune's own step rather than starting its own bar one, and that a pattern handed to a part with
no transport is held rather than played. The step length is 6428.571 frames, so this is where rounding
it would fail.


#### The tunes

Six of them, and each is eight bars of sixteen steps in four parts:

| Tune | Style | Key | BPM | Engines: bass, lead, pad, drums |
| --- | --- | --- | --- | --- |
| Sea shanty | shanty | A minor | 112 | ANALOG, TRIO, PHASE, DRUM |
| Chiptune | chiptune | E minor | 150 | TRIO, LOFI, TRIO, DRUM |
| Synthpop | synthpop | D minor | 124 | LOFI, PHASE, FM6, DRUM |
| House | house | A minor | 126 | WHEEL, FM6, PHASE, DRUM |
| Bossa nova | bossa nova | D minor | 96 | ANALOG, FM6, ANALOG, DRUM |
| Ballad | ballad | C major | 72 | FORMANT, FORMANT, FORMANT, DRUM |

**The page plays one `src/tune/fluyt-<id>.mid` per tune**, each a committed four-track Standard MIDI
File read by `src/js/smf.js`; the notation in `src/js/tunes/` is where each file is written from, by
`make midi`.

Choosing a tune also sets the engines it was written for, so the picker is a change you can hear and
not only one you can read: no two of the six name the same three engines for the bass, the lead and
the chords. Two of them pair one engine across two parts - the chiptune's TRIO bass under its TRIO
chords, the bossa's ANALOG bass under its ANALOG pad - and the ballad puts all three pitched parts on
FORMANT, so a single engine is heard as a bass, a lead and a choir at once. Sharing one engine costs
nothing: the module is fetched once and each part instantiates its own copy of it.

**Load MIDI** is the other half of this: a file of your own is read the same way and plays on the
engines that are already on screen, because a tune is notes and the four parts are the page's own fact
(`src/js/parts.js`). A loaded file that had to be changed to fit - notes off the grid, events with
nowhere to go, a tempo that changes part-way - says so on the line under the transport, next to its
tempo and its length, rather than quietly playing something else.

Both the notation and the file are kept because each is good at something the other is not. The
notation is a bar a line and can be read, edited and reviewed by hand:

```
bass:   "A1 . A1 . A1 . A1 . A1 . A1 . A1 . A1 ."
pad:    "A2+C3+E3 - - - - - - - - - - - - - - -"
drums:  "36+42 . 42 . 38+42 . 42 . 36+42 . 42 ."
```

A token is a note (`A1`, or a MIDI number like `36` for the drum part), several joined with `+`,
`.` for a rest, or `-` to hold. Every tune here is original. The shanty's shape is a shanty's, because
the page it plays on is a Fluyt page and a Fluyt is a ship, and it is not a quotation of any shanty;
the synthpop one is a loop - four to the floor, a bass that takes the octave on the offbeat, and a
syncopated hook over it; and the other four are the styles they are named after and nothing more.

The file is what a DAW opens, what a visitor can replace, and what the page actually parses - so the
path from music to engine is a real one, and not a private notation only this page understands.
`compileTune()` refuses to build if a part is not exactly that tune's bars of sixteen steps, or if the
parts and the notation do not name the same four things - which is the mistake the notation makes
easiest, and the one that would otherwise arrive as a part quietly a step out of phase for the whole
loop, or quietly silent.

**Adding a tune** is a module in `src/js/tunes/` and a line in its `index.js`: nothing in the page, the
player or the tools knows how many tunes there are, and every one of them walks that list rather than
naming a tune of its own. `make midi` writes the file from the notation and `midicheck` fails if the
two have drifted apart.

**A tune authored in a DAW instead** is a supported thing to do, and it needs nothing committed: the
page's Load MIDI plays it. To have it offered by the picker as well, its notation has to exist too - a
bundled tune *is* its notation and its file, and `midicheck` compares them - so a DAW file is
transcribed into `src/js/tunes/<id>.js`, and `make midi` writes the file back out from there. Four
tracks, matched to the four parts by track name (`Bass`, `Lead`, `Pad`, `Drums`, or a word like
"strings" or "kit"), then by channel 10 for the drums, then in order; format 1 or format 0, one track
per part or one track told apart by channel.

**The grid is the file's, not the page's.** A step is a fixed number of frames, so a file's ticks
have to land on steps - and a triplet figure snapped into straight sixteenths is a different rhythm,
not a rounding error. So the reader picks the step from the file: the coarsest of 12, 16, 24, 32, 48
or 96 steps to the bar that divides every onset and every release in it. Straight sixteenths come
back as sixteenths, 16th-note triplets as 24 to the bar, a file with both as 48 - and the page says
which one it chose, next to the step count and the tempo, on the line under the transport. A file
that is on none of the six is played on sixteenths anyway, with the number of notes moved and the
furthest one moved reported rather than hidden (`snapped` and `worst` in the parsed song).

A tempo is read the same way, from the file's own set-tempo event, and the transport's step length
follows from it - the notation's `BPM` is only what `make midi` writes. A file that changes tempo
part-way is played at its first tempo throughout, which is what one clock and a looping transport can
honestly do; the change is counted in `tempoChanges` rather than ignored.


#### Presets, by name

Preset indices are not comparable across engines - ANALOG's 3 is not TRIO's 3 - and they move when
an engine gains a preset. So no part names an index. Each part names a **role** (`bass`, `lead`,
`pad`, `drum`) and the preset is the first whose *name* matches it, read from the module at
runtime. An engine with nothing bass-like in it plays its first sound, which is the right thing for
a preview of that engine to do. The roles are the page's and not a tune's - they are in
`src/js/parts.js`, with the four parts themselves - so a tune says what is played and never what
plays it.


#### Sample rate

Felucca's tables are generated for a sample rate and `fluyt_init` only records the rate it is
handed - nothing resamples. So `tools/gen-tables.sh` generates them at **48 kHz** and the page
constructs its `AudioContext` at 48000 to match. At the 44.1 kHz most hardware defaults to, every
engine would play 8.8% flat and slow: audible as an engine that is out of tune with itself, and
wrong in exactly the way that would make a preview useless.

The unit itself refuses to be built for anything else: `unit_init` rejects a descriptor whose
samplerate is not 48000, which is the same condition the drumlogue units carry. The descriptor is
this side's to fill, so it always says 48000 and the check never fires - the module is a 48 kHz
engine whatever rate a caller asks for, which is why `regroove_synth_create`'s rate argument is
ignored. Where a browser cannot give 48000, the page says so in its footer rather than pretending.


#### Levels

Each engine arrives at roughly full scale on its own and the page plays four at once, so the four
parts run into a master gain of `0.35` (`src/js/mix.js`) rather than straight into the output. It
is a trim and not a limiter, deliberately: this page exists so a visitor can hear what an engine
sounds like, and a compressor on the master bus changes the attack and the punch of exactly what
they came to hear.

The number is derived, not chosen - `tunecheck` sums the loudest peak each part reaches over all
nine engines and asserts that even that worst case stays inside full scale, per tune, and the worst
tune is the one that decides it: 0.35 leaves the chiptune at 0.958 of full scale, the bossa at 0.935
and the ballad at 0.840 - so a future preset that is louder than the ones measured fails the check
rather than arriving as a clipped preview.


#### The worklet

One `AudioWorkletProcessor` per part, each one engine. Web Audio mixes the nodes, so four parts on
four engines needs no mixing code.

Sequencing is sample-accurate rather than timer-driven: the transport is an **epoch frame** - the
absolute frame at which step 0 begins - and the worklet splits each 128-frame quantum at step
boundaries, so onsets land on the exact sample and a node built halfway through a bar joins where
the bar already is, re-articulating whatever note is currently held. A `setTimeout` here would
drift against the audio clock, and it would drift differently on each of the four parts.

Loading is the one thing that needs care: Emscripten's glue cannot instantiate in a worklet by
`wasmBinary` alone, because it ignores that and tries to `fetch()` the `.wasm` - impossible inside
a worklet. So the glue is evaluated in a fake CommonJS scope with an `instantiateWasm` hook doing
the instantiation directly. `tools/smoke.mjs` and `tools/tunecheck.mjs` load the modules the same
way, deliberately: a module that loads here but not there would otherwise be found only in a
browser.


#### The browser ABI

The modules speak **`regroove_synth_*`**, the ABI Regroove's own worklet already binds
(`rfx/web/replugged/worklets/synth-worklet-processor.js`). That is the one part of this repository
that is not free to change: a synth there is bound by name, and a name that does not match is a
synth that loads, reports ready, and makes no sound - with no error anywhere. Every name
`wasm/wasm_bindings.c` exports is spelled out by hand in `plugins/platform.mk` so that a rename
fails the link instead of silently exporting something else, and `tools/smoke.mjs` asserts all of
them against the real modules.

So these modules can be dropped into `rfx/web/rfxsynths/` unchanged. Nothing here needs `rfx`, and
nothing here changes it.


#### The same entry points the drumlogue calls

Under those names, the module does not call the bridge directly - it calls the device's own entry
points: `unit_init`, `unit_render`, `unit_note_on`, `unit_set_param_value` and the rest, compiled
from `shim/fluyt_unit.c` in the submodule exactly as
[`fluyt-logue`](https://github.com/rgrvmusic/fluyt-logue) builds them for a drumlogue.
`wasm/wasm_bindings.c` fills in the `unit_runtime_desc_t` a drumlogue would fill in (drumlogue synth,
API 2.0.0, 48000, stereo, no sample banks) and hands it over; everything after that is the unit's.

That is the point of doing it this way: the path a browser takes is the path the hardware takes, so
this page says something about the units themselves rather than being a second implementation that
happens to agree with them. What is left on the bridge is what the unit API has no word for - how
many rows an engine has, how wide a row is, how many presets there are, and the engine's own name -
because a device reads those out of a unit header compiled into it, and a page has no header to
read.

`unit_init` refuses a descriptor that is not a drumlogue, not that API version, not stereo or not
48000 - see the sample rate below, which is now a condition the unit enforces rather than a
convention this page keeps.

The logue SDK's four drumlogue headers are vendored in `vendor/logue-sdk/` so that the unit's own
entry points compile here (BSD 3-Clause, KORG INC.; `vendor/logue-sdk/README.md` has the commit).
A full SDK checkout can be used instead: `make web LOGUE_SDK=/path/to/logue-sdk`. Nothing else of
the SDK is needed - no engine, no LUT, no runtime, no `_unit_base.c`.


#### Publishing

`.github/workflows/pages.yml` builds and deploys `dist/` to GitHub Pages on every push to `main`,
with the emsdk pinned to the same 6.0.9 the local build uses and `make check` run first. Point the
itch.io iframe at the Pages URL; `index.html` is the page for it.


#### Licence

The page, the worklet, the JavaScript, `wasm/wasm_bindings.c` and the build scripts are **MIT**.
The compiled modules in `dist/wasm/` are **GPL-3.0-only**, because each one contains Felucca's
GPL-3.0 source - and, for FM6, msfa's Apache-2.0. The logue SDK's four drumlogue headers are
**BSD 3-Clause** (KORG INC.), vendored unmodified and compiled into those modules.
[LICENSING.md](LICENSING.md) has the split and the source offer; the page footer carries it too,
since a page that serves GPL binaries is where a visitor would look for it.

