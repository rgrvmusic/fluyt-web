// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The ballad: eight bars in C major at 72 BPM, four parts, written in the notation
// src/js/pattern.js documents.
//
// Like the others it is an original tune, written for this page. The shape is a
// ballad's - one chord to every two bars, a bass that holds a note rather than striking it, a melody
// of halves and wholes that rests as much as it moves, and a drum part with more room in it than
// notes - and it is deliberately the other end of the page from the others: at 72 BPM a step is
// about 208 ms, so a bar is over three seconds and the loop is a little under thirty. Nothing in it
// is fast, and the notation says so, because most of its tokens are holds.
//
// It is the tune that shows one engine three ways. All three pitched parts are on FORMANT, the voice
// engine, and the page picks a part's preset by role - by the preset's name, not by its index - so
// one engine comes out as WOW BASS below, VOX LEAD in the middle and CHOIR AAH above it: a vowel at
// the bottom, a sung line across the middle, a choir under the melody. Putting the three of them on
// the same engine is the point of the tune, and the three registers they are written in - C2..G2,
// A2..G3 and C4..A4 - are what keeps three of one engine from becoming one blurred thing.
//
// The four parts, and what each lets a visitor hear an engine do:
//
//   bass   a root held for most of a bar              - FORMANT as WOW BASS, a sung low note
//   lead   the tune, in half notes and whole notes    - FORMANT as VOX LEAD, pitch and breath
//   pad    one sustained chord every two bars         - FORMANT as CHOIR AAH, polyphony
//   drums  kick, side stick and hats, GM numbered     - the DRUM engine's own kit
//
// This file is the tune's source. What the page plays is src/tune/fluyt-ballad.mid, written from this
// by tools/tune-to-mid.mjs; src/js/tune.js explains why a tune is both, and `make midicheck` fails if
// this notation and that file are not the same tune.

export const ID = 'ballad';
export const LABEL = 'Ballad';

export const BPM = 72;
export const STEPS_PER_BAR = 16;          // sixteenth notes in 4/4, so one step is a sixteenth
export const BARS = 8;

// The file this tune is played from, relative to src/tune/. Both sides of the tree find it from here:
// the page asks the browser for SONG_URL, and the Node tools read the same url as a path - one fact,
// two readers. FILE is a plain string constant because tools/pagecheck.mjs substitutes exactly that
// shape into the url below to check the file is there.
export const FILE = 'fluyt-ballad.mid';
export const SONG_URL = new URL(`../../tune/${FILE}`, import.meta.url);

// The engines the parts start on, by slug from dist/wasm/engines.json. Three of the four are the
// same engine on purpose, which no other tune here does: FORMANT is the voice engine, and the three
// roles the page asks of it - a bass, a lead and a pad - are three different presets of it (WOW BASS,
// VOX LEAD, CHOIR AAH, matched by preset name and not by position). The kit is the DRUM engine, the
// only one of the four that is not a voice, because a ballad's kit is still a kit.
export const ENGINES = {
    bass: 'formant',
    lead: 'formant',
    pad: 'formant',
    drums: 'drum',
};

// one bar of the bass: the note on the downbeat and then nothing, because the fifteen tokens that
// follow it are holds. Sixteen tokens to the bar and fifteen of them holds is what "sustains" means
// in this notation - the note is struck once and the engine is left to sing it. A bar of fifteen or
// seventeen is the mistake this notation makes easiest, which is why compileTune() counts.
const sung = (note) => `${note} ${'- '.repeat(15)}`.trim();

// the same bar with somewhere to go in its last beat: the note held for three beats, then the second
// note on the fourth. This is the bass's only move, and it happens in the bars that lead into the
// next chord - the one thing stopping eight bars of held notes from being eight bars of one note.
const turned = (note, next) => `${note} ${'- '.repeat(11)} ${next} ${'- '.repeat(3)}`.trim();

// The bass, a bar at a time: the root, held, with the fifth as the second note on the bars that turn.
// The whole line is C2..G2 and it stays there, an octave and a half under the tune, which is where a
// ballad's bass belongs and what it means for this part to have the register to itself.
//
// A minor is the one chord whose root the register does not hold - A1 sits a minor third under the C2
// this line bottoms out at - so its two bars are stated on the two notes of that chord the register
// does reach: the fifth E2, then the third C2 under it. The pad has the full chord either way, and the
// bass moving off the tonic at all is what says the vi has arrived.
const bassBars = [
    sung('C2'), turned('C2', 'G2'),
    sung('E2'), turned('E2', 'C2'),
    sung('F2'), turned('F2', 'C2'),
    sung('G2'), turned('G2', 'D2'),
];

