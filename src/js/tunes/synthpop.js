// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The synthpop tune: eight bars in D minor at 124 BPM, four parts, written in the notation
// src/js/pattern.js documents.
//
// Like the shanty it is an original tune, written for this page. The shape is synthpop's - a
// four-on-the-floor kick under a snare on two and four, a bass that drives on eighth notes and takes
// the octave on the offbeat, a syncopated hook on top, and chords that simply sit there - and it is
// deliberately the other side of the shanty: where that one is a call answered by a response, this one
// is a loop that repeats, and the hook is the only thing that moves.
//
// It is here because one tune cannot show what choosing a tune does. Its engines are not the shanty's
// - LOFI for the bass, PHASE for the hook, FM6 for the chords, DRUM for the kit - so switching between
// the two changes the sound and not only the notes, which is the point of the picker.
//
// The four parts, and what each lets a visitor hear an engine do:
//
//   bass   eighth notes on the root, the octave on the offbeat  - the engine's low end and its punch
//   lead   the hook, and the answer to it                        - pitch and brightness
//   pad    one sustained chord every two bars                    - polyphony, and how it decays
//   drums  kick, snare and hats, General MIDI numbered           - the DRUM engine's own kit
//
// This file is the tune's source. What the page plays is src/tune/fluyt-synthpop.mid, written from
// this by tools/tune-to-mid.mjs; src/js/tune.js explains why a tune is both, and `make midicheck`
// fails if this notation and that file are not the same tune.

export const ID = 'synthpop';
export const LABEL = 'Synthpop';

export const BPM = 124;
export const STEPS_PER_BAR = 16;          // sixteenth notes in 4/4, so one step is a sixteenth
export const BARS = 8;

// The file this tune is played from, relative to src/tune/. Both sides of the tree find it from here:
// the page asks the browser for SONG_URL, and the Node tools read the same url as a path - one fact,
// two readers. FILE is a plain string constant because tools/pagecheck.mjs substitutes exactly that
// shape into the url below to check the file is there.
export const FILE = 'fluyt-synthpop.mid';
export const SONG_URL = new URL(`../../tune/${FILE}`, import.meta.url);

// The engines the parts start on, by slug from dist/wasm/engines.json. None of them is an engine the
// shanty uses, so that choosing a tune is a change you can hear and not only one you can read.
export const ENGINES = {
    bass: 'lofi',
    lead: 'phase',
    pad: 'fm6',
    drums: 'drum',
};

// one bar of an eighth-note pulse on one note: eight notes, each a sixteenth of sound and a
// sixteenth of rest. The bass sits on the root all bar, which is what a synthpop bass does.
const pulse = (note) =>
    `${note} . ${note} . ${note} . ${note} . ${note} . ${note} . ${note} . ${note} .`;

// one bar of the same eighth notes with the octave taken on every offbeat: the root down low on the
// beat, the same note an octave up between them. It is the other half of a synthpop bass line, and it
// is what the bars that move away from the tonic do.
const octave = (low, high) =>
    `${low} . ${high} . ${low} . ${high} . ${low} . ${high} . ${low} . ${high} .`;

// The drums are written as General MIDI numbers rather than note names, because the numbers are what
// the DRUM engine reads - it maps 35..81 straight onto its kit - and because a drum part in note
// names is a transliteration nobody can read. The map the lines below use:
//
//   36 kick   38 snare   39 clap   42 closed hat   46 open hat
//
// (The engine's own map is in felucca/firmware/src/eng_drum.c; 36..47 also play as those numbers'
// octave, so a GM file pasted in here keeps its meaning.)
//
// Four on the floor: the kick on every beat, the snare on two and four, and a closed hat on every
// eighth. None of it changes from bar to bar, which is what makes it a loop rather than a song - the
// kit is the one thing here that repeats rather than answers.
const FOUR_FLOOR = '36+42 . 42 . 36+38+42 . 42 . 36+42 . 42 . 36+38+42 . 42 .';

// The last bar of the loop: the same four to the floor, with the open hat on the offbeat of two and
// the snare and clap on four doubled, so the repeat does not arrive unannounced. Sixteen tokens, like
// every other bar - a bar of seventeen is the mistake this notation makes easiest, which is why
// compileTune() counts.
const FILL = '36+42 . 42 . 36+38+42 . 46 . 36+42 . 42 . 38+39 . 42 .';

// The harmony, two bars each: D minor, B flat, F, C - a i, VI, III and VII in D minor, which is the
// four chords a synthpop loop is allowed. Two bars each is what makes the hook's phrase and its answer
// land on different chords, so the repeat is heard as a repeat and not as four bars of one thing.
const CHORDS = ['D3+F3+A3', 'Bb2+D3+F3', 'F2+A2+C3', 'C3+E3+G3'];

// The hook, first half: the phrase - up to the fifth, and a syncopated drop back to the tonic. Both
// bars begin away from the beat, which is the one thing that stops a hook over a kick on every beat
// from sounding like the kick.
const LEAD_HOOK = [
    'D4 . F4 . A4 - . . . . G4 . F4 . E4 .',
    'D4 - - - . . . . F4 . E4 . D4 - . .',
];

// Second half: the same shape answered a fourth lower, so the phrase lands on the long tonic the loop
// rests on.
const LEAD_ANSWER = [
    'Bb3 . D4 . F4 - . . . . G4 . F4 . D4 .',
    'F4 - - - . . . . D4 . C4 . Bb3 - . .',
];

// The hook again, a fourth up over F and C, and then the descent home: E, D, C, and back to the top.
// This is the second four bars, and it is where the tune's only long note lives.
const LEAD_REPRISE = [
    'C4 . F4 . A4 - . . . . G4 . A4 . C5 .',
    'A4 - - - . . . . G4 . F4 . E4 - . .',
    'E4 . G4 . C5 - . . . . B4 . A4 . G4 .',
    'E4 - . . D4 - . . C4 - - - . . . .',
];

// Held for two bars: one token of notes, thirty-one of hold. The pad is where an engine's polyphony
// and its release are heard, so it is deliberately the simplest line here - a chord a visitor can
// hear change under the hook, and nothing else.
const chordPair = (chord) => `${chord} ${'- '.repeat(31)}`.trim();

// Eight bars, in the order the loop plays them: the hook, its answer, the hook an octave's reach
// higher, and the descent that leads back to the top.
const lead = [...LEAD_HOOK, ...LEAD_ANSWER, ...LEAD_REPRISE].join(' ');

// The bass, bar by bar: root notes on the tonic bars, the octave on the bars that move away, and a
// turnaround in the last bar that ends on the fifth and steps back up to the root. Written out rather
// than derived, because the two shapes alternate and reading them as lines is the point.
const bassBars = [
    pulse('D2'), pulse('D2'),
    octave('Bb1', 'Bb2'), octave('Bb1', 'Bb2'),
    pulse('F2'), pulse('F2'),
    octave('C2', 'C3'), 'C2 . C2 . C2 . C2 . A1 . A1 . D2 . D2 .',
];

// One pair a chord - four chords, two bars each, which is the whole eight. The pad changes four times
// across the loop, and the hook has somewhere to go each time it does.
const padBars = CHORDS.map(chordPair);

// The seven bars of four to the floor and the fill.
const drumBars = [...Array(7).fill(FOUR_FLOOR), FILL];

// The four lines, keyed by part id. src/js/parts.js has the parts themselves - their names, their
// order and what a preset is chosen by - and src/js/tune.js fails the build if these two ever name
// different things.
export const TEXT = {
    bass: bassBars.join(' '),
    lead,
    pad: padBars.join(' '),
    drums: drumBars.join(' '),
};
