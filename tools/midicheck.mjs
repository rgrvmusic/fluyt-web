#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// Read the tunes back. Run with `make check`, or `node tools/midicheck.mjs`.
//
// The page does not play the notation in src/js/tunes/: it plays the files in src/tune/, through
// src/js/smf.js. That is one more thing between a tune and the engines, and it is the kind of thing
// that fails quietly - a reader that loses the last note of a bar, or moves a note by a step, still
// produces a tune, just not this one. So every file is read here by the same parser the page loads,
// and what comes back is compared to the notation it was written from, note for note and step for
// step. Every tune in TUNES is checked, and each against its own facts: the tempo, the grid and the
// number of bars are the tune's, and two tunes need not agree about any of them.
//
// The rest of the file is about the reader's own decisions, which nothing else checks:
//
//   * the grid. A file of sixteenths has to come back as sixteenths and not be moved; a file of
//     triplets has to come back as triplets and not be moved either. Each of the six is built and
//     read back, and each has to be the one chosen - the coarsest that divides it and no coarser.
//   * the awkward files. A note held past the end of the file, a note of no length, an off with no
//     on, a file with no tempo, a file that changes tempo, a file with more parts in it than the page
//     has - each is a decision in smf.js that either reports itself or loses music, and here is where
//     "reports itself" is the checked claim.
//
// The fixtures are built by tools/midifile.mjs, which is the writer the notation goes through, so the
// reader is being tested against files made by the code that made the files it actually plays.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildMidi, noteEvents } from './midifile.mjs';
import { buildTuneMidi, partEvents, CHANNELS } from './tune-to-mid.mjs';
import { TUNES } from '../src/js/tunes/index.js';
import { LAYOUT } from '../src/js/parts.js';
import { compileTune, compileMidi } from '../src/js/tune.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The same division tools/tune-to-mid.mjs writes at: 480 to the quarter, so a sixteenth is 120 ticks
// and every one of the six grids divides it exactly.
const DIVISION = 480;
const BAR = DIVISION * 4;

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const NC = '\u001b[0m';

const failures = [];
const fail = (what, detail) => {
    failures.push(what);
    console.log(`  ${RED}✗${NC} ${what}`);
    if (detail) console.log(`    ${detail}`);
};
const ok = (what) => console.log(`  ${GREEN}✓${NC} ${what}`);
const check = (what, condition, detail) => (condition ? ok(what) : fail(what, detail));

// ------------------------------------------------------------------------------------- fixtures

const file = (tracks, options = {}) => buildMidi({ division: DIVISION, tracks, ...options });

const track = (name, notes, channel = 0, extra = []) =>
    ({ name, events: [...noteEvents(notes, { channel }), ...extra] });

/** `count` notes on 60, one every `spacing` ticks, each `length` long. */
const onsets = (count, spacing, length = spacing) =>
    Array.from({ length: count }, (_, i) => ({ note: 60, start: i * spacing, end: i * spacing + length }));

// A set-tempo meta event (0xFF 0x51), which tools/midifile.mjs writes once from a BPM. This check
// needs two, so it writes them itself: a file that changes tempo is the case smf.js counts.
const tempo = (microseconds) => [
    0xff, 0x51, 0x03,
    (microseconds >> 16) & 0xff, (microseconds >> 8) & 0xff, microseconds & 0xff,
];

// ------------------------------------------------------------------------------- comparisons

/** The first step where a part read back and the same part written out disagree, or null. */
function firstDifference(part, expected) {
    if (part.on.length !== expected.on.length) {
        return `its arrays are ${part.on.length} entries long, and the notation's are ` +
               `${expected.on.length} - the tune is a different length`;
    }
    for (let step = 0; step < part.on.length; step++) {
        const on = part.on[step].join(',');
        const off = part.off[step].join(',');
        if (on !== expected.on[step].join(',') || off !== expected.off[step].join(',')) {
            return `step ${step}: off [${off}] on [${on}], and the notation says ` +
                   `off [${expected.off[step].join(',')}] on [${expected.on[step].join(',')}]`;
        }
    }
    return null;
}

/**
 * Every part of `song` against the notation, which is what the reader has to reproduce.
 *
 * Compared entry by entry rather than as a whole, because a reader that is a step out produces a tune
 * that sounds nearly right - "different" is not a useful thing to be told, "step 16 closes 45 that
 * step 17 opens" is.
 */
function sameParts(song, expected, label) {
    const before = failures.length;

    for (const part of song.parts) {
        const want = expected.find((p) => p.id === part.id);
        if (!want) {
            fail(`${label}: the file gave a part the notation does not have (${part.id})`);
            continue;
        }
        const difference = firstDifference(part, want);
        if (difference) fail(`${label}: ${part.id} is not what was written - ${difference}`);
    }

    if (failures.length === before) {
        ok(`${label}: all ${song.parts.length} parts, note for note and step for step`);
    }
}

