// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The bossa nova: eight bars in D minor at 96 BPM, four parts, written in the notation
// src/js/pattern.js documents.
//
// Like the others it is an original tune, written for this page. The shape is a bossa's, and nearly
// all of that shape is in where the notes are not. The harmony is four chords and the kit is one
// two-bar figure repeated, so nothing here is carried by the notes themselves: what makes it a bossa
// is that almost nothing lands on a beat. The bass takes the root on the downbeat and the fifth on
// the "and of two" - the two-feel the whole style is built on - the kit marks two and four with a
// side stick rather than a snare, and the melody never lands on a beat at all: every note in it is an
// offbeat eighth, so each phrase is already leaning into the bar after it.
//
// The four parts, and what each lets a visitor hear an engine do:
//
//   bass   the two-feel, root and fifth, short notes   - ANALOG as SQR BASS, low end and punch
//   lead   the tune, syncopated, short notes and dyads - FM6 as PLUCK, pitch and a fast decay
//   pad    one sustained chord every two bars          - ANALOG as SOFT PAD, polyphony and release
//   drums  side stick, kick and hats, GM numbered      - the DRUM engine's own kit
//
// The two ANALOG parts are the one engine this tune shows twice, at its two ends: the square-wave
// bass holds the bottom (D2 up to E3) and the soft pad sits an octave above the bass's root, so a
// visitor hears one engine as a rhythm instrument and as a chord at the same time. The tune between
// them is FM6, whose PLUCK preset has no sustain at all - every note here decays the moment it is
// struck - which is why the lead is written as short notes with the rests in it that a singer would
// breathe in, and not as the held line a sustain would invite.
//
// This file is the tune's source. What the page plays is src/tune/fluyt-bossa.mid, written from this
// by tools/tune-to-mid.mjs; src/js/tune.js explains why a tune is both, and `make midicheck` fails if
// this notation and that file are not the same tune.

export const ID = 'bossa';
export const LABEL = 'Bossa nova';

export const BPM = 96;
export const STEPS_PER_BAR = 16;          // sixteenth notes in 4/4, so one step is a sixteenth
export const BARS = 8;

// The file this tune is played from, relative to src/tune/. Both sides of the tree find it from here:
// the page asks the browser for SONG_URL, and the Node tools read the same url as a path - one fact,
// two readers. FILE is a plain string constant because tools/pagecheck.mjs substitutes exactly that
// shape into the url below to check the file is there.
export const FILE = 'fluyt-bossa.mid';
export const SONG_URL = new URL(`../../tune/${FILE}`, import.meta.url);

// The engines the parts start on, by slug from dist/wasm/engines.json. The page picks a part's preset
// by role - by the preset's name and not by its index - so these four land on four named sounds:
// ANALOG's SQR BASS under an ANALOG SOFT PAD, FM6's PLUCK in between them, and the DRUM engine's DRUM
// KIT. Two parts on one engine is deliberate: a bossa's bass and its pad are both background, and
// hearing the same engine be a struck note in one part and a sustained chord in the other is the
// clearest thing this tune shows.
export const ENGINES = {
    bass: 'analog',
    lead: 'fm6',
    pad: 'analog',
    drums: 'drum',
};

// one bar of the bossa two-feel: the root on the downbeat and the fifth on the "and of two", each a
// sixteenth of sound with a hold under it, the rest of the bar silent. Two notes a bar is what the
// style is built on - the root says what the chord is, the fifth, arriving half a beat off the
// second, is what stops the bass from sounding like a metronome - and the rests are as much of the
// pattern as the notes are. The fifth sits on the seventh token of the bar, which is where a bossa
// bass puts it.
const twoFeel = (root, fifth) =>
    `${root} - . . . . ${fifth} - . . . . . . . .`;

// the same bar with a third note on the "and of four", the last eighth before the barline. On the bars
// that lead to a new chord the third note is that chord's root, so the harmony arrives half a beat
// early and the change is heard as an arrival rather than as a bump; on the last bar it is the tonic,
// handing the loop back to its own first beat.
const twoFeelOn = (root, fifth, next) =>
    `${root} - . . . . ${fifth} - . . . . . . ${next} .`;

// The harmony, two bars each: D minor, G minor, A, D minor - the i, iv, V and i of D minor, which is
// the progression a bossa in D is built on, and the same four chords in the same order twice over is
// what lets the phrase and its answer be heard as two halves of eight bars rather than as four
// unrelated twos. The A is written major - C sharp and not C natural - because as the fifth of the
// key it is a dominant here, and the C sharp is the one note in the tune that says the key is minor
// rather than merely a scale with a flat third in it.
const CHORDS = ['D3+F3+A3', 'G3+Bb3+D4', 'A3+C#4+E4', 'D3+F3+A3'];

// Held for two bars: one token of notes, thirty-one of hold. The pad is where an engine's polyphony
// and its release are heard, and a bossa leaves it alone - the chord changes four times across the
// loop and does nothing else, because every part above it is syncopated and a pad that moved would
// be a fifth thing to listen to.
const chordPair = (chord) => `${chord} ${'- '.repeat(31)}`.trim();

