#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// Render the whole tune, through every engine, offline in Node. Run with `make check`, or
// `node tools/tunecheck.mjs`.
//
// This is the check that catches the things a browser would only tell you by not playing: a step
// count that does not match the tune's own claim, a note name the parser reads as a rest, a preset
// the role lookup cannot find, an engine that clips when four parts are summed. It renders each
// engine in the position each part actually takes - the bass line on the bass part, the drum kit on
// the drum part - so what it measures is the tune and not a synthetic note.
//
// Every tune in TUNES is run through, each against its own file, tempo and grid, and each with its
// own trim bound: two tunes are two things the page plays, never at once, so neither can be the
// other's worst case. The engines are loaded once and the tunes go through what is already there.
//
// It imports src/js/pattern.js, src/js/smf.js and src/js/tune.js, which are the files the page itself
// loads, and it renders the MIDI files the page plays rather than the notation - so what is rendered
// is each tune as the page has it, tempo and grid included, and a mistake in a file fails here rather
// than in a browser.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

import { parsePart, stepCount, noteToMidi, midiToNote } from '../src/js/pattern.js';
import { TUNES } from '../src/js/tunes/index.js';
import { LAYOUT, presetForRole } from '../src/js/parts.js';
import { compileMidi } from '../src/js/tune.js';
import { MASTER_GAIN } from '../src/js/mix.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WASM_DIR = path.join(ROOT, 'dist', 'wasm');
const SAMPLE_RATE = 48000;

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const YELLOW = '\u001b[1;33m';
const NC = '\u001b[0m';

const nodeRequire = createRequire(import.meta.url);

const failures = [];
const fail = (what) => {
    failures.push(what);
    console.log(`  ${RED}✗${NC} ${what}`);
};

// The same loader the worklet carries inline, and that tools/smoke.mjs also uses - see the note at
// the top of that file for why it exists in three places rather than one.
async function loadModule(jsCode, wasmBytes, filename) {
    const fakeExports = {};
    const fakeModule = { exports: fakeExports };

    const modifiedCode = jsCode
        .replace(';return moduleRtn', ';globalThis.__wasmMemory=wasmMemory;return moduleRtn')
        .replace(';return Module', ';globalThis.__wasmMemory=wasmMemory;return Module');

    (function (module, exports, require, __filename, __dirname) {
        eval(modifiedCode);   // eslint-disable-line no-eval
    })(fakeModule, fakeExports, nodeRequire, filename, path.dirname(filename));

    const factory = fakeModule.exports || fakeExports.default;
    const mod = await factory({
        wasmBinary: wasmBytes,
        instantiateWasm(imports, successCallback) {
            WebAssembly.instantiate(wasmBytes, imports).then((r) => successCallback(r.instance));
            return {};
        },
    });
    delete globalThis.__wasmMemory;
    return mod;
}

/** One part on one engine, rendered for the length of the tune, at the tune's own tempo. */
async function renderPart(mod, handle, part, stepFrames, loopFrames) {
    const bufPtr = mod._malloc(128 * 2 * 4);
    const out = new Float32Array(loopFrames * 2);

    // offs before ons at the same step, which is the order the worklet applies them in: a note
    // repeated on the step it is released has to be released first or it is never retriggered
    const events = [];
    for (let step = 0; step < part.on.length; step++) {
        if (part.off[step]?.length) events.push([step, 0, part.off[step]]);
        if (part.on[step]?.length) events.push([step, 1, part.on[step]]);
    }
    events.sort((a, b) => a[0] - b[0]);   // stable, so the off-before-on order above survives
    let next = 0;

    for (let frame = 0; frame < loopFrames; frame += 128) {
        // fire everything due inside this block, at the block's head: this is a measurement, and a
        // sample of placement is not what it is measuring - the worklet is what does that
        while (next < events.length && events[next][0] * stepFrames < frame + 128) {
            const [, kind, notes] = events[next];
            for (const n of notes) {
                if (kind) mod._regroove_synth_note_on(handle, n, 100);
                else mod._regroove_synth_note_off(handle, n);
            }
            next++;
        }

        const n = Math.min(128, loopFrames - frame);
        mod._regroove_synth_process_f32(handle, bufPtr, n, SAMPLE_RATE);

        const heap = mod.HEAPF32;
        const base = bufPtr >> 2;
        for (let i = 0; i < n * 2; i++) out[frame * 2 + i] = heap[base + i];
    }

    mod._free(bufPtr);
    return out;
}

