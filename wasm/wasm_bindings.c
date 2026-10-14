/* SPDX-License-Identifier: MIT */
/* Fluyt web - the browser ABI around the Fluyt bridge.
 * Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
 *
 * THE CONTENTS OF THIS FILE ARE MIT. THE MODULE IT IS COMPILED INTO IS NOT: a Fluyt module carries
 * Felucca's source, so it is GPL-3.0-only as a whole. See LICENSING.md at the root of this
 * repository, and vendor/fluyt-logue/docs/LICENSING.md for the full accounting.
 *
 * Felucca is Copyright (C) 2026 Leo Kuroshita (@kurogedelic), Hügelton Instruments (GPL-3.0-only).
 *
 * ---------------------------------------------------------------------------------------------
 *
 * One engine, one module: the bridge is compiled in exactly as a logue unit compiles it (this file
 * includes shim/fluyt_engine.c the way fluyt-logue's tools/hostsim.c does), and what this file adds
 * is the handful of entry points a browser needs and a drumlogue does not.
 *
 * The ABI is regroove_synth_*, the one rfx/web/replugged/worklets/synth-worklet-processor.js
 * already binds for the Regroove | RGRV synths. That is deliberate rather than convenient: these
 * modules are meant to be droppable into rfx/web/rfxsynths/ later without that environment
 * changing, so the entry points, their argument order and their units are the ones it already
 * calls. Where Fluyt has something rfx has no name for (the engine's own name), the export is
 * fluyt_* and is additive.
 *
 * ---------------------------------------------------------------------------------------------
 *
 * The entry points below are the DEVICE'S, not the bridge's.
 *
 * Every one of them calls unit_* - unit_init, unit_render, unit_note_on, unit_set_param_value - the
 * functions a drumlogue calls, compiled from shim/fluyt_unit.c exactly as fluyt-logue builds them
 * for the hardware (see plugins/platform.mk). What this module exercises is therefore the unit, and
 * not a second route to the same engine: a unit path that is wrong here is wrong on the device, and
 * `make check` renders the whole tune through all nine engines to say so.
 *
 * What is left on the bridge is what the unit API has no word for - how many rows an engine has, how
 * wide a row is, how many presets there are, and the engine's own name. A device reads those out of
 * the unit header; a page has to ask, and fluyt_* answers.
 *
 * ---------------------------------------------------------------------------------------------
 *
 * The sample rate is a CHECK, NOT A SETUP - and the check is now the unit's own.
 *
 * unit_init() REFUSES a descriptor whose samplerate is not 48000 (k_unit_err_samplerate, in
 * shim/fluyt_unit.c), so the 48000 below is not a preference this file holds - it is the unit's
 * condition for existing. Felucca's tables (SINE, PITCH, TIME_MS_X10, ENV_LIN, the cutoff and LFO
 * curves, the soft clip) are generated for 48 kHz by build-wasm.sh, and pitch, envelope times and
 * LFO rates are all read out of them. Handing the engine 44.1 kHz would not resample anything; it
 * would leave every one of those tables 8.8% out, which is exactly the error regenerating them for
 * the drumlogue exists to avoid.
 *
 * The descriptor is ours to fill - there is no drumlogue here to fill it - so it always says 48000
 * and that check never fires, which is the point: it is the unit that would refuse a wrong rate,
 * rather than this file quietly accepting one. A browser that will not give us 48000 is a fact about
 * the page, and the page says so (src/js/ui.js). process_f32() re-derives nothing from the rate it
 * is handed, the way RG909's binding does: there is nothing to re-derive, and a reset would cost the
 * loaded preset for no gain.
 */

#include <emscripten.h>
#include <stdlib.h>

/* The drumlogue's API - the names the entry points below call. It pulls in runtime.h, attributes.h
 * and sample_wrapper.h with it; see vendor/logue-sdk/README.md for those and why they are vendored.
 * Nothing else of the SDK is needed: a unit's C is hardware-free, which is what makes this build
 * possible at all. */
#include "unit.h"

