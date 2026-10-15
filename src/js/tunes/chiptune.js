// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The chiptune: eight bars in E minor at 150 BPM, four parts, written in the notation
// src/js/pattern.js documents.
//
// Like the others it is an original tune, written for this page. The shape is a chiptune's - every
// part is sixteenth notes, the bass is a stream rather than a pulse, the lead is a run of broken
// chords that only stops where a phrase does, and the chords sit under both unchanged - and it is
// deliberately the fastest tune here: where the shanty pushes and the synthpop loop repeats, this one
// runs. Nothing in it is a quotation of a game tune or of any other chiptune; it is sixteen steps to
// the bar in E minor and no more.
//
// Its engines are its own combination - TRIO for the bass, LOFI for the lead, TRIO for the chords,
// DRUM for the kit - and no other tune here pairs them this way, so choosing it changes the sound and
// not only the notes, which is the point of the picker.
//
// The four parts, and what each lets a visitor hear an engine do:
//
//   bass   sixteenth notes on the root, with the octave jumped  - the engine's low end, at speed
//   lead   runs and broken chords, D4 up to E5                  - pitch and brightness
//   pad    one sustained chord every two bars                   - polyphony, and how it decays
//   drums  kick, snare and hats, General MIDI numbered          - the DRUM engine's own kit
//
// This file is the tune's source. What the page plays is src/tune/fluyt-chiptune.mid, written from
// this by tools/tune-to-mid.mjs; src/js/tune.js explains why a tune is both, and `make midicheck`
// fails if this notation and that file are not the same tune.

export const ID = 'chiptune';
export const LABEL = 'Chiptune';

export const BPM = 150;
export const STEPS_PER_BAR = 16;          // sixteenth notes in 4/4, so one step is a sixteenth
export const BARS = 8;

// The file this tune is played from, relative to src/tune/. Both sides of the tree find it from here:
// the page asks the browser for SONG_URL, and the Node tools read the same url as a path - one fact,
// two readers. FILE is a plain string constant because tools/pagecheck.mjs substitutes exactly that
// shape into the url below to check the file is there.
export const FILE = 'fluyt-chiptune.mid';
export const SONG_URL = new URL(`../../tune/${FILE}`, import.meta.url);

// The engines the parts start on, by slug from dist/wasm/engines.json. The bass and the chords are
// both TRIO here, and that is deliberate rather than lazy: a chip tune is one box making all of its
// sounds, so two parts sharing an engine is the genre rather than a shortage of engines. Each still
// lands on a different preset of it, because the page picks a preset by role rather than by index -
// TRIO's FAT BASS for the bass and TRIO's CHIP CHOIR for the chords - so the two do not sound alike.
// The lead is on LOFI, which lands on WAVE LEAD, and the kit on DRUM, which is its own kit.
export const ENGINES = {
    bass: 'trio',
    lead: 'lofi',
    pad: 'trio',
    drums: 'drum',
};

// one bar of sixteenths on one note with the octave jumped: two hits on the root, the octave between
// the second and the third, repeated four times. This is the whole reason the tune is a chiptune and
// not the other two - a bass that plays every sixteenth is a stream, not a pulse, and the octave jump
// is what stops a stream from being a drone. Written as two lines of eight so the shape is visible in
// the source and not only in the sound.
const jump = (low, high) =>
    `${low} ${low} ${high} ${low} ${low} ${low} ${high} ${low} ` +
    `${low} ${low} ${high} ${low} ${low} ${low} ${high} ${low}`;

// the same bar as a plain two-note alternation, root and octave turn and turn about. It is what the
// bars where the chord is not the root use, so the bass keeps moving where the harmony does without
// every bar of the loop being the same figure.
const alternate = (low, high) =>
    `${low} ${high} ${low} ${high} ${low} ${high} ${low} ${high} ` +
    `${low} ${high} ${low} ${high} ${low} ${high} ${low} ${high}`;

// The drums are written as General MIDI numbers rather than note names, because the numbers are what
// the DRUM engine reads - it maps 35..81 straight onto its kit - and because a drum part in note
// names is a transliteration nobody can read. The map the lines below use:
//
//   36 kick   38 snare   42 closed hat   46 open hat   49 crash
//
// (The engine's own map is in felucca/firmware/src/eng_drum.c; 36..47 also play as those numbers'
// octave, so a GM file pasted in here keeps its meaning.)
//
// The chip kit: kick on one and three, snare on two and four, and a closed hat on every sixteenth,
// with the open hat left ringing on the offbeat of two and of four. Sixteen hats to the bar is the
// chip machine's own habit - it has one hat and no taste about when to stop - and it is the one thing
// here that is faster than the other tunes' kits.
const CHIP = '36+42 42 42 42 38+42 42 46 42 36+42 42 42 42 38+42 42 46 42';

// The top of the loop: the same bar with a crash on the very first step, so a repeat announces
// itself rather than sneaking in. It is the only change the first bar makes, which is what keeps it a
// crash and not a second pattern.
const CRASH = '49+36+42 42 42 42 38+42 42 46 42 36+42 42 42 42 38+42 42 46 42';