function measure(buffer) {
    let peak = 0;
    let sum = 0;
    let bad = 0;
    for (let i = 0; i < buffer.length; i++) {
        const s = buffer[i];
        if (!Number.isFinite(s)) bad++;
        const a = Math.abs(s);
        if (a > peak) peak = a;
        sum += s * s;
    }
    return { peak, rms: Math.sqrt(sum / buffer.length), bad };
}

function writeWav(channels, sampleRate) {
    const frames = channels[0].length;
    const buffer = Buffer.alloc(44 + frames * channels.length * 2);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + frames * channels.length * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);                                     // PCM
    buffer.writeUInt16LE(channels.length, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channels.length * 2, 28);
    buffer.writeUInt16LE(channels.length * 2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(frames * channels.length * 2, 40);

    let offset = 44;
    for (let i = 0; i < frames; i++) {
        for (const channel of channels) {
            const s = Math.max(-1, Math.min(1, channel[i]));
            buffer.writeInt16LE(Math.round(s * 32767), offset);
            offset += 2;
        }
    }
    return buffer;
}

/**
 * The notation, before anything is loaded. These are the checks a browser cannot make: a note name
 * that parses to nothing is a rest, and a rest is silent in a way that reads as a quiet part rather
 * than as a mistake.
 */
function checkNotation(notation) {
    for (const part of LAYOUT) {
        const text = notation.TEXT[part.id];
        const steps = stepCount(text);
        const expected = notation.BARS * notation.STEPS_PER_BAR;
        if (steps !== expected) {
            fail(`${notation.ID}/${part.id}: ${steps} steps, and the tune claims ` +
                 `${notation.BARS} x ${notation.STEPS_PER_BAR} = ${expected}`);
            continue;
        }
        try {
            parsePart(text, part.id);
        } catch (err) {
            fail(String(err.message));
            continue;
        }
        const notes = text.split(/\s+/).filter((t) => t !== '.' && t !== '-');
        const distinct = new Set(notes.flatMap((t) => t.split('+')));
        console.log(`  ${GREEN}✓${NC} ${part.id.padEnd(6)} ${steps} steps, ` +
                    `${notes.length} onsets, ${distinct.size} distinct notes (${[...distinct].sort().join(' ')})`);
    }
}

/**
 * One tune, end to end: the file the page reads, every engine on every part it could be put on, and
 * the mix the page opens with.
 *
 * Every engine on every part, and not only the four the tune names, because that is what the page
 * lets a visitor do - and it is what makes the master trim a bound for every combination rather than
 * a number that happens to fit the tune as it opens.
 */
