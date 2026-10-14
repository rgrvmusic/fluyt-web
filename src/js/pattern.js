// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The step notation the tune is written in, and the conversion from it to the two things the
// worklet needs: which notes start on a step, and which stop.
//
// A part is one string of whitespace-separated tokens, one per sixteenth note:
//
//   A1          a note, in the scientific pitch notation below
//   36          a note, as a MIDI number - what a General MIDI drum part is written in
//   A2+C3+E3    several notes at once, joined with +
//   .           a rest
//   -           hold: the notes started at the last token that was a note keep sounding
//
// A note's gate runs from the step it is written on to the step before the first token that is not
// a hold, so "A1 . . ." is a sixteenth and "A1 - - -" is a quarter. Nothing else is implied: a
// token that follows a rest is a new note, not a continuation, so there is no way to write a note
// that outlives a gap in the notation - which is what makes a line readable a bar at a time.

const SEMITONES = {
    c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5,
    'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11,
};

// Middle C is 60. That is the convention General MIDI's note table and every DAW's default use,
// and it is the one the DRUM part depends on: 36 is a kick drum, 38 a snare, 42 a closed hat. The
// other reading (middle C is 48, so C3 = 60) would silently transpose every melodic part by an
// octave and move every drum hit to a different instrument.
const MIDDLE_C = 60;

/**
 * "A1", "C#4", "Bb2", "36" -> a MIDI note number. Returns null for anything else.
 *
 * A bare number is allowed, and means the MIDI note of that number and nothing else. That is not a
 * second kind of token with its own meaning: the DRUM engine's notes *are* General MIDI numbers -
 * see the map in felucca/firmware/src/eng_drum.c - so 36 is the kick there in the same sense that
 * A1 is the A below middle C everywhere else. Writing the drum part as note names instead would put
 * a transliteration between the reader and the kit, since nobody reads C2 and thinks "kick".
 */
export function noteToMidi(token) {
    if (/^\d+$/.test(token)) {
        const plain = parseInt(token, 10);
        return plain >= 0 && plain <= 127 ? plain : null;
    }

    const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(token);
    if (!m) return null;

    const semitone = SEMITONES[(m[1] + m[2]).toLowerCase()];
    if (semitone === undefined) return null;

    // the octave number counts from middle C: C4 is 60, so C4 = 60 + 0 and A4 = 60 + 9
    const midi = MIDDLE_C + semitone + 12 * (parseInt(m[3], 10) - 4);
    return midi >= 0 && midi <= 127 ? midi : null;
}

/** The inverse, for messages and for the keyboard page's note display. */
export function midiToNote(midi) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const n = Math.round(midi);
    return `${names[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/**
 * One part's steps -> { on, off }, two arrays indexed by step holding the note numbers to start and
 * to stop. Throws on a token that is not a note, a rest or a hold, because a typo in the tune is a
 * mistake worth stopping for - it would otherwise come out as a rest and read as a musical choice.
 */
export function parsePart(text, name = 'part') {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) throw new Error(`${name}: no steps`);

    const on = tokens.map(() => []);
    const off = tokens.map(() => []);

    let sounding = [];   // notes started at the last note token, still gated

    tokens.forEach((token, step) => {
        if (token === '.') {
            for (const n of sounding) off[step].push(n);
            sounding = [];
            return;
        }

        if (token === '-') {
            // a hold keeps `sounding` as it is; the gate simply is not closed on this step
            return;
        }

        // a new note token: close whatever was sounding, then start this
        for (const n of sounding) off[step].push(n);

        const notes = token.split('+').map((t) => {
            const midi = noteToMidi(t);
            if (midi === null) throw new Error(`${name}: step ${step}: "${t}" is not a note name`);
            return midi;
        });

        on[step].push(...notes);
        sounding = notes;
    });

    // A note still held at the end of the pattern is released on one step past it, so it does not
    // hang across the loop point. Both arrays therefore carry `steps + 1` entries and the last one
    // is the wrap step, which the worklet fires between the end of the pattern and step 0 of the
    // next pass. Sending it as a step rather than closing the gates at the wrap keeps every note
    // ending in the same place, whether the pattern is playing or being stopped.
    on.push([]);
    off.push([]);
    for (const n of sounding) off[tokens.length].push(n);

    return { on, off, steps: tokens.length };
}

/** Step count of a part, without building the note lists - for checking the tune lines up. */
export function stepCount(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
}
