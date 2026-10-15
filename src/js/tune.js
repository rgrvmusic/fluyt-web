// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// A tune, from the two places it comes from: the notation a tune is written in, and the MIDI file
// the page plays.
//
// The page reads a file, not a notation. Every tune here is written both ways on purpose, paid for
// with what each is good at: the notation is a bar a line and can be read, edited and reviewed in
// src/js/tunes/, and the file is what a DAW opens and what the page actually parses. Neither is a
// second implementation of the tune - the file is generated from the notation by
// tools/tune-to-mid.mjs, and `make midicheck` fails if the two are not the same tune - so a note
// added to a notation and not written out is a build failure rather than a page quietly playing last
// week's tune.
//
// This module is the middle of that: it holds the two directions and nothing about any one tune.
// What a tune *is* lives in src/js/tunes/, what the parts are lives in src/js/parts.js, and this is
// where the two meet.
//
//   compileTune(notation)   the notation, as the parts the page plays
//   compileMidi(bytes)      a MIDI file, as the same - the page's own path, for any file
//   loadTune(id)            a bundled tune, fetched and compiled
//
// The last of those is every file a visitor brings too, through compileMidi: a loaded file is not a
// second kind of thing, it is a tune whose notation nobody kept.

import { LAYOUT } from './parts.js';
import { parsePart, stepCount } from './pattern.js';
import { parseMidi, partsFromMidi } from './smf.js';
import { DEFAULT_TUNE_ID, tuneById } from './tunes/index.js';

export { DEFAULT_TUNE_ID };

/**
 * A tune's notation, as the parts the page plays: each with its on/off arrays, its id, its label and
 * its role.
 *
 * `notation` is a module out of src/js/tunes/. The length check is the one this notation makes
 * easiest to get wrong - a bar of seventeen tokens, or a bar that is missing - and it is checked
 * against that tune's own bars and grid rather than against a constant, because there is no one grid
 * here any more: a tune in triplets is 12 or 24 to the bar and is as correct as this one.
 *
 * The two key checks are the other half of it. A part with no line in TEXT is a part that is silently
 * silent - the page would build it, play it, and never say why nothing came out - and a key in TEXT
 * that is not a part is a line nobody plays and that no check downstream would ever inventory. Both
 * are failures here rather than a tune that is merely smaller than it reads.
 */
export function compileTune(notation) {
    const expected = notation.BARS * notation.STEPS_PER_BAR;

    for (const part of LAYOUT) {
        if (!(part.id in notation.TEXT)) {
            throw new Error(`tune: ${notation.ID} has no ${part.id} - every tune writes all ` +
                            `${LAYOUT.length} parts (${LAYOUT.map((p) => p.id).join(', ')})`);
        }
        if (!notation.ENGINES[part.id]) {
            throw new Error(`tune: ${notation.ID} gives no engine to ${part.id}`);
        }
    }
    for (const id of Object.keys(notation.TEXT)) {
        if (!LAYOUT.some((part) => part.id === id)) {
            throw new Error(`tune: ${notation.ID} writes a ${id}, and the page has no such part ` +
                            `(${LAYOUT.map((p) => p.id).join(', ')})`);
        }
    }

    return LAYOUT.map((part) => {
        const steps = stepCount(notation.TEXT[part.id]);
        if (steps !== expected) {
            throw new Error(
                `tune: ${notation.ID}'s ${part.id} is ${steps} steps, and the tune is ` +
                `${notation.BARS} bars of ${notation.STEPS_PER_BAR} - which is ${expected}`);
        }
        return { ...part, ...parsePart(notation.TEXT[part.id], part.id) };
    });
}

/**
 * A MIDI file, as the page plays it. What comes back is the file's own facts - its tempo, which of
 * the six grids it landed on, how many bars it is, and what the reader had to move or drop to get
 * there - with the parts under `parts`.
 *
 * The parts come from src/js/parts.js and not from the file: which four parts a tune has is the
 * page's business, and a track is matched to one of them by name. A file with five tracks, or none,
 * is a file this handles - see src/js/smf.js for what it does with what it cannot place.
 */
export function compileMidi(bytes) {
    return partsFromMidi(parseMidi(bytes), LAYOUT);
}

/** A bundled tune, fetched and compiled. Throws for an id that is not a tune, or a file that is not there. */
export async function loadTune(id = DEFAULT_TUNE_ID) {
    const notation = tuneById(id);
    if (!notation) throw new Error(`${id} is not one of the tunes the page has`);

    const res = await fetch(notation.SONG_URL);
    if (!res.ok) throw new Error(`${notation.FILE}: the browser answered ${res.status}`);
    return compileMidi(new Uint8Array(await res.arrayBuffer()));
}