async function checkTune(notation, engines, loaded) {
    console.log('');
    console.log('='.repeat(40));
    console.log(`${notation.LABEL}: the file, every engine, and the mix`);
    console.log('='.repeat(40));

    // ---- the engines it names have to exist. Nothing falls back any more - a slug that is not one
    // of these is a part with no engine, which is silence rather than a wrong sound, and silence is
    // the kind of thing a page does not explain.
    let slugsOk = true;
    for (const part of LAYOUT) {
        const slug = notation.ENGINES[part.id];
        if (!engines.some((engine) => engine.slug === slug)) {
            fail(`${notation.ID}: ${part.id} is set to ${slug}, which is not one of the ` +
                 `${engines.length} engines in dist/wasm/engines.json`);
            slugsOk = false;
        }
    }
    if (slugsOk) {
        console.log(`  ${GREEN}✓${NC} engines   ${LAYOUT.map((p) => notation.ENGINES[p.id]).join(', ')}`);
    }

    // ---- the tune as the page has it: the file in src/tune/, read by src/js/smf.js - the same file
    // and the same reader the browser uses, so the tempo and the grid rendered here are the ones the
    // page plays at rather than the notation's claim about them
    const target = fileURLToPath(notation.SONG_URL);
    let song;
    try {
        song = compileMidi(new Uint8Array(await readFile(target)));
    } catch (err) {
        fail(`src/${path.relative(path.join(ROOT, 'src'), target)}: ${err.message}`);
        return;
    }
    const compiled = song.parts;

    const stepFrames = (SAMPLE_RATE * 60) / (song.bpm * (song.stepsPerBar / 4));
    const loopFrames = Math.round(compiled[0].steps * stepFrames);

    console.log('');
    console.log(`${song.bars} bars of ${song.grid} at ${song.bpm.toFixed(2)} BPM, ` +
                `${(loopFrames / SAMPLE_RATE).toFixed(1)} s, ` +
                `${compiled[0].steps} steps of ${stepFrames.toFixed(1)} frames`);
    console.log('');

    const mixed = {};
    // the loudest this part reaches over every engine, which is what the master trim is sized against
    const loudest = new Map();

    for (const engine of engines) {
        const { mod, handle, names } = loaded.get(engine.slug);

        console.log(`${YELLOW}${engine.name}${NC}`);

        for (const part of compiled) {
            const preset = presetForRole(part.role, names);
            mod._regroove_synth_load_preset(handle, preset, 0);
            mod._regroove_synth_reset(handle);

            const audio = await renderPart(mod, handle, part, stepFrames, loopFrames);
            const m = measure(audio);

            const isDefault = notation.ENGINES[part.id] === engine.slug;
            const mark = isDefault ? '*' : ' ';

            if (m.bad) fail(`${notation.ID}/${engine.name} on ${part.id}: ${m.bad} non-finite samples`);
            if (m.peak === 0) {
                fail(`${notation.ID}/${engine.name} on ${part.id} (${names[preset]}): rendered silence`);
            }

            console.log(`  ${mark} ${part.id.padEnd(6)} ${names[preset].padEnd(11)} ` +
                        `peak ${m.peak.toFixed(3)}  rms ${m.rms.toFixed(4)}`);

            if (m.peak > (loudest.get(part.id) ?? 0)) loudest.set(part.id, m.peak);
            if (isDefault) mixed[part.id] = audio;
        }
    }

    // ---- the trim, and the mix.
    //
    // Four parts summed measure a peak well over full scale - each engine arrives at roughly full
    // scale on its own and the page adds four of them - so the page plays them through a master
    // gain of MASTER_GAIN (src/js/mix.js) rather than straight into the destination.
    //
    // The check here is not "the tune the page opens with happens to fit". A visitor can put any of
    // the nine engines on any of the four parts, so the number to prove is the worst case reachable
    // by any combination: the sum over the parts of the loudest peak each part reaches. Parts do
    // not all peak on the same sample, so that sum is an upper bound rather than a prediction -
    // which is exactly what makes it a bound for every combination and not just the loud ones. It is
    // a bound per tune, not across them: two tunes are two things the page plays, never at once.
    console.log('');
    console.log('The mix:');

    const bound = compiled.reduce((sum, part) => sum + (loudest.get(part.id) ?? 0), 0);
    const trimmed = bound * MASTER_GAIN;

    if (trimmed > 1.0) {
        fail(`${notation.ID}: the master gain of ${MASTER_GAIN} is too high: the worst case is ` +
             `${compiled.map((p) => (loudest.get(p.id) ?? 0).toFixed(3)).join(' + ')} = ` +
             `${bound.toFixed(3)}, so ${trimmed.toFixed(3)} of full scale. Lower MASTER_GAIN in ` +
             'src/js/mix.js, or move a preset that got louder.');
    } else {
        console.log(`  ${GREEN}✓${NC} trim ${MASTER_GAIN}  worst case ` +
                    `${compiled.map((p) => (loudest.get(p.id) ?? 0).toFixed(3)).join(' + ')} = ` +
                    `${bound.toFixed(3)}`);
        console.log(`    ${trimmed.toFixed(3)} of full scale with every engine on every part - ` +
                    `${((1 - trimmed) * 100).toFixed(0)}% margin`);
    }

    const left = new Float32Array(loopFrames);
    const right = new Float32Array(loopFrames);
    for (const part of compiled) {
        const audio = mixed[part.id];
        if (!audio) {
            fail(`${notation.ID}: no engine for ${part.id} - it is set to ` +
                 `${notation.ENGINES[part.id]}, and nothing was rendered for it`);
            continue;
        }
        for (let i = 0; i < loopFrames; i++) {
            left[i] += audio[i * 2];
            right[i] += audio[i * 2 + 1];
        }
    }

    for (let i = 0; i < loopFrames; i++) {
        left[i] *= MASTER_GAIN;
        right[i] *= MASTER_GAIN;
    }

    const mix = measure(interleave(left, right));
    if (mix.bad) fail(`${notation.ID}: the mix has ${mix.bad} non-finite samples`);
    console.log(`  ${GREEN}✓${NC} the tune as the page opens it: peak ${mix.peak.toFixed(3)}  ` +
                `rms ${mix.rms.toFixed(4)}  (${(20 * Math.log10(mix.peak)).toFixed(1)} dBFS peak)`);

    try {
        await mkdir(wavDir, { recursive: true });
        const wav = path.join(wavDir, `fluyt-${notation.ID}.wav`);
        await writeFile(wav, writeWav([left, right], SAMPLE_RATE));
        console.log(`  ${GREEN}✓${NC} wrote ${path.relative(ROOT, wav)} - ` +
                    'the tune as the page opens it, trimmed as the page trims it, to listen to');
    } catch (err) {
        // not a failure: writing a file is a convenience, not a check
        console.log(`  ${YELLOW}!${NC} could not write the wav: ${err.message}`);
    }
}

