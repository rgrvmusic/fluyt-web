// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The house tune: eight bars in A minor at 126 BPM, four parts, written in the notation
// src/js/pattern.js documents.
//
// Like the others it is an original tune, written for this page. The shape is house's, and house
// is the one tune here that is a rhythm before it is a melody: the kick on every beat, a clap on two
// and four - a snare there would be a different genre, which is the single decision that makes this
// file house or not - and an open hat on every offbeat. That figure never changes, so unlike the
// shanty's call and answer or the synthpop loop, the drums here are a floor rather than a line.
//
// What moves above that floor is the other half of it, and it is where this tune differs from the
// synthpop's four to the floor: the bass is written *between* the kicks rather than on them, so the
// low end rolls where the kick is not, and the kick keeps the whole of every beat to itself. A house
// bass that doubles the kick is a house bass fighting it.
//
// The four parts, and what each lets a visitor hear an engine do:
//
//   bass   offbeat eighths on the root, the fifth or octave in the turn  - the engine's low end
//   lead   the hook, and the answer to it, as stabs                      - pitch and brightness
//   pad    one sustained chord every two bars                            - polyphony, and its decay
//   drums  kick, clap and hats, General MIDI numbered                    - the DRUM engine's own kit
//
// This file is the tune's source. What the page plays is src/tune/fluyt-house.mid, written from
// this by tools/tune-to-mid.mjs; src/js/tune.js explains why a tune is both, and `make midicheck`
// fails if this notation and that file are not the same tune.

export const ID = 'house';
export const LABEL = 'House';

export const BPM = 126;
export const STEPS_PER_BAR = 16;          // sixteenth notes in 4/4, so one step is a sixteenth
export const BARS = 8;

// The file this tune is played from, relative to src/tune/. Both sides of the tree find it from here:
// the page asks the browser for SONG_URL, and the Node tools read the same url as a path - one fact,
// two readers. FILE is a plain string constant because tools/pagecheck.mjs substitutes exactly that
// shape into the url below to check the file is there.
export const FILE = 'fluyt-house.mid';
export const SONG_URL = new URL(`../../tune/${FILE}`, import.meta.url);

// The engines the parts start on, by slug from dist/wasm/engines.json. The page chooses a preset by
// the part's role rather than by an index, so what these actually sound as is worth writing down:
// WHEEL has no bass of its own and falls to its organ, so the bass here is FULL ORGAN; FM6's PLUCK
// is the house hook already - it has no sustain, which is exactly the point of a hook written as
// stabs; PHASE gives STRING for the sustained chord; and DRUM gives its kit, which is what the
// numbered line below is written for.
export const ENGINES = {
    bass: 'wheel',    // FULL ORGAN - an organ bass, which is what a house bass wants to be
    lead: 'fm6',      // PLUCK      - short, percussive, no sustain: a stab is what it can play
    pad: 'phase',     // STRING     - the sustained chord, and how it decays under everything
    drums: 'drum',    // DRUM KIT   - General MIDI numbers, 35..81
};

// one bar of an organ bass on the offbeats: an eighth note beginning on the "and" of every beat, so
// every note sits in the gap the kick leaves. This is the whole reason the two do not fight - the
// bar has four of these and four kicks and none of them share a step.
const roll = (note) =>
    `. . ${note} - . . ${note} - . . ${note} - . . ${note} -`;

// One bar of the same with the fourth note changed, and the note it changes to is what carries the
// bass into the next chord: the fifth above the root on all but the last bar, where it steps up to
// the tonic the loop restarts on. A house bass does not walk, it hinges on one note a bar.
const rollTo = (note, turn) =>
    `. . ${note} - . . ${note} - . . ${note} - . . ${turn} -`;

// The same offbeats with the octave taken between them. It is used once, on the C, because that is
// the bar the tune is at its brightest and the one place where four identical notes would be one
// too few.
const rollOctave = (low, high) =>
    `. . ${low} - . . ${high} - . . ${low} - . . ${high} -`;

// The drums are written as General MIDI numbers rather than note names, because the numbers are what
// the DRUM engine reads - it maps 35..81 straight onto its kit - and because a drum part in note
// names is a transliteration nobody can read. The map the line below uses:
//
//   36 kick   38 snare   39 clap   42 closed hat   46 open hat
//
// (The engine's own map is in felucca/firmware/src/eng_drum.c; 36..47 also play as those numbers'
// octave, so a GM file pasted in here keeps its meaning.)
//
// House, and nothing else: the kick on all four beats, the clap on two and four with the kick under
// it, the closed hat on the beat and the open hat on the offbeat. Seven of the eight bars are this,
// unchanged - a fill is the one thing a loop of this kind is allowed, and it is why bar 8 exists.
const FOUR_FLOOR = '36+42 . 46 . 36+39+42 . 46 . 36+42 . 46 . 36+39+42 . 46 .';

