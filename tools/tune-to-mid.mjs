#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// Write the tune out as a Standard MIDI File.
//
// The tune the page plays is src/tune/fluyt-tune.mid - the file the page reads, and the only music
// in this repository that is not source. It is written from the notation in src/js/tune.js, which is
// where the tune is authored: the notation is a bar a line and can be read and edited by hand, and
// this is what turns it into what a page - and a DAW - reads. Run it after editing the notation:
//
//   node tools/tune-to-mid.mjs            write src/tune/fluyt-tune.mid
//   node tools/tune-to-mid.mjs --check    fail if the committed file is not what the notation says
//
// `make check` runs the --check form, so the notation and the file cannot drift apart: a note added
// to the notation and not written out is a failure, rather than a page that plays the old tune.
//
// A tune authored in a DAW instead is a supported thing to do - put the file there, delete the
// notation and this script, and the page plays the file. What it must not be is a file here and a
// notation there, each claiming to be the tune.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { buildMidi } from './midifile.mjs';
import { BPM, STEPS_PER_BAR, PARTS, compileTune, TUNE_FILE } from '../src/js/tune.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src', TUNE_FILE);

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const NC = '\u001b[0m';

// 480 ticks a quarter puts a sixteenth on 120, which is what makes the page's sixteenth grid exact
// rather than a rounding: every grid in src/js/smf.js divides 480.
const DIVISION = 480;
const TICKS_PER_STEP = DIVISION / 4;

// One channel per part, with the drums on 10 as General MIDI has them - so a DAW opens this file with
// the kit on the channel its own drum editor is watching.
export const CHANNELS = [0, 1, 2, 9];

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const VELOCITY = 100;      // the velocity the worklet plays every step at, so the file sounds the same
const RELEASE = 64;        // a note-off's own velocity, which nothing reads and which is conventional

/**
 * One part's `on`/`off` arrays as MIDI events, on one channel.
 *
 * A step is a sixteenth at this division, so step `s` is tick `s * 120`. The wrap entry - the last
 * one in the arrays, holding the notes a pass leaves sounding - is therefore at `steps * 120`: the
 * tick one past the last step, which is exactly where the page releases it. Nothing here needs to
 * know about the wrap; it is the same arithmetic over one more step.
 *
 * Offs come before ons at the same tick, which is the order a step is applied in: a note repeated on
 * the step it is released has to be released first or it never retriggers.
 */
export function partEvents(part, channel) {
    const events = [];
    for (let step = 0; step < part.on.length; step++) {
        const tick = step * TICKS_PER_STEP;
        for (const note of part.off[step] || []) {
            events.push({ tick, order: 0, bytes: [NOTE_OFF | channel, note, RELEASE] });
        }
        for (const note of part.on[step] || []) {
            events.push({ tick, order: 1, bytes: [NOTE_ON | channel, note, VELOCITY] });
        }
    }
    return events;
}

/** The notation, as a four-track MIDI file: one track per part, one channel each, named for the part. */
export function buildTuneMidi(parts = PARTS) {
    const compiled = compileTune(parts);
    const tracks = compiled.map((part, index) => ({
        name: part.label,
        events: partEvents(part, CHANNELS[index % CHANNELS.length]),
    }));

    return buildMidi({ format: 1, division: DIVISION, bpm: BPM, tracks });
}

const same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

async function main() {
    const check = process.argv.includes('--check');
    const built = buildTuneMidi();

    if (!check) {
        await writeFile(TARGET, built);
        console.log(`wrote ${path.relative(ROOT, TARGET)} - ${built.length} bytes, ${PARTS.length} ` +
                    `tracks, ${BPM} BPM, one step a sixteenth`);
        return;
    }

    const committed = new Uint8Array(await readFile(TARGET));
    if (same(committed, built)) {
        console.log(`  ${GREEN}✓${NC} src/${TUNE_FILE} is what the notation says (${built.length} bytes)`);
        return;
    }

    console.log(`  ${RED}✗${NC} src/${TUNE_FILE} is not what the notation says: ` +
                `${committed.length} bytes committed, ${built.length} written from src/js/tune.js`);
    console.log('    the page plays the file, so a tune edited in the notation has to be written out:');
    console.log('        node tools/tune-to-mid.mjs');
    process.exit(1);
}

// As a script, and not when it is imported: tools/midicheck.mjs imports the two builders above to
// check what this writes against what src/js/smf.js reads, and importing a module must not write a
// file into the tree.
const runAsScript = process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (runAsScript) {
    main().catch((err) => {
        console.error(`${RED}tune-to-mid: ${err && err.stack ? err.stack : err}${NC}`);
        process.exit(1);
    });
}