const wavDir = path.join(ROOT, 'build', 'tunecheck');

async function main() {
    console.log('========================================');
    console.log('Fluyt tunes - the whole thing, on every engine');
    console.log('========================================');

    for (const notation of TUNES) {
        console.log('');
        console.log(`${notation.LABEL} - the notation:`);
        checkNotation(notation);
    }

    // A note name that does not parse is the failure this notation is most likely to have, and
    // parsePart throws on it - but only for the parts above. This is the same check for the names in
    // the round, so that a name is known to round-trip.
    try {
        for (const name of ['C4', 'A1', 'F#3', 'Bb2', 'G9']) {
            const midi = noteToMidi(name);
            if (midi === null) throw new Error(`${name} does not parse`);
            if (midiToNote(midi) !== name.replace('Bb', 'A#')) {
                throw new Error(`${name} parsed to ${midi}, which reads back as ${midiToNote(midi)}`);
            }
        }
        if (noteToMidi('C4') !== 60) throw new Error('C4 is not 60 - the DRUM engine\'s note numbers would move');
        // a bare number is how the drum part is written, so it is a MIDI note and must round-trip
        // as one: 36 is the kick in General MIDI, and the DRUM engine maps 35..81 onto its kit
        if (noteToMidi('36') !== 36) throw new Error('36 is not MIDI 36 - the drum part would move');
        if (noteToMidi('128') !== null || noteToMidi('999') !== null) throw new Error('a number over 127 parsed');
        console.log(`  ${GREEN}✓${NC} names      C4 is 60, accidentals round-trip, and 36 is MIDI 36 (the kick)`);
    } catch (err) {
        fail(`note names: ${err.message}`);
    }

    // ---- every engine, loaded once, and then put on every part of every tune. The modules are the
    // expensive part of this check and a module does not care which tune is playing through it, so
    // they are loaded here and the tunes run through what is already in memory.
    const engines = JSON.parse(await readFile(path.join(WASM_DIR, 'engines.json'), 'utf8'));
    const loaded = new Map();

    for (const engine of engines) {
        const jsPath = path.join(WASM_DIR, engine.module);
        const mod = await loadModule(
            await readFile(jsPath, 'utf8'),
            await readFile(path.join(WASM_DIR, engine.module.replace(/\.js$/, '.wasm'))),
            jsPath,
        );

        const handle = mod._regroove_synth_create(0, SAMPLE_RATE);
        const count = mod._regroove_synth_get_preset_count();
        const names = [];
        for (let i = 0; i < count; i++) names.push(mod.UTF8ToString(mod._regroove_synth_get_preset_name(i)));

        loaded.set(engine.slug, { mod, handle, names });
    }

    for (const notation of TUNES) await checkTune(notation, engines, loaded);

    for (const { mod, handle } of loaded.values()) mod._regroove_synth_destroy(handle);

    report();
}

function interleave(left, right) {
    const out = new Float32Array(left.length * 2);
    for (let i = 0; i < left.length; i++) {
        out[i * 2] = left[i];
        out[i * 2 + 1] = right[i];
    }
    return out;
}

function report() {
    console.log('');
    if (failures.length) {
        console.log(`${RED}${failures.length} failure${failures.length === 1 ? '' : 's'}${NC}`);
        for (const f of failures) console.log(`  ${f}`);
        process.exit(1);
    }
    console.log(`${GREEN}the tune renders on every engine, and the mix has headroom${NC}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(`${RED}tunecheck: ${err && err.stack ? err.stack : err}${NC}`);
    process.exit(1);
});
