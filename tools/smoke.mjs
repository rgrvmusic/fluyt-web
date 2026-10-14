#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// Load every built module the way the AudioWorklet has to, and hold it to the ABI that makes it
// play. Run with `make check`, or `node tools/smoke.mjs`.
//
// This is not a formality. The worklet in rfx/web/replugged/worklets/synth-worklet-processor.js
// binds a module by name - there is no header, no symbol table, nothing that would catch a rename -
// and the failure mode of a name that is one word off is not an error message, it is a synth that
// loads, reports itself ready, and never sounds a note. So the eight names it binds are asserted
// here against the built module, and then a note is played through them and the audio is measured.
//
// The loader below is deliberately the same code path as src/worklet/fluyt-worklet.js, down to the
// string the factory's tail is rewritten on. It cannot be shared with it: an AudioWorklet global
// scope has no import(), so the worklet has to carry its loader inline. What the two have in common
// is the reason this file exists - Emscripten's current getBinarySync ignores wasmBinary and tries
// to fetch() the .wasm, which cannot work in a worklet, so the bytes have to arrive through
// instantiateWasm and the memory reference has to be lifted out of the factory by hand.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

// The glue names itself through __filename and, because ENVIRONMENT includes node, reaches for
// `require("node:fs")` once at startup - for the loader emscripten would use to find its own .wasm,
// which `instantiateWasm` below means is never called. Neither name exists inside a bare function
// scope, so the harness supplies the two a CommonJS host would. The worklet has no such branch to
// take: ENVIRONMENT_IS_NODE is false there, so this is a property of running in Node and not of
// the module.
const nodeRequire = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WASM_DIR = path.join(ROOT, 'dist', 'wasm');

const SAMPLE_RATE = 48000;   // the rate the tables were generated for; see tools/gen-tables.sh
const RENDER_FRAMES = 48000; // one second in, one second measured

// The names, and nothing but the names. This object is a copy of mapWasmFunctions() in the synth
// worklet, which is the only reason any of them matter: if the worklet is ever changed to bind
// something else, this is what should be changed with it.
const BOUND = {
    create: '_regroove_synth_create',
    destroy: '_regroove_synth_destroy',
    reset: '_regroove_synth_reset',
    note_on: '_regroove_synth_note_on',
    note_off: '_regroove_synth_note_off',
    all_notes_off: '_regroove_synth_all_notes_off',
    process: '_regroove_synth_process_f32',
    set_parameter_value: '_regroove_synth_set_parameter',
};

// The names the worklet reaches for on demand rather than at load. A module that is missing one of
// these still plays, but a panel built on it is missing a control or a preset list, so they are
// checked too - and the two preset counts are checked against each other, because the worklet asks
// for one and falls through to the other.
const OPTIONAL = [
    '_regroove_synth_set_parameter_int',
    '_regroove_synth_get_parameter',
    '_regroove_synth_get_parameter_max_value',
    '_regroove_synth_get_num_params',
    '_regroove_synth_get_param_str',
    '_regroove_synth_get_preset_name',
    '_regroove_synth_load_preset',
    '_fluyt_web_engine_name',
];

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const YELLOW = '\u001b[1;33m';
const NC = '\u001b[0m';

const failures = [];
const fail = (engine, what) => {
    failures.push(`${engine}: ${what}`);
    console.log(`  ${RED}✗${NC} ${what}`);
};

/**
 * Instantiate one module from its glue text and its bytes, the way the worklet does.
 *
 * Two things here are the whole trick. The glue's tail is rewritten to lift `wasmMemory` onto
 * globalThis before the factory returns - the worklet reads `new Uint8Array(this.wasmMemory.buffer)`
 * to get a preset name out, and `wasmMemory` is a local inside the factory, unreachable from
 * outside it. Both tails are matched (`;return moduleRtn` and `;return Module`) because emcc
 * renamed the factory's tail between releases and neither string occurs in the other's output; the
 * local holding the memory is `wasmMemory` in both, so only the word after `return` differs.
 *
 * And the factory is handed `instantiateWasm`, which is checked before any of the file-loading
 * path in both versions. Supplying it is what skips getBinarySync - which, in a worklet, does not
 * merely fail but cannot even be attempted.
 */