#include "fluyt_engine.c"

/* The bridge is a singleton - its engine, its voices, its panel and its event queue are all file
 * statics, which is what one translation unit buys - so an instance is a handle and nothing more.
 * A page that wants four parts on four engines gets four WebAssembly instances, each of which was
 * instantiated from this module separately and therefore has statics of its own. */
typedef struct {
    float sample_rate;
} fluyt_web_t;

static fluyt_web_t fluyt_web;

/* What a drumlogue hands unit_init(): the platform it is, the API it was built against, the rate it
 * runs at, and the geometry and sample banks it has. Ours to fill, because there is no drumlogue
 * here - and a static rather than a local, because a unit is entitled to hold on to the pointer it
 * is given and a pointer to a returned stack frame is a bug that would only show up on the device.
 * Nothing in the bridge keeps it today (fluyt_init takes the rate and nothing else), which is a
 * reason to hand it something valid, not a reason to hand it something temporary. */
static unit_runtime_desc_t fluyt_web_desc;

/* ---------------------------------------------------------------------------------------------
 * Lifecycle
 * ------------------------------------------------------------------------------------------- */

EMSCRIPTEN_KEEPALIVE
fluyt_web_t *regroove_synth_create(int engine_id, float sample_rate)
{
    /* One engine per module, and one rate: the unit is built for 48000 and unit_init() is what
     * enforces that. A caller asking for another rate is not refused here - the module it is
     * holding is a 48 kHz engine either way - so what it is handed back is the rate the unit
     * actually runs at, which fluyt_web_sample_rate() reports. */
    (void)engine_id;
    (void)sample_rate;

    fluyt_web_desc.target      = UNIT_TARGET_PLATFORM | k_unit_module_synth;
    fluyt_web_desc.api         = UNIT_API_VERSION;
    fluyt_web_desc.samplerate  = 48000;
    fluyt_web_desc.frames_per_buffer = 128;   /* one Web Audio quantum; a unit renders any count */
    fluyt_web_desc.input_channels  = 0;       /* the engine has no audio input */
    fluyt_web_desc.output_channels = 2;

    /* No sample banks, and no function to ask for one: Felucca's engines are synthesised and read no
     * samples. The bridge never calls get_sample, and a unit that asked here would be asking for
     * something this host does not have - which is the same answer a drumlogue gives a unit whose
     * config declares banks it did not ship. */
    fluyt_web_desc.get_num_sample_banks = NULL;
    fluyt_web_desc.get_num_samples_for_bank = NULL;
    fluyt_web_desc.get_sample = NULL;

    /* unit_init() checks the four things above and calls fluyt_init() with the rate, which zeroes
     * the track and the song, puts the mix at unity, restores the panel to the sound's own values
     * and clears the event queue. Any refusal - the target, the API version, the geometry, the rate,
     * or the engine - is a NULL here, because a module that failed to init has nothing to play. */
    if (unit_init(&fluyt_web_desc) != k_unit_err_none)
        return NULL;

    fluyt_web.sample_rate = (float)fluyt_web_desc.samplerate;
    return &fluyt_web;
}

/* The unit's own teardown, which silences whatever is sounding: a node being torn down must not be
 * left mid-note. Nothing is freed on this side - the engine is the statics in the bridge's one
 * translation unit, and the module instance's memory goes away with the instance. */
EMSCRIPTEN_KEEPALIVE
void regroove_synth_destroy(fluyt_web_t *h)
{
    if (!h)
        return;
    unit_teardown();
}

EMSCRIPTEN_KEEPALIVE
void regroove_synth_reset(fluyt_web_t *h)
{
    if (!h)
        return;
    unit_reset();
}

/* The rate the unit runs at, which is the rate the tables were generated for and the only rate
 * unit_init() accepts. The additions are fluyt_web_* because the bridge's own names
 * (fluyt_engine_name, fluyt_preset_index) are already taken by the functions being wrapped. */
