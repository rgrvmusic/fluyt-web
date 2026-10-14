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
 * The sample rate is a CHECK, NOT A SETUP.
 *
 * fluyt_init()'s argument is recorded and never read on this path: Felucca's tables (SINE, PITCH,
 * TIME_MS_X10, ENV_LIN, the cutoff and LFO curves, the soft clip) are generated for 48 kHz by
 * build-wasm.sh, and everything the bridge derives - pitch, envelope times, LFO rates - is read out
 * of them. Handing the engine 44.1 kHz would not resample anything; it would leave every one of
 * those tables 8.8% out, which is exactly the error regenerating them for the drumlogue exists to
 * avoid. So process_f32() does NOT re-derive anything when it is handed a different rate the way
 * RG909's binding does - there is nothing to re-derive, and a reset would cost the loaded preset
 * for no gain. The page is what has to be right, and is: it opens its AudioContext at 48000 and
 * says so in the footer when the browser will not.
 */

#include <emscripten.h>
#include <stdlib.h>

#include "fluyt_engine.c"

/* The bridge is a singleton - its engine, its voices, its panel and its event queue are all file
 * statics, which is what one translation unit buys - so an instance is a handle and nothing more.
 * A page that wants four parts on four engines gets four WebAssembly instances, each of which was
 * instantiated from this module separately and therefore has statics of its own. */
typedef struct {
    float sample_rate;
} fluyt_web_t;

static fluyt_web_t fluyt_web;

/* ---------------------------------------------------------------------------------------------
 * Lifecycle
 * ------------------------------------------------------------------------------------------- */

EMSCRIPTEN_KEEPALIVE
fluyt_web_t *regroove_synth_create(int engine_id, float sample_rate)
{
    (void)engine_id;   /* one engine per module; there is nothing to switch on */

    if (!(sample_rate > 0.0f))
        sample_rate = 48000.0f;

    /* fluyt_init() zeroes the track and the song, puts the mix at unity, restores the panel to the
     * sound's own values and clears the event queue, so calling it twice in a row is safe and
     * leaves the engine in the same place. */
    if (!fluyt_init(sample_rate))
        return NULL;

    fluyt_web.sample_rate = sample_rate;
    return &fluyt_web;
}

/* Nothing to free: the engine is the statics in the bridge's one translation unit, and the module
 * instance's memory goes away with the instance. What a caller needs from a destroy is silence,
 * which is what this leaves behind, so that a node being torn down cannot be left mid-note. */
EMSCRIPTEN_KEEPALIVE
void regroove_synth_destroy(fluyt_web_t *h)
{
    if (!h)
        return;
    fluyt_all_note_off();
}

EMSCRIPTEN_KEEPALIVE
void regroove_synth_reset(fluyt_web_t *h)
{
    if (!h)
        return;
    fluyt_reset();
}

/* The rate this instance was created with, which is the rate the tables were generated for. The
 * additions are fluyt_web_* because the bridge's own names (fluyt_engine_name, fluyt_preset_index)
 * are already taken by the functions being wrapped. */
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
 * fluyt_note_on(). Nothing is reinterpreted here - a General MIDI number means a drum on the DRUM
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
    fluyt_note_on((uint8_t)midi_note, (uint8_t)velocity);
}

EMSCRIPTEN_KEEPALIVE
void regroove_synth_note_off(fluyt_web_t *h, int midi_note)
{
    if (!h || midi_note < 0 || midi_note > 127)
        return;
    fluyt_note_off((uint8_t)midi_note);
}

EMSCRIPTEN_KEEPALIVE
void regroove_synth_all_notes_off(fluyt_web_t *h)
{
    if (!h)
        return;
    fluyt_all_note_off();
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

    /* sample_rate is deliberately unread - see the note at the top of this file. The bridge's own
     * render takes any frame count: it renders in Felucca's 32-sample control blocks and carries a
     * remainder into the next call, which is what lets the worklet split a quantum at a note
     * boundary and still land the onset on the exact sample. */
    (void)sample_rate;

    fluyt_render(NULL, buf, (uint32_t)frames);
}

/* ---------------------------------------------------------------------------------------------
 * The panel
 *
 * No page here sets a row yet - a parameter panel is a later enhancement - but the entry points
 * are the ABI's, so they are implemented rather than stubbed. A row's value on this side of the
 * bridge is an offset into Felucca's own range (see fluyt_set_param in shim/fluyt_engine.h), and
 * the float form rfx uses is 0..1 across that span; the two are converted here.
 * ------------------------------------------------------------------------------------------- */

EMSCRIPTEN_KEEPALIVE
int regroove_synth_get_num_params(fluyt_web_t *h)
{
    (void)h;
    return (int)fluyt_num_params();
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
    return (int)fluyt_get_param((uint8_t)index);
}

/* How wide the row is, which is the range a caller's 0..1 will be stretched across. */
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
    fluyt_set_param((uint8_t)index, value);   /* already an offset into the row's range */
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
    fluyt_set_param((uint8_t)index, (int32_t)(value * (float)span + 0.5f));
}

/* Felucca's own word for a row's value - its units and its rounding - so a panel built on this
 * module cannot say something the FM-1 would not. */
EMSCRIPTEN_KEEPALIVE
const char *regroove_synth_get_param_str(fluyt_web_t *h, int index, int value)
{
    if (!h || index < 0 || index >= (int)fluyt_num_params())
        return "";
    return fluyt_param_str((uint8_t)index, value);
}

/* ---------------------------------------------------------------------------------------------
 * Presets
 *
 * The names are Felucca's own, from the engine's own table, so the page cannot offer a sound the
 * firmware does not have.
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
    return fluyt_preset_name((uint8_t)index);
}

/* rfx's worklet passes a voice alongside the index; Fluyt's preset is the whole track's sound and
 * has no per-voice form, so the third argument has nothing to select. */
EMSCRIPTEN_KEEPALIVE
void regroove_synth_load_preset(fluyt_web_t *h, int index, int voice)
{
    (void)voice;
    if (!h || index < 0 || index >= (int)fluyt_num_presets())
        return;
    fluyt_load_preset((uint8_t)index);
}

EMSCRIPTEN_KEEPALIVE
int fluyt_web_preset_index(fluyt_web_t *h)
{
    (void)h;
    return (int)fluyt_preset_index();
}

/* Felucca's own name of the engine - "ANALOG", "FM6", "VOICE" - which is the name the page shows
 * and the name the FM-1's own screen shows. */
EMSCRIPTEN_KEEPALIVE
const char *fluyt_web_engine_name(fluyt_web_t *h)
{
    (void)h;
    return fluyt_engine_name();
}