async function loadModule(jsCode, wasmBytes, filename) {
    const fakeExports = {};
    const fakeModule = { exports: fakeExports };

    const modifiedCode = jsCode
        .replace(';return moduleRtn', ';globalThis.__wasmMemory=wasmMemory;return moduleRtn')
        .replace(';return Module', ';globalThis.__wasmMemory=wasmMemory;return Module');

    (function (module, exports, require, __filename, __dirname) {
        // eslint-disable-next-line no-eval
        eval(modifiedCode);
    })(fakeModule, fakeExports, nodeRequire, filename, path.dirname(filename));

    const ModuleFactory = fakeModule.exports || fakeExports.default;
    if (typeof ModuleFactory !== 'function') {
        throw new Error('failed to capture the module factory from the glue');
    }

    const mod = await ModuleFactory({
        wasmBinary: wasmBytes,
        instantiateWasm(imports, successCallback) {
            WebAssembly.instantiate(wasmBytes, imports).then((result) => {
                successCallback(result.instance);
            });
            return {};
        },
    });

    const memory = globalThis.__wasmMemory;
    delete globalThis.__wasmMemory;
    if (!memory) {
        throw new Error('the factory returned without exposing wasmMemory');
    }

    return { mod, memory };
}

/** Peak and RMS of interleaved stereo float32, and whether every sample is a real number. */
function measure(heapF32, ptr, frames) {
    let peak = 0;
    let sum = 0;
    let bad = 0;
    const view = heapF32.subarray(ptr >> 2, (ptr >> 2) + frames * 2);
    for (let i = 0; i < view.length; i++) {
        const s = view[i];
        if (!Number.isFinite(s)) bad++;
        const a = Math.abs(s);
        if (a > peak) peak = a;
        sum += s * s;
    }
    return { peak, rms: Math.sqrt(sum / view.length), bad };
}