/**
 * The notes a part leaves sounding at the end of the pass: everything its ons open and nothing
 * closes. The wrap entry is where the page releases them, one step past the last step - and the loop
 * point is where that has to be right, because a note still held when the pattern comes round would
 * either hang across the repeat or never retrigger.
 */
function leftSounding(part) {
    const sounding = new Set();
    for (let step = 0; step < part.steps; step++) {
        for (const note of part.off[step] || []) sounding.delete(note);
        for (const note of part.on[step] || []) sounding.add(note);
    }
    return [...sounding].sort((a, b) => a - b);
}

/** The same list, sorted, so two of them can be compared as text. */
const notes = (list) => [...list].sort((a, b) => a - b).join(',');

// --------------------------------------------------------------------------------- the check

/** One tune: its notation, its file, and what the page reads back out of it. */
async function checkTune(notation) {
    const target = fileURLToPath(notation.SONG_URL);
    const named = `src/${path.relative(path.join(ROOT, 'src'), target)}`;

    console.log('');
    console.log(`${notation.LABEL} - the notation, the file, and what the page reads back:`);

    const compiled = compileTune(notation);
    const committed = new Uint8Array(await readFile(target));
    const written = buildTuneMidi(notation);

    const same = committed.length === written.length &&
                 committed.every((byte, i) => byte === written[i]);
    check(`${named} is what the notation says (${committed.length} bytes)`, same,
          `${committed.length} bytes committed, ${written.length} written from ` +
          `src/js/tunes/${notation.ID}.js - run: node tools/tune-to-mid.mjs`);

    const song = compileMidi(committed);

    check(`the file reads back as ${notation.BARS} bars of ${notation.STEPS_PER_BAR} - ` +
          `${song.steps} steps`,
          song.steps === notation.BARS * notation.STEPS_PER_BAR && song.bars === notation.BARS,
          `${song.steps} steps, ${song.bars} bars`);
    check(`at ${notation.BPM} BPM, from the file's own tempo`, Math.abs(song.bpm - notation.BPM) < 0.001,
          `${song.bpm} BPM`);
    check(`on ${notation.STEPS_PER_BAR} to the bar, and nothing had to be moved`,
          song.stepsPerBar === notation.STEPS_PER_BAR && song.snapped === 0,
          `${song.grid} (${song.stepsPerBar} to the bar), ${song.snapped} notes moved`);
    check('no note dropped, none held past the end, no track that had nowhere to go',
          song.dropped === 0 && song.unmapped === 0 && song.parts.every((p) => p.held === 0),
          `${song.dropped} dropped, ${song.unmapped} unmapped, ` +
          `${song.parts.reduce((n, p) => n + p.held, 0)} held at the end`);
    check('one tempo in it, which is what the transport assumes', song.tempoChanges === 0);

    sameParts(song, compiled, notation.ID);

    // The wrap entry is the one the loop point turns on, so it is worth naming for every part rather
    // than for the one part whose line makes it obvious: whatever a pass leaves sounding - a chord,
    // a note written with no end, nothing at all - is released on step `steps`, not on step 0.
    for (const part of song.parts) {
        const left = notes(leftSounding(part));
        const wrap = notes(part.off[part.steps] || []);
        check(`${part.id} is released on the wrap entry, step ${part.steps}: [${wrap}]`,
              left === wrap,
              `[${wrap}] released there, and the pass leaves [${left}] sounding`);
    }

    // ---- format 0: one track, the parts told apart by channel
    //
    // The same tune, flattened into the one track a phone app exports - so the four parts have to be
    // recovered from the channels alone, and come back as the same four.
    const merged = [];
    compiled.forEach((part, index) => merged.push(...partEvents(part, CHANNELS[index],
        DIVISION * 4 / notation.STEPS_PER_BAR)));
    const flat = compileMidi(file([{ name: notation.LABEL, events: merged }],
        { format: 0, bpm: notation.BPM }));

    check('the same four parts in one track, mapped by channel rather than by name',
          flat.steps === song.steps && flat.stepsPerBar === song.stepsPerBar &&
          Math.abs(flat.bpm - song.bpm) < 0.001,
          `${flat.steps} steps, ${flat.grid} (${flat.stepsPerBar} to the bar), ` +
          `${flat.bpm.toFixed(3)} BPM - and the four-track version is ${song.steps}, ` +
          `${song.grid}, ${song.bpm.toFixed(3)} BPM`);
    sameParts(flat, compiled, `${notation.ID} flattened`);
}

