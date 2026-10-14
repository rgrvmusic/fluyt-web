// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The preview tune: eight bars in A minor at 112 BPM, four parts, written in the notation
// src/js/pattern.js documents.
//
// It is an original tune, written for this page. The shape is a sea shanty's - a call answered by a
// response, a bass that pushes on the beat, a harmony in fifths - because the page this plays on is
// a Fluyt page and a Fluyt is a ship. It is not a quotation of any shanty: not "Drunken Sailor",
// not any other, so there is nothing here to attribute and nothing to clear.
//
// Four parts, and each is a thing a visitor can hear an engine do:
//
//   bass   root notes, eighth notes, on the beat       - the engine's low end and its punch
//   lead   the tune                                    - pitch, glide and brightness
//   pad    one sustained chord a bar                   - polyphony, and how it decays
//   drums  kick, snare and hats, General MIDI numbered - the DRUM engine's own kit
//
// The lead is written out bar by bar because it is the line most likely to be edited, and reading
// it a bar at a time is the point. The mechanical parts are built from two one-line helpers; a
// helper is still a string of tokens, so replacing one with a literal changes nothing but the
// reading, and the notation is the same in both.

import { parsePart, stepCount } from './pattern.js';

export const BPM = 112;
export const STEPS_PER_BAR = 16;          // sixteenth notes in 4/4, so one step is a sixteenth
export const BARS = 8;

// one bar of an eighth-note pulse on one note: eight notes, each a sixteenth of sound and a
// sixteenth of rest. This is what a shanty bass does - it pushes, it does not sustain.
const pulse = (note) =>
    `${note} . ${note} . ${note} . ${note} . ${note} . ${note} . ${note} . ${note} .`;

// The drums are written as General MIDI numbers rather than note names, because the numbers are
// what the DRUM engine reads - it maps 35..81 straight onto its kit - and because a drum part in
// note names is a transliteration nobody can read. The map the lines below use:
//
//   36 kick   38 snare   39 clap   42 closed hat   46 open hat
//
// (The engine's own map is in felucca/firmware/src/eng_drum.c; 36..47 also play as those numbers'
// octave, so a GM file pasted in here keeps its meaning.)
//
// One bar of a backbeat: kick and hat on 1, hat on the and, snare and hat on 2, and so on.
const BACKBEAT = '36+42 . 42 . 38+42 . 42 . 36+42 . 42 . 38+42 . 46 .';

// the last bar of the loop: the same as BACKBEAT except for its fourth beat, where the hats give
// way to a snare and a clap so the repeat does not arrive unannounced. Sixteen tokens, like every
// other bar - a bar of seventeen is the mistake this notation makes easiest, which is why
// compileTune() counts.
const FILL = '36+42 . 42 . 38+42 . 42 . 36+42 . 42 . 38+39 . 39+36 .';

// The harmony: A minor, F, G, A minor, twice. Four of the eight bars are the tonic because that is
// what makes a shanty sound like it is going somewhere and coming back.
const CHORDS = ['A2+C3+E3', 'F2+A2+C3', 'G2+B2+D3', 'A2+C3+E3'];
const ROOTS = ['A1', 'F1', 'G1', 'A1'];

// The tune, eight bars. The first four are the call - it rises to the fourth and comes back down to
// the tonic. The second four are the answer: the same shape an octave's reach higher, then a long
// tonic to land on. Each string is one bar of sixteen steps, and both begin on the beat the way a
// shanty line does.
const LEAD_CALL = [
    'A3 . C4 . E4 - . . D4 . C4 . A3 - . .',
    'F4 - . . E4 . C4 . A3 - . . . . . .',
    'G3 . B3 . D4 - . . E4 - . . . . . .',
    'E4 . C4 . A3 - . . A3 - . . . . . .',
];

const LEAD_ANSWER = [
    'A3 . C4 . E4 - . . A4 - . . G4 . E4 .',
    'F4 - . . E4 . D4 . C4 - . . . . . .',
    'D4 . E4 . D4 . B3 . G3 - . . . . . .',
    'A3 - - - . . . . . . . . . . . .',
];