async function checkEngine(engine) {
    const label = engine.name.padEnd(14);
    process.stdout.write(`  ${label}`);

    const jsPath = path.join(WASM_DIR, engine.module);
    const jsCode = await readFile(jsPath, 'utf8');
    const wasmBytes = await readFile(path.join(WASM_DIR, engine.module.replace(/\.js$/, '.wasm')));

    const { mod, memory } = await loadModule(jsCode, wasmBytes, jsPath);

    // ---- the names that make it play, before anything is asked of them
    const missing = Object.entries(BOUND).filter(([, name]) => typeof mod[name] !== 'function');
    if (missing.length) {
        console.log();
        for (const [key, name] of missing) fail(engine.name, `missing ${name} (bound as ${key})`);
        return;
    }

    for (const name of OPTIONAL) {
        if (typeof mod[name] !== 'function') fail(engine.name, `missing ${name}`);
    }

    const create = mod[BOUND.create];
    const noteOn = mod[BOUND.note_on];
    const noteOff = mod[BOUND.note_off];
    const allNotesOff = mod[BOUND.all_notes_off];
    const reset = mod[BOUND.reset];
    const render = mod[BOUND.process];
    const setParameter = mod[BOUND.set_parameter_value];
    const destroy = mod[BOUND.destroy];

    // ---- create
    const handle = create(0, SAMPLE_RATE);
    if (!handle) {
        console.log();
        fail(engine.name, `create(0, ${SAMPLE_RATE}) returned 0`);
        return;
    }

    // Felucca's own name for the engine, read through the memory the loader lifted out. This is the
    // path the worklet's getPresetName() takes, so a failure here is a failure there.
    const readCString = (ptr) => {
        if (!ptr) return '';
        const bytes = new Uint8Array(memory.buffer);
        let end = ptr;
        while (bytes[end] !== 0 && end - ptr < 256) end++;
        return new TextDecoder().decode(bytes.subarray(ptr, end));
    };

    const engineName = readCString(mod._fluyt_web_engine_name(handle));
    if (!engineName) fail(engine.name, 'the module reports no engine name');

    // ---- presets, through both names the worklet will try
    const count = mod._regroove_synth_get_preset_count();
    const bankCount = mod._regroove_synth_bank_get_num_presets();
    if (count <= 0) fail(engine.name, `get_preset_count() = ${count}`);
    if (bankCount !== count) fail(engine.name, `bank_get_num_presets() = ${bankCount}, get_preset_count() = ${count}`);

    const presets = [];
    for (let i = 0; i < count; i++) {
        const name = readCString(mod._regroove_synth_get_preset_name(i));
        if (!name) fail(engine.name, `preset ${i} has no name`);
        presets.push(name);
    }

    // ---- the panel's rows, which is what the audio comes out of
    const numParams = mod._regroove_synth_get_num_params(handle);
    if (numParams <= 0) fail(engine.name, `get_num_params() = ${numParams}`);
    const spans = [];
    for (let i = 0; i < numParams; i++) {
        const span = mod._regroove_synth_get_parameter_max_value(i);
        if (span <= 0) fail(engine.name, `row ${i} has no span`);
        spans.push(span);
        // and the read-back rfx's loadPreset() makes
        const value = mod._regroove_synth_get_parameter(handle, i);
        if (!Number.isFinite(value)) fail(engine.name, `get_parameter(${i}) is not a number`);
    }

    // ---- every preset, rendered. A preset that renders silence is a preset the page would offer
    // and a visitor would hear nothing from, so each one has to make sound.
    const bufPtr = mod._malloc(128 * 2 * 4);

    for (let i = 0; i < count; i++) {
        mod._regroove_synth_load_preset(handle, i, 0);
        reset(handle);
        noteOn(handle, 60, 100);

        let peak = 0;
        let bad = 0;
        for (let rendered = 0; rendered < RENDER_FRAMES; rendered += 128) {
            render(handle, bufPtr, 128, SAMPLE_RATE);
            const m = measure(mod.HEAPF32, bufPtr, 128);
            if (m.peak > peak) peak = m.peak;
            bad += m.bad;
        }
        noteOff(handle, 60);
        allNotesOff(handle);

        if (bad) fail(engine.name, `preset ${i} (${presets[i]}) produced ${bad} non-finite samples`);
        if (peak === 0) fail(engine.name, `preset ${i} (${presets[i]}) rendered silence`);
        if (peak > 1.0) fail(engine.name, `preset ${i} (${presets[i]}) peaked at ${peak.toFixed(3)}, over full scale`);

        presets[i] = `${presets[i]} ${peak.toFixed(2)}`;
    }

    // ---- the panel ABI, exercised rather than assumed: set a row, read it back
    if (spans.length) {
        const row = Math.min(numParams - 1, 0);
        setParameter(handle, row, 0.5);
        const mid = mod._regroove_synth_get_parameter(handle, row);
        const expect = Math.round(spans[row] * 0.5);
        if (Math.abs(mid - expect) > 1) {
            fail(engine.name, `set_parameter(${row}, 0.5) read back as ${mid}, expected about ${expect}`);
        }
        // out of range has to clamp, not wrap
        setParameter(handle, row, 2.0);
        if (mod._regroove_synth_get_parameter(handle, row) > spans[row]) {
            fail(engine.name, `set_parameter(${row}, 2.0) went past the row's span`);
        }
        mod._regroove_synth_load_preset(handle, 0, 0);
    }

    mod._free(bufPtr);
    destroy(handle);

    console.log(`${GREEN}✓${NC} ${engineName.padEnd(8)} ${String(count).padStart(2)} presets  ` +
                `${presets.join(', ')}`);
}

async function main() {
    const engines = JSON.parse(await readFile(path.join(WASM_DIR, 'engines.json'), 'utf8'));

    console.log('========================================');
    console.log('Fluyt modules - load, name, and sound');
    console.log('========================================');
    console.log(`${engines.length} engines in ${path.relative(ROOT, WASM_DIR)}`);
    console.log('');
    console.log(`Each line: the module loaded, then every preset rendered one second at ${SAMPLE_RATE} Hz.`);
    console.log('The number after a preset is its peak - silence is the failure this looks for.');
    console.log('');

    if (!engines.length) {
        console.log(`${RED}engines.json is empty - run ./build-wasm.sh first${NC}`);
        process.exit(1);
    }

    for (const engine of engines) {
        try {
            await checkEngine(engine);
        } catch (err) {
            fail(engine.name, `threw: ${err && err.message ? err.message : String(err)}`);
        }
    }

    console.log('');

    if (failures.length) {
        console.log(`${RED}${failures.length} failure${failures.length === 1 ? '' : 's'}${NC}`);
        for (const f of failures) console.log(`  ${f}`);
        process.exit(1);
    }

    console.log(`${GREEN}all ${engines.length} modules load and sound${NC}`);
}

main().catch((err) => {
    console.error(`${RED}smoke: ${err && err.stack ? err.stack : err}${NC}`);
    process.exit(1);
});