async function main() {
    // ---- 1. the tunes: each notation, its file, and what the page reads back
    for (const notation of TUNES) await checkTune(notation);

    // ---- 2. the grid: the coarsest that divides the file, and no coarser
    console.log('');
    console.log('The grid - one fixture per grid, and each has to be the one chosen:');

    for (const stepsPerBar of [12, 16, 24, 32, 48, 96]) {
        const ticksPerStep = BAR / stepsPerBar;
        const read = compileMidi(file([track('Bass', onsets(stepsPerBar, ticksPerStep))]));

        check(`${String(stepsPerBar).padStart(2)} steps to the bar for notes every ` +
              `${String(ticksPerStep).padStart(3)} ticks - one bar of it is ${stepsPerBar} steps`,
              read.stepsPerBar === stepsPerBar && read.steps === stepsPerBar && read.snapped === 0,
              `${read.grid} (${read.stepsPerBar} to the bar), ${read.steps} steps, ` +
              `${read.snapped} moved`);
    }

    // A file that is on none of the six - a note a tick off every one of them - is the fallback: it
    // is played, on sixteenths, with the number of notes moved said out loud rather than hidden.
    const off = compileMidi(file([track('Bass', [
        { note: 60, start: 0, end: 121 },
        { note: 62, start: 240, end: 360 },
    ])]));
    check('a note between two ticks of all six falls back to sixteenths and says what it moved',
          off.stepsPerBar === 16 && off.snapped === 1 && off.worst === 1,
          `${off.grid} (${off.stepsPerBar} to the bar), ${off.snapped} moved, ` +
          `the furthest by ${off.worst} ticks`);

    // ---- 3. the awkward files
    console.log('');
    console.log('The files that are not a tune here - a note with no end, an off with no on:');

    const held = compileMidi(file([track('Bass', [{ note: 60, start: 0, end: null }])]));
    const heldPart = held.parts.find((p) => p.id === 'bass');
    check('a note the file never releases is held, and released on the wrap entry',
          heldPart.on[0].join(',') === '60' && heldPart.off[held.steps].join(',') === '60' &&
          heldPart.held === 1,
          `held ${heldPart.steps} steps, off [${heldPart.off[held.steps]}] on step ${heldPart.steps}`);

    const orphan = compileMidi(file([track('Bass', [{ note: 60, start: 0, end: 120 }], 0,
        [{ tick: 480, order: 0, bytes: [0x80, 62, 64] }])]));
    check('a note-off with no note-on is counted, not played', orphan.dropped === 1,
          `${orphan.dropped} dropped`);

    const empty = compileMidi(file([track('Bass', [{ note: 60, start: 0, end: 0 },
        { note: 62, start: 120, end: 240 }])]));
    check('a note with no length is counted, not switched on and left sounding',
          empty.dropped === 1, `${empty.dropped} dropped`);

    const untimed = compileMidi(file([track('Bass', onsets(4, 480))], { bpm: null }));
    check('a file that never sets a tempo is played at the standard 120', untimed.bpm === 120,
          `${untimed.bpm} BPM`);

    const shifting = compileMidi(file([track('Bass', onsets(4, 480), 0, [
        { tick: 0, order: -1, bytes: tempo(535714) },
        { tick: 480, order: -1, bytes: tempo(400000) },
    ])], { bpm: null }));
    check('a file that changes tempo plays at the first one, and the change is counted',
          Math.abs(shifting.bpm - 112) < 0.001 && shifting.tempoChanges === 1,
          `${shifting.bpm.toFixed(3)} BPM, ${shifting.tempoChanges} change`);

    // Five channels and four parts: the four that map play, and the fifth's notes are counted.
    const extra = [
        track('', onsets(1, 480), 0),
        track('', onsets(1, 480), 1),
        track('', onsets(1, 480), 2),
        track('', onsets(1, 480), 3),
        track('', onsets(1, 480), 4),
    ];
    const crowded = compileMidi(file([{ name: 'Five', events: extra.flatMap((t) => t.events) }],
        { format: 0 }));
    check('a file with more parts than the page has plays the four it can and counts the rest',
          crowded.parts.length === LAYOUT.length && crowded.unmapped === 1,
          `${crowded.parts.length} parts, ${crowded.unmapped} notes with nowhere to go`);

    // A tune that is not a whole number of bars is padded to one, so the loop is a length the
    // transport can count: 20 steps of sixteenths is two bars.
    const ragged = compileMidi(file([track('Bass', onsets(20, 120))]));
    check('a tune that is not a whole number of bars is rounded up to one',
          ragged.steps === 32 && ragged.bars === 2, `${ragged.steps} steps, ${ragged.bars} bars`);

    // ---- the tally
    console.log('');
    if (failures.length) {
        console.log(`${RED}${failures.length} failure${failures.length === 1 ? '' : 's'}${NC}`);
        process.exit(1);
    }
    console.log(`${GREEN}every file the page plays is its notation's, and reads back as the tune${NC}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(`${RED}midicheck: ${err && err.stack ? err.stack : err}${NC}`);
    process.exit(1);
});
