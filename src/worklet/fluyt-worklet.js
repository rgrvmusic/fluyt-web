// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// One AudioWorkletProcessor per part. Web Audio mixes the nodes, so four parts on four different
// engines is four nodes on one AudioContext and no mixing code of ours.
//
// This file cannot import anything - an AudioWorkletGlobalScope has no import() - so the loader it
// needs is inline. tools/smoke.mjs carries the same loader and holds it to the same eight export
// names, which is why the one piece of duplicated code in this repository is worth having twice.
//
// ---------------------------------------------------------------------------------------------
// Loading, and why it is this awkward
//
// Emscripten's glue cannot load in a worklet from `wasmBinary` alone. An older emcc's getBinarySync
// opened by returning the option if it was set; the current one dropped that line, so the module
// ignores it and tries to *fetch* its own .wasm - which cannot work here. ENVIRONMENT_IS_WORKER is
// false in an AudioWorkletGlobalScope (it is not a WorkerGlobalScope), and document and window are
// absent, so neither readAsync nor readBinary is ever defined and the fetch 404s against this
// worklet's own directory before getBinarySync throws "both async and sync fetching of the wasm
// failed".
//
// `instantiateWasm` is checked before any of that, in both versions, and is the hook emscripten
// documents for a caller who already holds the bytes - which is exactly this case, since the main
// thread fetched the pair. So the glue text is evaluated inside a fake CommonJS scope to capture
// its factory, and the factory is handed a hook that instantiates the bytes the worklet was sent.
//
// The one other thing the glue does not give up on its own is `wasmMemory`: it is a local inside the
// factory, and reading a preset name needs `new Uint8Array(memory.buffer)`. So the factory's tail is
// rewritten to copy it onto globalThis on the way out. Both tails are matched - an older emcc ends
// `;return moduleRtn`, the current one `;return Module`, neither string occurs in the other - because
// matching only one is not a load-time failure: the factory still runs and the synth still sounds,
// and it fails later, on the first preset name, as an undefined that reads like an engine bug.
// ---------------------------------------------------------------------------------------------

const SAMPLE_RATE = 48000;   // the rate the tables were built for; see tools/gen-tables.sh
const MAX_BLOCK = 128;       // one Web Audio quantum

class FluytPartProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.mod = null;
        this.memory = null;
        this.handle = 0;
        this.bufPtr = 0;

        this.ready = false;

        // transport
        this.epochFrame = 0;      // the absolute frame at which step 0 of this pass began
        this.stepFrames = 0;      // how long a step is, in frames - fractional, and not rounded
        this.totalSteps = 0;
        this.on = null;           // per step: the note numbers to start
        this.off = null;          // per step: the note numbers to stop
        this.sounding = new Set();

        this.nextStep = 0;
        this.nextStepFrame = Infinity;   // no transport until setPattern says where step 0 is

        this.port.onmessage = (event) => this.handleMessage(event.data);
        this.port.postMessage({ type: 'needWasm' });
    }

    // -------------------------------------------------------------------------------------- load

    async handleMessage(msg) {
        try {
            switch (msg.type) {
                case 'wasmBytes':
                    await this.initWasm(msg.data);
                    break;
                case 'setPattern':
                    this.setPattern(msg.data);
                    break;
                case 'setTransport':
                    this.setTransport(msg.data.epochFrame, msg.data.stepFrames);
                    break;
                case 'stop':
                    this.stopTransport();
                    break;
                case 'noteOn':
                    this.noteOn(msg.data.note, msg.data.velocity);
                    break;
                case 'noteOff':
                    this.noteOff(msg.data.note);
                    break;
                case 'allNotesOff':
                    this.allNotesOff();
                    break;
                case 'loadPreset':
                    this.loadPreset(msg.data.index);
                    break;
                case 'reset':
                    if (this.mod) this.mod._regroove_synth_reset(this.handle);
                    break;
                default:
                    break;
            }
        } catch (err) {
            this.port.postMessage({ type: 'error', data: { message: String(err && err.message || err) } });
        }
    }

    async initWasm({ jsCode, wasmBytes, sampleRate }) {
        const fakeExports = {};
        const fakeModule = { exports: fakeExports };

        const modifiedCode = jsCode
            .replace(';return moduleRtn', ';globalThis.__wasmMemory=wasmMemory;return moduleRtn')
            .replace(';return Module', ';globalThis.__wasmMemory=wasmMemory;return Module');

        (function (module, exports) {
            eval(modifiedCode);   // eslint-disable-line no-eval
        })(fakeModule, fakeExports);

        const ModuleFactory = fakeModule.exports || fakeExports.default;
        if (typeof ModuleFactory !== 'function') {
            throw new Error('could not capture the module factory from the glue');
        }

        // The signature is (imports, successCallback); the older emcc also passes the module as a
        // second callback argument and accepts a returned exports object, so returning {} and
        // resolving through the callback satisfies both.
        this.mod = await ModuleFactory({
            wasmBinary: wasmBytes,
            instantiateWasm(imports, successCallback) {
                WebAssembly.instantiate(wasmBytes, imports).then((result) => {
                    successCallback(result.instance);
                });
                return {};
            },
        });

        this.memory = globalThis.__wasmMemory;
        delete globalThis.__wasmMemory;
        if (!this.memory) throw new Error('the factory returned without exposing wasmMemory');

        const mod = this.mod;

        // The eight names the ABI has, checked rather than assumed. A missing one is not a warning
        // in this environment - it is a processor that runs, reports itself ready, and never makes
        // a sound, and the console it would log that to is not a console anyone reads.
        for (const name of REQUIRED) {
            if (typeof mod[name] !== 'function') {
                throw new Error(`${name} is missing from the module - see plugins/platform.mk`);
            }
        }

        this.handle = mod._regroove_synth_create(0, sampleRate || SAMPLE_RATE);
        if (!this.handle) throw new Error('regroove_synth_create returned 0');

        this.bufPtr = mod._malloc(MAX_BLOCK * 2 * 4);
        if (!this.bufPtr) throw new Error('_malloc returned 0 for the render buffer');

        this.ready = true;

        const count = this.presetCount();
        const presetNames = [];
        for (let i = 0; i < count; i++) presetNames.push(this.presetName(i));

        this.port.postMessage({
            type: 'ready',
            data: {
                engineName: this.readCString(mod._fluyt_web_engine_name(this.handle)),
                presetCount: count,
                presetNames,
            },
        });
    }

    /** A C string out of the module's memory, decoded by hand: TextDecoder is absent here. */
    readCString(ptr) {
        if (!ptr || !this.memory) return '';
        const bytes = new Uint8Array(this.memory.buffer);
        let length = 0;
        while (bytes[ptr + length] !== 0 && length < 256) length++;
        let out = '';
        for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[ptr + i]);
        return out;
    }

    presetCount() {
        const mod = this.mod;
        // rfx's worklet asks for the bank name first and falls through to the other; this module
        // answers both, so either order works. Kept in the same order for the same reason.
        const count = mod._regroove_synth_bank_get_num_presets
            ? mod._regroove_synth_bank_get_num_presets()
            : mod._regroove_synth_get_preset_count();
        return count || 0;
    }

    presetName(index) {
        return this.readCString(this.mod._regroove_synth_get_preset_name(index));
    }

    loadPreset(index) {
        this.mod._regroove_synth_load_preset(this.handle, index, 0);
    }

    // --------------------------------------------------------------------------------- transport

    /**
     * The part's notes and where the tune is. `on` and `off` are arrays indexed by step and carry
     * one entry past the end - the wrap step - which is where a note still held at the end of the
     * pattern is released.
     */
    setPattern({ on, off, stepFrames, epochFrame }) {
        this.on = on;
        this.off = off;
        this.totalSteps = on.length - 1;
        // A step length of zero is not a tempo, it is "not known yet" - the main thread hands the
        // pattern over before the context has told it the rate. Taking it would leave the transport
        // disarmed below and the engine silent, which is a state the page cannot get out of by
        // asking it to play: it would have to replace the engine. Ignore it and wait for the
        // transport, which carries the step length with the epoch.
        if (stepFrames) this.stepFrames = stepFrames;
        this.setTransport(epochFrame);
    }

    /**
     * Re-align to a transport position. `epochFrame` is the absolute frame at which step 0 of the
     * current pass began - the main thread computes it from the context's own currentFrame, so a
     * node that joins mid-tune lands in time with the nodes already playing rather than starting
     * its own loop.
     *
     * Whatever is sounding is re-articulated rather than left to the next step: a pad swapped in
     * during a four-bar chord would otherwise be silent for four bars, which reads as a broken
     * engine instead of a late one.
     *
     * The step length comes with it. Where the tune is and how long a step is are one fact - a frame
     * position is meaningless without both - so they are sent together rather than left for the
     * pattern message to have got right earlier.
     */
    setTransport(epochFrame, stepFrames = 0) {
        if (stepFrames) this.stepFrames = stepFrames;
        if (!this.stepFrames || !this.totalSteps) return;

        this.epochFrame = epochFrame;
        const steps = Math.floor((currentFrame - epochFrame) / this.stepFrames);

        // The step currently in progress is the one whose notes are held, so its onsets are what a
        // joining node has to replay. Steps before it in the same pass are not: they have already
        // been missed, and sounding them now would be a chord out of time.
        this.allNotesOff();
        if (steps >= 0) {
            const pass = Math.floor(steps / this.totalSteps);
            const step = steps % this.totalSteps;
            for (let i = 0; i <= step; i++) this.articulate(i);
            this.nextStep = pass * this.totalSteps + step + 1;
        } else {
            this.nextStep = 0;
        }

        this.nextStepFrame = this.stepFrameAt(this.nextStep);
    }

    stepFrameAt(step) {
        return this.epochFrame + step * this.stepFrames;
    }

    /** Start every note of a step and remember it, without closing the gates it opens. */
    articulate(step) {
        const notes = this.on[step % this.totalSteps];
        if (!notes) return;
        for (const n of notes) {
            this.mod._regroove_synth_note_on(this.handle, n, 100);
            this.sounding.add(n);
        }
    }

    /**
     * Apply one step in full: close the gates it closes, open the ones it opens.
     *
     * The step number is the transport's, so the period is `totalSteps` - not `on.length`, which is
     * one longer because of the wrap entry. Indexing by the array length is a step that is heard but
     * never counted: the pattern runs 129 steps to the transport's 128, so each pass starts a
     * sixteenth late, one more every loop, and the wrap entry - which opens nothing - lands on the
     * frame the downbeat should be on. That is the skipped beat at the loop point.
     */
    applyStep(step) {
        const index = step % this.totalSteps;

        // The wrap entry is not a step of the pattern: it is the notes a pass leaves sounding,
        // released as the next pass begins. So it goes on step 0's own frame, closed before step 0's
        // gates open - the same place stopping the transport would have closed them.
        if (index === 0 && step > 0) this.applyEntry(this.totalSteps);

        this.applyEntry(index);
    }

    /** One entry of the pattern: the gates it closes, then the notes it opens. */
    applyEntry(index) {
        const offs = this.off[index];
        const ons = this.on[index];

        if (offs) {
            for (const n of offs) {
                this.mod._regroove_synth_note_off(this.handle, n);
                this.sounding.delete(n);
            }
        }
        if (ons) {
            for (const n of ons) {
                this.mod._regroove_synth_note_on(this.handle, n, 100);
                this.sounding.add(n);
            }
        }
    }

    stopTransport() {
        this.nextStepFrame = Infinity;
        this.allNotesOff();
    }

    // ------------------------------------------------------------------------------------ audio

    allNotesOff() {
        if (this.mod) this.mod._regroove_synth_all_notes_off(this.handle);
        this.sounding.clear();
    }

    noteOn(note, velocity) {
        if (!this.ready) return;
        this.mod._regroove_synth_note_on(this.handle, note, velocity);
    }

    noteOff(note) {
        if (!this.ready) return;
        this.mod._regroove_synth_note_off(this.handle, note);
    }

    process(inputs, outputs) {
        const out = outputs[0];
        const left = out[0];
        const right = out[1] || out[0];
        const frames = left.length;

        if (!this.ready) {
            left.fill(0);
            if (right !== left) right.fill(0);
            return true;
        }

        const start = currentFrame;
        let offset = 0;

        while (offset < frames) {
            // Fire every step whose boundary has been reached. The inner loop is what makes a step
            // land on the exact sample rather than within 128 of it: the render below stops at the
            // boundary, so the next iteration begins on it.
            while (this.nextStepFrame <= start + offset) {
                this.applyStep(this.nextStep);
                this.nextStep += 1;
                this.nextStepFrame = this.stepFrameAt(this.nextStep);
            }

            // Render up to the next boundary, or to the end of the quantum, whichever is first.
            // At least one frame is always rendered, which is what keeps this loop from stalling
            // on a boundary that has already passed.
            let end = frames;
            if (this.nextStepFrame <= start + frames) {
                end = Math.max(offset + 1, Math.ceil(this.nextStepFrame - start));
            }

            const n = end - offset;
            // fluyt_render takes any frame count and carries the remainder into the next call, so
            // a short block at a step boundary is not a partial render - it is the exact length
            // asked for. See shim/fluyt_engine.h in the submodule.
            this.mod._regroove_synth_process_f32(this.handle, this.bufPtr, n, SAMPLE_RATE);

            // HEAPF32 is re-derived per call and never held across one: ALLOW_MEMORY_GROWTH can
            // detach the backing ArrayBuffer at any malloc, and a view taken before that would read
            // zeros or throw.
            const heap = this.mod.HEAPF32;
            const base = this.bufPtr >> 2;
            const dst = offset;
            for (let i = 0; i < n; i++) {
                left[dst + i] = heap[base + i * 2];
                right[dst + i] = heap[base + i * 2 + 1];
            }

            offset = end;
        }

        return true;
    }
}

// The eight names rfx's synth worklet binds, in its order. See plugins/platform.mk, which lists
// them in EXPORTED_FUNCTIONS so that emcc fails the link if one of them stops existing.
const REQUIRED = [
    '_regroove_synth_create',
    '_regroove_synth_destroy',
    '_regroove_synth_reset',
    '_regroove_synth_note_on',
    '_regroove_synth_note_off',
    '_regroove_synth_all_notes_off',
    '_regroove_synth_process_f32',
    '_regroove_synth_set_parameter',
];

registerProcessor('fluyt-part', FluytPartProcessor);