// The last bar: the same four to the floor, with the fourth beat handing the closed hat to the clap
// so the open hat and the clap land on the offbeat together and the loop announces its own repeat.
// Sixteen tokens, like every other bar - a bar of seventeen is the mistake this notation makes
// easiest, which is why compileTune() counts.
const FILL = '36+42 . 46 . 36+39+42 . 46 . 36+42 . 46 . 36+39 . 46+39 .';

// The harmony, two bars each: A minor, F, C, G - a i, VI, III and VII in A minor, the four chords a
// loop like this is built on. Two bars each rather than four chords a bar is what gives the hook its
// two-bar phrase and its two-bar answer somewhere to land, and the pair that moves to VI is what
// makes the answer sound like an answer and not a repeat.
const CHORDS = ['A3+C4+E4', 'F3+A3+C4', 'C4+E4+G4', 'G3+B3+D4'];

// The hook, first half, over A minor: up the triad to the top of the register, and the reach back
// down to where the second bar picks it up. Neither bar begins on a beat - it is a pluck line, and a
// pluck playing on the beat under a kick on the beat is two things hitting where one should.
const LEAD_HOOK = [
    '. . A4 . C5 . E5 . . . E5 . D5 . C5 .',
    '. . A4 . C5 . . . E5 . D5 . C5 . A4 .',
];

// Second half, over F: the same rise and the same descent, a step lower because the chord is, and
// ending on the whole triad rather than one note - the answer is the phrase arriving, not a new one.
const LEAD_ANSWER = [
    '. . A4 . C5 . D5 . . . D5 . C5 . A4 .',
    '. . A4 . C5 . . . D5 . C5 . A4 . A4+C5+D5 .',
];

// The hook again, over C, a third up from where it started and the brightest thing in the tune. The
// shape is the hook's exactly, which is what makes the second four bars a repeat with a change
// rather than a second tune.
const LEAD_REPRISE = [
    '. . C5 . E5 . C5 . . . E5 . D5 . C5 .',
    '. . C5 . E5 . . . A4 . C5 . E5 . C5 .',
];

// The answer again, over G, and this is the one that turns the loop over: it walks down the chord to
// the sixth and closes on B, D and E together, which is the chord's third and fifth with the sixth
// stacked on top - so the last thing heard leans up a tone, onto the note the next pass starts from.
const LEAD_TURN = [
    '. . B4 . D5 . E5 . . . D5 . B4 . A4 .',
    '. . A4 . B4 . . . D5 . B4 . A4 . B4+D5+E5 .',
];

// Held for two bars: one token of notes, thirty-one of hold. The pad is where an engine's polyphony
// and its release are heard, so it is deliberately the simplest line here - a chord a visitor can
// hear change under the hook, and nothing else.
const chordPair = (chord) => `${chord} ${'- '.repeat(31)}`.trim();

// Eight bars, in the order the loop plays them: the hook, its answer, the hook a third higher, and
// the answer that walks back to the top of the loop.
const lead = [...LEAD_HOOK, ...LEAD_ANSWER, ...LEAD_REPRISE, ...LEAD_TURN].join(' ');

// The bass, bar by bar: an offbeat figure on each chord's root, hinging up to the fifth in the
// second bar of every pair, the octave on the C, and back to the tonic at the end so the loop closes
// where it began. Written out rather than derived, because the pairs are what the line is and
// reading them as pairs is the point.
const bassBars = [
    roll('A1'), rollTo('A1', 'E2'),
    roll('F1'), rollTo('F1', 'C2'),
    roll('C2'), rollOctave('C2', 'C3'),
    roll('G1'), rollTo('G1', 'A1'),
];

// The bass, the hook, the two-bar chords, and the seven bars of four to the floor with the fill.
const bass = bassBars.join(' ');
const pad = CHORDS.map(chordPair).join(' ');
const drums = [...Array(7).fill(FOUR_FLOOR), FILL].join(' ');

// The four lines, keyed by part id. src/js/parts.js has the parts themselves - their names, their
// order and what a preset is chosen by - and src/js/tune.js fails the build if these two ever name
// different things.
export const TEXT = {
    bass,
    lead,
    pad,
    drums,
};