// A bar with an extra kick on the last sixteenth of three, the one variation a chip kit is given. It
// is used twice in the loop, which is often enough to be heard as a change and seldom enough not to
// become the pattern.
const DOUBLE = '36+42 42 42 42 38+42 42 46 42 36+42 42 42 36+42 38+42 42 46 42';

// The last bar: the hats stop at the halfway mark and the snares take the rest of the bar, closing on
// a kick and a snare together. Sixteen tokens, like every other bar - a bar of seventeen is the
// mistake this notation makes easiest, which is why compileTune() counts.
const FILL = '36+42 42 42 42 38+42 42 42 42 36+42 38 46 38 38+42 38 38 36+38';

// The harmony, two bars each: E minor, C, G, D - a i, VI, III and VII in E minor, the four chords an
// eight-bar chip loop is allowed. Two bars each is what lets the lead state a phrase and answer it
// over different chords, so the loop is heard as a repeat rather than as eight bars of one thing.
const CHORDS = ['E3+G3+B3', 'C3+E3+G3', 'G3+B3+D4', 'D3+F#3+A3'];

// The lead, eight bars of it, in four phrases of two. It is written out bar by bar because it is the
// line most likely to be edited, and the run is the point.
//
// The first phrase: the Em broken chord climbed from the root to E5 and answered with the same shape
// an octave's reach lower, ending on the fifth. The second phrase is the C arpeggio, which is the
// same figure a third down and starts on the chord's own root so the change of chord is heard as a
// change of key and not only of notes.
const LEAD_OPEN = [
    'E4 G4 B4 E5 B4 G4 E4 G4 F#4 A4 B4 A4 G4 F#4 E4 .',
    'E4 B4 E5 - D5 B4 G4 B4 E5 - D5 B4 A4 G4 . .',
];

const LEAD_RISE = [
    'C4 E4 G4 C5 G4 E4 G4 C5 B4 G4 E4 G4 C4 E4 G4 .',
    'E4 G4 C5 - B4 G4 E4 G4 A4 B4 A4 G4 E4 . . .',
];

// The third phrase is the G chord taken the same way, but the run turns on the fifth of the bar
// instead of the third, so the two halves of the tune are not the same two bars twice.
const LEAD_CLIMB = [
    'G4 B4 D5 B4 G4 D4 G4 B4 D5 B4 A4 G4 A4 B4 A4 G4',
    'D5 - B4 D5 G4 B4 D5 E5 D5 B4 A4 G4 F#4 E4 . .',
];

// The fourth phrase is the D chord, and it is where the tune comes home: the broken chord first, then
// a plain run down the scale of E minor - D, C, B, A, G, F#, E - and back up the tonic triad onto the
// rest the loop begins again from. Its second bar is also where the lead breathes: as in the other
// three phrases, the run stops for a hold or two before the next phrase starts.
const LEAD_HOME = [
    'D4 F#4 A4 D5 F#4 A4 D5 F#4 E5 D5 A4 F#4 D5 A4 F#4 D4',
    'E5 D5 C5 B4 A4 G4 F#4 E4 G4 B4 E5 - D5 B4 G4 .',
];

const lead = [...LEAD_OPEN, ...LEAD_RISE, ...LEAD_CLIMB, ...LEAD_HOME].join(' ');

// Held for two bars: one token of notes, thirty-one of hold. The pad is where an engine's polyphony
// and its release are heard, so it is deliberately the simplest line here - a chord a visitor can
// hear change under a lead that never stops, and nothing else.
const chordPair = (chord) => `${chord} ${'- '.repeat(31)}`.trim();

// The bass, bar by bar, following the chords: the root with the octave jumped on the two bars of E
// minor, a plain root-and-octave alternation where the harmony moves, and a last bar that walks down
// D, C, B and steps back up to the E the loop returns to. Written out rather than derived, because
// the bars differ and reading them as lines is the point.
const bassBars = [
    jump('E1', 'E2'), jump('E1', 'E2'),
    jump('C2', 'C3'), alternate('C2', 'C3'),
    jump('G1', 'G2'), jump('G1', 'G2'),
    alternate('D2', 'D3'), 'D2 D3 D2 D3 C2 C3 C2 C3 B1 B2 B1 B2 D2 D2 E2 E2',
];

// One pair a chord - four chords, two bars each, which is the whole eight. The pad changes four times
// across the loop, and each phrase of the lead has somewhere to go when it does.
const padBars = CHORDS.map(chordPair);

// Crash, chip, chip, a kick with the last sixteenth of three, and the same again, and the fill.
const drumBars = [CRASH, CHIP, CHIP, DOUBLE, CHIP, CHIP, DOUBLE, FILL];

// The four lines, keyed by part id. src/js/parts.js has the parts themselves - their names, their
// order and what a preset is chosen by - and src/js/tune.js fails the build if these two ever name
// different things.
export const TEXT = {
    bass: bassBars.join(' '),
    lead,
    pad: padBars.join(' '),
    drums: drumBars.join(' '),
};