EMSCRIPTEN_KEEPALIVE
float fluyt_web_sample_rate(fluyt_web_t *h)
{
    return h ? h->sample_rate : 0.0f;
}

/* ---------------------------------------------------------------------------------------------
 * Notes
 *
 * The panel's rows are absolute and so are these: a drumlogue's note-on carries a note and a
 * velocity, and Felucca's voice allocator, its ADSR, its glide and its unison all live behind
 * unit_note_on(). Nothing is reinterpreted here - a General MIDI number means a drum on the DRUM
 * engine and a pitch on every other, which is the engine's own reading and not this file's.
 * ------------------------------------------------------------------------------------------- */

EMSCRIPTEN_KEEPALIVE
void regroove_synth_note_on(fluyt_web_t *h, int midi_note, int velocity)
{
    if (!h || midi_note < 0 || midi_note > 127)
        return;
    if (velocity < 0)
        velocity = 0;
    if (velocity > 127)
        velocity = 127;

    /* Velocity 0 is the engine's business, not this file's: the bridge reads it as the MIDI
     * reading of a note-on and turns it into a note-off, the same way the drumlogue's does. */
    unit_note_on((uint8_t)midi_note, (uint8_t)velocity);
}

EMSCRIPTEN_KEEPALIVE
void regroove_synth_note_off(fluyt_web_t *h, int midi_note)
{
    if (!h || midi_note < 0 || midi_note > 127)
        return;
    unit_note_off((uint8_t)midi_note);
}

EMSCRIPTEN_KEEPALIVE
void regroove_synth_all_notes_off(fluyt_web_t *h)
{
    if (!h)
        return;
    unit_all_note_off();
}

/* ---------------------------------------------------------------------------------------------
 * Audio - stereo interleaved float32, which is what the worklet allocates and what the drumlogue
 * hands its units
 * ------------------------------------------------------------------------------------------- */

EMSCRIPTEN_KEEPALIVE
void regroove_synth_process_f32(fluyt_web_t *h, float *buf, int frames, float sample_rate)
{
    if (!h || !buf || frames <= 0)
        return;

    /* sample_rate is deliberately unread - see the note at the top of this file. The unit's render
     * takes any frame count: the bridge renders in Felucca's 32-sample control blocks and carries a
     * remainder into the next call, which is what lets the worklet split a quantum at a note
     * boundary and still land the onset on the exact sample. input is NULL because a drumlogue
     * synth is handed no audio to process. */
    (void)sample_rate;

    unit_render(NULL, buf, (uint32_t)frames);
}

/* ---------------------------------------------------------------------------------------------
 * The panel
 *
 * No page here sets a row yet - a parameter panel is a later enhancement - but the entry points
 * are the ABI's, so they are implemented rather than stubbed. Writing and reading a row goes through
 * unit_set_param_value / unit_get_param_value, which is the pair a drumlogue's own panel uses.
 *
 * Counting the rows does not. The unit API has no call that answers it - a device reads the count,
 * the names and the ranges out of the unit header, which is compiled into the unit rather than asked
 * of it - so a page, which has no header to read, asks the bridge. Both read the same panel.
 *
 * A row's value is an offset into Felucca's own range (see fluyt_set_param in shim/fluyt_engine.h),
 * and the float form rfx uses is 0..1 across that span; the two are converted here.
 * ------------------------------------------------------------------------------------------- */

EMSCRIPTEN_KEEPALIVE
int regroove_synth_get_num_params(fluyt_web_t *h)
{
    (void)h;
    return (int)fluyt_num_params();   /* no unit_ counterpart: see the note above */
}

/* The row's own value in Felucca's terms, which is what a panel shows. rfx's loadPreset() reads a
 * preset back through this name - twelve times, one per row it has - so the name is the ABI's and
 * not this file's to choose. */
EMSCRIPTEN_KEEPALIVE
int regroove_synth_get_parameter(fluyt_web_t *h, int index)
{
    (void)h;
    if (index < 0 || index >= (int)fluyt_num_params())
        return 0;
    return (int)unit_get_param_value((uint8_t)index);
}