// The drums are written as General MIDI numbers rather than note names, because the numbers are what
// the DRUM engine reads - it maps 35..81 straight onto its kit - and because a drum part in note
// names is a transliteration nobody can read. The map the lines below use:
//
//   36 kick   37 side stick   42 closed hat   46 open hat
//
// (The engine's own map is in felucca/firmware/src/eng_drum.c; 36..47 also play as those numbers'
// octave, so a GM file pasted here keeps its meaning.)
//
// The stick and not the snare on two and four. A bossa is quiet and fast, and a snare hit that often
// would be the loudest thing in a tune whose whole point is that it is not loud; the rim click marks
// the backbeat and stays out of the way of the melody.
//
// The first bar of the two-bar figure: the kick and a hat together on one, the stick on two, the kick
// again on the "and of three" and the stick on four, with hats on the "and" of one, the "and" of two,
// the "a" of three and the "and" of four. Nine hits in a bar, and eight of the bar's sixteen steps
// have nothing on them at all - which is a bossa kit: the hats are a syncopation and not a pulse, and
// the stick and the kick are what a listener counts the bar by.
const FIGURE_A = '36+42 . 42 . 37 . 42 . . . 36 42 37 . 42 .';

// The second bar of the figure: the same marks in the same places, with one hat moved - the "a" of
// three becomes the "e" of three, two sixteenths earlier - so the two bars are one figure heard twice
// rather than one bar heard twice, which is what the pair is for. The kick, the stick and the two and
// four underneath them do not change.
const FIGURE_B = '36+42 . 42 . 37 . 42 . . 42 36 . 37 . 42 .';

// The last bar of the loop: the second figure with its last hat opened and a kick under it, so the
// rim click on four is answered by the kit rather than by silence and the loop comes back around on a
// bar that has already turned over once. Sixteen tokens, like every other bar - a bar of seventeen is
// the mistake this notation makes easiest, and this tune's parts are mostly rests, which is where it
// happens - so every bar here is written out in full and compileTune() counts them.
const FILL = '36+42 . 42 . 37 . 42 . . 42 36 . 37 . 36+46 .';

// The tune, eight bars: a two-bar phrase, a two-bar answer, and the pair again. Nothing in the line
// starts on a beat. Every note is on an eighth, and every one of those eighths is an offbeat - the
// "and" of one, two, three or four - so it never sits on a kit that is marking two and four, and the
// bar's accents come from the bass and the stick underneath it rather than from the voice.
//
// The phrase, over D minor: up through the ninth, the fifth and the root, and a turn to the eleventh
// that is already pointing at the next bar, then down to the fifth and a breath. The answer starts
// the same way over G minor, reaches the same root, and comes down by the third to the eleventh
// instead - so the pair ends on the note the phrase went up to rather than the one it started on,
// which is how a sung line closes.
//
// The landing of each half is the one place the lead is more than one note, and it arrives late
// rather than on the beat, the way a guitar would put the chord under a voice: the phrase's fifth
// with the root over it, the answer's third with the fifth over it. That first dyad is the outer two
// notes of the tonic and a suspension over the dominant, which is the one note in the tune that is
// waiting for the bar after it - a bossa's dominant is a sus chord more often than not. Eight bars
// play the pair twice, so both dyads are written to sit on two chords: every other note here is a
// tone of Dm7 and of A7 at once, or of Gm7 and of Dm7, and only the harmony under them changes.
const LEAD_PHRASE = [
    '. . E4 . . . A4 . . . D5 - . . G4 .',
    '. . A4+D5 - . . . . . . . . . . D4 .',
];

const LEAD_ANSWER = [
    '. . G4 . . . A4 . . . D5 - . . C5 .',
    '. . A4 - . . F4+A4 - . . . . . . G4 .',
];

const lead = [...LEAD_PHRASE, ...LEAD_ANSWER, ...LEAD_PHRASE, ...LEAD_ANSWER].join(' ');

// The bass, a bar at a time: the two-feel on the chords that stand, and the two-feel with the next
// chord's root on the "and of four" on the bars that turn. The last bar turns back onto the tonic, so
// the loop has no bar in it that is not already moving somewhere - which is the whole of what a bossa
// bass does, and the reason the line is written out bar by bar rather than derived.
//
// The fifth is written in the octave that keeps the two-feel in the register of the engine: D2 and
// A2, then G2 and D3 above it as the harmony walks up to A and back down, so the bass moves with the
// chords instead of sitting under all four of them in the same place.
const bassBars = [
    twoFeel('D2', 'A2'), twoFeelOn('D2', 'A2', 'G2'),
    twoFeel('G2', 'D3'), twoFeelOn('G2', 'D3', 'A2'),
    twoFeel('A2', 'E3'), twoFeelOn('A2', 'E3', 'D2'),
    twoFeel('D2', 'A2'), twoFeelOn('D2', 'A2', 'D2'),
];

// One pair a chord - four chords, two bars each, which is the whole eight.
const padBars = CHORDS.map(chordPair);

// The two-bar figure three times, and the bar that turns it over.
const drumBars = [
    FIGURE_A, FIGURE_B, FIGURE_A, FIGURE_B, FIGURE_A, FIGURE_B, FIGURE_A, FILL,
];

// The four lines, keyed by part id. src/js/parts.js has the parts themselves - their names, their
// order and what a preset is chosen by - and src/js/tune.js fails the build if these two ever name
// different things.
export const TEXT = {
    bass: bassBars.join(' '),
    lead,
    pad: padBars.join(' '),
    drums: drumBars.join(' '),
};
