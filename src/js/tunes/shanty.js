// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The sea shanty: eight bars in A minor at 112 BPM, four parts, written in the notation
// src/js/pattern.js documents.
//
// It is an original tune, written for this page. The shape is a shanty's - a call answered by a
// response, a bass that pushes on the beat, a harmony in fifths - because the page this plays on is
// a Fluyt page and a Fluyt is a ship. It is not a quotation of any shanty: not "Drunken Sailor", not
// any other, so there is nothing here to attribute and nothing to clear.
//
// Four parts, and each is a thing a visitor can hear an engine do:
//
//   bass   root notes, eighth notes, on the beat       - the engine's low end and its punch
//   lead   the tune                                    - pitch, glide and brightness
//   pad    one sustained chord a bar                   - polyphony, and how it decays
//   drums  kick, snare and hats, General MIDI numbered - the DRUM engine's own kit
//
// The lead is written out bar by bar because it is the line most likely to be edited, and reading it
// a bar at a time is the point. The mechanical parts are built from two one-line helpers; a helper is
// still a string of tokens, so replacing one with a literal changes nothing but the reading, and the
// notation is the same in both.
//
// This file is the tune's source. What the page plays is src/tune/fluyt-shanty.mid, written from this
// by tools/tune-to-mid.mjs; src/js/tune.js explains why a tune is both, and `make midicheck` fails if
// this notation and that file are not the same tune.

export const ID = 'shanty';
export const LABEL = 'Sea shanty';

export const BPM = 112;
export const STEPS_PER_BAR = 16;          // sixteenth notes in 4/4, so one step is a sixteenth
export const BARS = 8;

// The file this tune is played from, relative to src/tune/. Both sides of the tree find it from here:
// the page asks the browser for SONG_URL, and the Node tools read the same url as a path - one fact,
// two readers. FILE is a plain string constant because tools/pagecheck.mjs substitutes exactly that
// shape into the url below to check the file is there.
export const FILE = 'fluyt-shanty.mid';
export const SONG_URL = new URL(`../../tune/${FILE}`, import.meta.url);

// The engines the parts start on, by slug from dist/wasm/engines.json. These are the ones this tune
// is written for: a bass on ANALOG, the tune on TRIO, the chords on PHASE and the kit on DRUM. A tune
// brings its own, so that choosing a tune is a change you can hear and not only one you can read.
export const ENGINES = {
    bass: 'analog',
    lead: 'trio',
    pad: 'phase',
    drums: 'drum',
};

// one bar of an eighth-note pulse on one note: eight notes, each a sixteenth of sound and a
// sixteenth of rest. This is what a shanty bass does - it pushes, it does not sustain.
const pulse = (note) =>
    `${note} . ${note} . ${note} . ${note} . ${note} . ${note} . ${note} . ${note} .`;

// The drums are written as General MIDI numbers rather than note names, because the numbers are what
// the DRUM engine reads - it maps 35..81 straight onto its kit - and because a drum part in note
// names is a transliteration nobody can read. The map the lines below use:
//
//   36 kick   38 snare   39 clap   42 closed hat   46 open hat
//
// (The engine's own map is in felucca/firmware/src/eng_drum.c; 36..47 also play as those numbers'
// octave, so a GM file pasted in here keeps its meaning.)
//
// One bar of a backbeat: kick and hat on 1, hat on the and, snare and hat on 2, and so on.
const BACKBEAT = '36+42 . 42 . 38+42 . 42 . 36+42 . 42 . 38+42 . 46 .';

// the last bar of the loop: the same as BACKBEAT except for its fourth beat, where the hats give way
// to a snare and a clap so the repeat does not arrive unannounced. Sixteen tokens, like every other
// bar - a bar of seventeen is the mistake this notation makes easiest, which is why compileTune()
// counts.
const FILL = '36+42 . 42 . 38+42 . 42 . 36+42 . 42 . 38+39 . 39+36 .';

// The harmony: A minor, F, G, A minor, twice. Four of the eight bars are the tonic because that is
// what makes a shanty sound like it is going somewhere and coming back.
const CHORDS = ['A2+C3+E3', 'F2+A2+C3', 'G2+B2+D3', 'A2+C3+E3'];

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

// The bass walks down to the fifth in the last bar, which is the one thing keeping eight bars of root
// notes from being eight bars of root notes. Written out rather than derived from pulse(), because
// it is the bar that differs and reading it as a line is the point.
const bassBars = [
    pulse('A1'), pulse('F1'), pulse('G1'), pulse('A1'),
    pulse('A1'), pulse('F1'), pulse('G1'), 'A1 . A1 . A1 . A1 . A1 . A1 . E1 . A1 .',
];

// The chords run twice, so the pad is the harmony above and the tune is the line across it.
const padBars = [...CHORDS, ...CHORDS].map(chordBar);

// The seven backbeats and the fill.
const drumBars = [...Array(7).fill(BACKBEAT), FILL];

// The four lines, keyed by part id. src/js/parts.js has the parts themselves - their names, their
// order and what a preset is chosen by - and src/js/tune.js fails the build if these two ever name
// different things.
export const TEXT = {
    bass: bassBars.join(' '),
    lead,
    pad: padBars.join(' '),
    drums: drumBars.join(' '),
};