/* How wide the row is, which is the range a caller's 0..1 will be stretched across. A range is one
 * of the things the unit header carries and the unit API does not answer - see the note above. */
EMSCRIPTEN_KEEPALIVE
int regroove_synth_get_parameter_max_value(int index)
{
    if (index < 0 || index >= (int)fluyt_num_params())
        return 0;
    return (int)fluyt_row_span(fluyt_row_desc((uint32_t)index));
}

EMSCRIPTEN_KEEPALIVE
void regroove_synth_set_parameter_int(fluyt_web_t *h, int index, int value)
{
    if (!h || index < 0 || index >= (int)fluyt_num_params())
        return;
    unit_set_param_value((uint8_t)index, value);   /* already an offset into the row's range */
}

EMSCRIPTEN_KEEPALIVE
void regroove_synth_set_parameter(fluyt_web_t *h, int index, float value)
{
    int span;

    if (!h || index < 0 || index >= (int)fluyt_num_params())
        return;

    if (!(value > 0.0f))
        value = 0.0f;
    else if (value > 1.0f)
        value = 1.0f;

    span = (int)fluyt_row_span(fluyt_row_desc((uint32_t)index));
    unit_set_param_value((uint8_t)index, (int32_t)(value * (float)span + 0.5f));
}

/* Felucca's own word for a row's value - its units and its rounding - so a panel built on this
 * module cannot say something the FM-1 would not. */
EMSCRIPTEN_KEEPALIVE
const char *regroove_synth_get_param_str(fluyt_web_t *h, int index, int value)
{
    if (!h || index < 0 || index >= (int)fluyt_num_params())
        return "";
    return unit_get_param_str_value((uint8_t)index, value);
}

/* ---------------------------------------------------------------------------------------------
 * Presets
 *
 * The names are Felucca's own, from the engine's own table, so the page cannot offer a sound the
 * firmware does not have. They come from unit_get_preset_name(), which is what the device's own
 * browser calls; the count is the bridge's, for the reason the rows' count is (see the panel above).
 * ------------------------------------------------------------------------------------------- */

/* rfx's getPresetCount() asks for bank_get_num_presets FIRST and falls through to
 * get_preset_count, because the Resonate family spells it one way and RGSID the other. Fluyt
 * answers to both: a worklet that reads no count is a panel that waits for a list that never
 * arrives, and which of two names it happens to try first is not something this side controls. */
EMSCRIPTEN_KEEPALIVE
int regroove_synth_bank_get_num_presets(void)
{
    return (int)fluyt_num_presets();
}

EMSCRIPTEN_KEEPALIVE
int regroove_synth_get_preset_count(void)
{
    return (int)fluyt_num_presets();
}

EMSCRIPTEN_KEEPALIVE
const char *regroove_synth_get_preset_name(int index)
{
    if (index < 0 || index >= (int)fluyt_num_presets())
        return "";
    return unit_get_preset_name((uint8_t)index);
}

/* rfx's worklet passes a voice alongside the index; Fluyt's preset is the whole track's sound and
 * has no per-voice form, so the third argument has nothing to select. */
EMSCRIPTEN_KEEPALIVE
void regroove_synth_load_preset(fluyt_web_t *h, int index, int voice)
{
    (void)voice;
    if (!h || index < 0 || index >= (int)fluyt_num_presets())
        return;
    unit_load_preset((uint8_t)index);
}

EMSCRIPTEN_KEEPALIVE
int fluyt_web_preset_index(fluyt_web_t *h)
{
    (void)h;
    return (int)unit_get_preset_index();
}

/* Felucca's own name of the engine - "ANALOG", "FM6", "VOICE" - which is the name the page shows
 * and the name the FM-1's own screen shows. The unit API carries no such name - a device shows the
 * one in the unit header - so a page, which has no header, asks the bridge. */
EMSCRIPTEN_KEEPALIVE
const char *fluyt_web_engine_name(fluyt_web_t *h)
{
    (void)h;
    return fluyt_engine_name();
}