// Held for the whole bar: one token of notes, fifteen of hold. The pad is where an engine's
// polyphony and its release are heard, so it is deliberately the simplest line here.
const chordBar = (chord) => `${chord} ${'- '.repeat(15)}`.trim();

const lead = [...LEAD_CALL, ...LEAD_ANSWER].join(' ');

// The bass walks down to the fifth in the last bar, which is the one thing keeping eight bars of
// root notes from being eight bars of root notes. Written out rather than derived from pulse(),
// because it is the bar that differs and reading it as a line is the point.
const bassBars = [
    pulse('A1'), pulse('F1'), pulse('G1'), pulse('A1'),
    pulse('A1'), pulse('F1'), pulse('G1'), 'A1 . A1 . A1 . A1 . A1 . A1 . E1 . A1 .',
];

// The chords run twice, so the pad is the harmony above and the tune is the line across it.
const padBars = [...CHORDS, ...CHORDS].map(chordBar);

// The seven backbeats and the fill.
const drumBars = [...Array(7).fill(BACKBEAT), FILL];

export const PARTS = [
    {
        id: 'bass',
        label: 'Bass',
        // the role is what src/js/fluyt.js picks a preset by, since a preset index means nothing
        // across engines and means less across a rebuild
        role: 'bass',
        text: bassBars.join(' '),
    },
    {
        id: 'lead',
        label: 'Lead',
        role: 'lead',
        text: lead,
    },
    {
        id: 'pad',
        label: 'Pad',
        role: 'pad',
        text: padBars.join(' '),
    },
    {
        id: 'drums',
        label: 'Drums',
        role: 'drum',
        text: drumBars.join(' '),
    },
];

// The engines a part starts on, by slug from dist/wasm/engines.json. These are the ones the parts
// are written for: a bass on ANALOG, the tune on TRIO, the chords on PHASE and the kit on DRUM.
export const DEFAULT_ENGINES = {
    bass: 'analog',
    lead: 'trio',
    pad: 'phase',
    drums: 'drum',
};

const EXPECTED_STEPS = BARS * STEPS_PER_BAR;

/** The parsed parts, each with its on/off arrays. Throws if a part is not the length it claims. */
export function compileTune(parts = PARTS) {
    return parts.map((part) => {
        const steps = stepCount(part.text);
        if (steps !== EXPECTED_STEPS) {
            throw new Error(
                `tune: ${part.id} is ${steps} steps, and the tune is ${BARS} bars of ` +
                `${STEPS_PER_BAR} - which is ${EXPECTED_STEPS}`);
        }
        const parsed = parsePart(part.text, part.id);
        return { ...part, ...parsed };
    });
}

/**
 * Which preset of a loaded engine a part should use.
 *
 * Preset indices are not comparable across engines - ANALOG's 3 is not TRIO's 3 - and they move
 * when an engine gains a preset, so nothing here is a number. The names come from the module at
 * runtime, so this cannot disagree with the firmware; and the list is ordered, so the first match
 * wins and the earlier patterns are the more literal ones. Falling back to 0 is not a mistake to
 * hide: an engine with nothing bass-like in it plays its first sound, which is what a preview of
 * that engine should do.
 */
const ROLE_PATTERNS = {
    bass: [/BASS/i, /SUB/i, /WOW/i],
    lead: [/LEAD/i, /ACID/i, /PLUCK/i, /BELL/i, /WIRE/i, /RESO/i, /SOLO/i],
    pad: [/PAD/i, /^STR/i, /STRING/i, /CHOIR/i, /ORGAN/i, /BRASS/i, /WIND/i, /RAIN/i],
    drum: [/DRUM/i, /KIT/i, /PERC/i],
};

export function presetForRole(role, presetNames) {
    const patterns = ROLE_PATTERNS[role] || [];
    for (const pattern of patterns) {
        const index = presetNames.findIndex((name) => pattern.test(name));
        if (index >= 0) return index;
    }
    return 0;
}