// The tune, a phrase to every two bars: an odd bar that moves once, from one note to another on the
// third beat, and an even bar that is a single whole note. That second bar is the phrase coming to
// rest - it is where the engine is left sustaining and where a visitor hears what the engine does
// with a note it has to hold - and the phrase after it starts on a new note, because a token after
// the note that follows takes the gate back.
//
// All four phrases end on a chord tone of the bar they are over, and the highest note in the tune is
// the A4 the first two bars reach. The last phrase is not the highest thing here: it is the dominant
// answered by the tonic, so that the loop's first bar is a resolution rather than a restart.
const LEAD_OPENING = [
    'E4 - - - - - - - G4 - - - - - - -',
    'A4 - - - - - - - - - - - - - - -',
];

// The answer: down from the A4 the opening rested on, over the minor chord, to the fifth of it. The
// A4 arrives again on the downbeat, which is the one place two phrases meet on the same note.
const LEAD_TURN = [
    'A4 - - - - - - - G4 - - - - - - -',
    'E4 - - - - - - - - - - - - - - -',
];

// The third phrase, over F: up to the tune's highest note and then down to the bottom of its range,
// both of them chord tones of the chord underneath.
const LEAD_CLIMB = [
    'F4 - - - - - - - A4 - - - - - - -',
    'C4 - - - - - - - - - - - - - - -',
];

// The last phrase: the dominant's own two notes, then the tonic, held for the bar it ends in.
const LEAD_HOME = [
    'D4 - - - - - - - G4 - - - - - - -',
    'C4 - - - - - - - - - - - - - - -',
];

const lead = [...LEAD_OPENING, ...LEAD_TURN, ...LEAD_CLIMB, ...LEAD_HOME].join(' ');

// The harmony, a chord every two bars: C, A minor, F, G - the I, vi, IV and V of C major, which is
// the four chords a ballad in C is allowed. The dominant comes last so that bar one of the loop is
// the resolution the tune's last held note is waiting for.
//
// Written as chords and not as voices, and kept in the octave under the tune (A2..G3) so that the
// three FORMANT parts do not overlap: the bass holds C2..G2, the pad holds these, the tune is above
// them both. The pad's top note is G3 and the tune's lowest is C4, so those two never meet either -
// the gap between them is what the tune has to itself, the way the octave below the pad is the bass's.
const CHORDS = ['C3+E3+G3', 'A2+C3+E3', 'A2+C3+F3', 'B2+D3+G3'];

// Held for two bars: one token of notes, thirty-one of hold. The pad is where an engine's polyphony
// and its release are heard, and in a ballad that is nearly all a pad does - the chord changes four
// times across the loop, and every time it does, it is heard under a tune that is not moving.
const chordPair = (chord) => `${chord} ${'- '.repeat(31)}`.trim();

const padBars = CHORDS.map(chordPair);

// The drums are written as General MIDI numbers rather than note names, because the numbers are what
// the DRUM engine reads - it maps 35..81 straight onto its kit - and because a drum part in note
// names is a transliteration nobody can read. The map the lines below use:
//
//   36 kick   37 side stick   42 closed hat   46 open hat
//
// (The engine's own map is in felucca/firmware/src/eng_drum.c; 36..47 also play as those numbers'
// octave, so a GM file pasted in here keeps its meaning.)
//
// One bar of it: the kick on one, a closed hat on two, the kick and the side stick on three, a
// closed hat on four. Four hits in three seconds, which is what a ballad's kit is - a mark for the
// tune to move against and no groove of its own. The stick rather than the snare, because a snare
// this slow would be the loudest thing in the tune.
const SPARSE = '36 . . . 42 . . . 36+37 . . . 42 . . .';

// The fourth bar of the first four: the same bar with its last hat opened. The open hat is the only
// thing in the kit that marks a half of the loop, and opening it on the last bar of the first four is
// what tells a visitor that the eight bars are two fours and not one long eight.
const TURN = '36 . . . 42 . . . 36+37 . . . 46 . . .';

// The last bar of the loop: the downbeat, and then nothing. The tune's last note and the pad's last
// chord are both still sounding through it, so the bar is the tune breathing out rather than
// stopping, and the loop starts again on a bar the kit has already been through once.
const REST = '36 . . . . . . . . . . . . . . .';

// The seven bars of the kit and the bar it rests in.
const drumBars = [...Array(3).fill(SPARSE), TURN, ...Array(3).fill(SPARSE), REST];

// The four lines, keyed by part id. src/js/parts.js has the parts themselves - their names, their
// order and what a preset is chosen by - and src/js/tune.js fails the build if these two ever name
// different things.
export const TEXT = {
    bass: bassBars.join(' '),
    lead,
    pad: padBars.join(' '),
    drums: drumBars.join(' '),
};
