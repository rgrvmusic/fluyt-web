#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// Write every tune out as a Standard MIDI File.
//
// Each tune the page plays is a file in src/tune/ - the only music in this repository that is not
// source - written from the notation in src/js/tunes/, which is where a tune is authored: the
// notation is a bar a line and can be read and edited by hand, and this is what turns it into what a
// page - and a DAW - reads. Run it after editing a notation:
//
//   node tools/tune-to-mid.mjs            write src/tune/<tune>.mid for every tune in TUNES
//   node tools/tune-to-mid.mjs --check    fail if any committed file is not what its notation says
//
// `make check` runs the --check form, so a notation and its file cannot drift apart: a note added to
// the notation and not written out is a failure, rather than a page that plays the old tune.
//
// A tune authored in a DAW instead is a supported thing to do - put the file in src/tune/, drop the
// notation module and the TUNES line that names it, and the page plays the file. What it must not be
// is a file here and a notation there, each claiming to be the tune.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { buildMidi } from './midifile.mjs';
import { TUNES } from '../src/js/tunes/index.js';
import { compileTune } from '../src/js/tune.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const NC = '\u001b[0m';

// 480 ticks a quarter puts a sixteenth on 120, which is what makes the page's sixteenth grid exact
// rather than a rounding: every grid in src/js/smf.js divides 480.
const DIVISION = 480;

// How many ticks one of a tune's steps is: a quarter is four steps in a tune of sixteenths and eight
// in a tune of thirty-seconds, and where a step falls in the file has to follow the tune's own grid
// rather than this one. §2 of tools/midicheck.mjs holds the page's reader to the same six grids.
export const ticksPerStep = (stepsPerBar) => DIVISION * 4 / stepsPerBar;

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
 * A step is one of the tune's grid, so step `s` is tick `s * ticksPerStep`. The wrap entry - the last
 * one in the arrays, holding the notes a pass leaves sounding - is therefore at `steps * ticks`, the
 * tick one past the last step, which is exactly where the page releases it. Nothing here needs to
 * know about the wrap; it is the same arithmetic over one more step.
 *
 * Offs come before ons at the same tick, which is the order a step is applied in: a note repeated on
 * the step it is released has to be released first or it never retriggers.
 */
export function partEvents(part, channel, ticksPerStep) {
    const events = [];
    for (let step = 0; step < part.on.length; step++) {
        const tick = Math.round(step * ticksPerStep);
        for (const note of part.off[step] || []) {
            events.push({ tick, order: 0, bytes: [NOTE_OFF | channel, note, RELEASE] });
        }
        for (const note of part.on[step] || []) {
            events.push({ tick, order: 1, bytes: [NOTE_ON | channel, note, VELOCITY] });
        }
    }
    return events;
}

/**
 * One tune's notation, as a MIDI file: one track per part, one channel each, named for the part.
 *
 * `notation` is a module out of src/js/tunes/. Everything in the file is that tune's own - its tempo,
 * its division into steps, how many parts it has - so no two tunes in this repository need agree
 * about any of it.
 */
export function buildTuneMidi(notation) {
    const compiled = compileTune(notation);
    const ticks = ticksPerStep(notation.STEPS_PER_BAR);
    const tracks = compiled.map((part, index) => ({
        name: part.label,
        events: partEvents(part, CHANNELS[index % CHANNELS.length], ticks),
    }));

    return buildMidi({ format: 1, division: DIVISION, bpm: notation.BPM, tracks });
}

const same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

async function main() {
    const check = process.argv.includes('--check');
    let bad = 0;

    for (const notation of TUNES) {
        // the url the page fetches, read as a path: one fact, two readers (see src/js/tunes/shanty.js)
        const target = fileURLToPath(notation.SONG_URL);
        const named = path.relative(path.join(ROOT, 'src'), target);
        const built = buildTuneMidi(notation);

        if (!check) {
            await writeFile(target, built);
            console.log(`wrote src/${named} - ${built.length} bytes, ${notation.BARS} bars of ` +
                        `${notation.STEPS_PER_BAR} at ${notation.BPM} BPM`);
            continue;
        }

        const committed = new Uint8Array(await readFile(target));
        if (same(committed, built)) {
            console.log(`  ${GREEN}✓${NC} src/${named} is what the notation says ` +
                        `(${built.length} bytes)`);
            continue;
        }

        bad++;
        console.log(`  ${RED}✗${NC} src/${named} is not what the notation says: ` +
                    `${committed.length} bytes committed, ${built.length} written from ` +
                    `src/js/tunes/${notation.ID}.js`);
    }

    if (!bad) return;

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
