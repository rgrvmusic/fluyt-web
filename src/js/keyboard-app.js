// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The keyboard page: one engine played by hand, and the note routing that keeps its three sources -
// screen, computer keys, controller - in agreement about what is sounding.
//
// There is no transport and no tune here, so the player builds only the part the keyboard plays.
// Every source of notes goes through one pair of functions, so a key held on a controller lights up
// on screen and a key clicked on screen is released by the controller's note-off. There is no
// separate notion of "the keyboard's notes" and "MIDI's notes" for the page to get out of step
// with.

import { Player } from './player.js';
import { createAuditionUI } from './audition-ui.js';
import { createKeyboard, createComputerKeyboard, DEFAULT_OCTAVE } from './keyboard.js';
import { createMidiInput } from './midi.js';
import { midiToNote } from './pattern.js';

const errorLine = document.getElementById('error');
const octaveSelect = document.getElementById('octave-select');
const midiSelect = document.getElementById('midi-input');
const midiStatus = document.getElementById('midi-status');

let player = null;
let octave = DEFAULT_OCTAVE;

// Which source is holding which note, so that releasing a note one source is holding while another
// still holds it does not cut it off. Two sources on one note is unusual but a controller and a
// computer key on the same pitch is one keypress away.
const holders = new Map();   // midi note -> a Set of source labels

function noteOn(midi, velocity, source) {
    if (!player) return;
    let set = holders.get(midi);
    if (!set) {
        set = new Set();
        holders.set(midi, set);
        player.noteOn(midi, velocity);
    }
    set.add(source);
    screen.noteOn(midi);
}

function noteOff(midi, source) {
    const set = holders.get(midi);
    if (!set) return;
    set.delete(source);
    if (set.size) return;
    holders.delete(midi);
    if (player) player.noteOff(midi);
    screen.noteOff(midi);
}

function releaseAll() {
    for (const midi of [...holders.keys()]) {
        holders.delete(midi);
        screen.noteOff(midi);
    }
    if (player) player.allNotesOff();
}

// ---- the on-screen keyboard: it is both a source and a display
const screen = createKeyboard(document.getElementById('keyboard'), {
    onNoteOn: (midi, velocity) => noteOn(midi, velocity, 'screen'),
    onNoteOff: (midi) => noteOff(midi, 'screen'),
});

// ---- the octave
for (let o = 0; o <= 8; o++) {
    const option = document.createElement('option');
    option.value = String(o);
    option.textContent = `${midiToNote(12 * (o + 1))} – ${midiToNote(12 * (o + 1) + 14)}`;
    octaveSelect.append(option);
}
octaveSelect.value = String(DEFAULT_OCTAVE);
octaveSelect.addEventListener('change', () => {
    octave = Number(octaveSelect.value);
});

createComputerKeyboard({
    onNoteOn: (midi, velocity) => noteOn(midi, velocity, 'keys'),
    onNoteOff: (midi) => noteOff(midi, 'keys'),
    onOctaveChange: (delta) => {
        // a shift mid-hold would otherwise leave the held note unreleasable, so everything is let go
        // first: the keyup that follows arrives for a note this page no longer thinks is down.
        releaseAll();
        octave = Math.max(0, Math.min(8, octave + delta));
        octaveSelect.value = String(octave);
    },
    getOctave: () => octave,
});

// ---- MIDI
async function setupMidi() {
    // Write a list of controllers into the selector, keeping the choice if it is still there.
    //
    // The list that came back with the access is written by this same function and not by some
    // second path, because there is only one kind of list: a controller that was there when the
    // page loaded and one plugged in afterwards differ in nothing the visitor can see.
    function showInputs(inputs) {
        const chosen = midiSelect.value;
        midiSelect.textContent = '';
        const none = document.createElement('option');
        none.value = '';
        none.textContent = inputs.length ? '— none —' : '— no inputs —';
        midiSelect.append(none);
        for (const input of inputs) {
            const option = document.createElement('option');
            option.value = input.id;
            option.textContent = input.name;
            midiSelect.append(option);
        }
        if (inputs.some((i) => i.id === chosen)) midiSelect.value = chosen;
        else if (inputs.length === 1) {
            midiSelect.value = inputs[0].id;
            midiSelect.dispatchEvent(new Event('change'));
        }
    }

    const midi = await createMidiInput({
        onNoteOn: (note, velocity) => noteOn(note, velocity, 'midi'),
        onNoteOff: (note) => noteOff(note, 'midi'),
        onAllNotesOff: releaseAll,
        onInputsChanged: showInputs,
    });

    if (midi.unsupported) {
        midiStatus.textContent = 'this browser has no WebMIDI';
        midiSelect.disabled = true;
        return;
    }
    if (midi.denied) {
        midiStatus.textContent = 'MIDI permission was refused';
        midiSelect.disabled = true;
        return;
    }

    midiSelect.addEventListener('change', () => {
        releaseAll();
        const name = midi.listen(midiSelect.value);
        midiStatus.textContent = name ? `listening to ${name}` : '';
    });

    // The list the module already has. onInputsChanged is only called when a controller arrives or
    // leaves, so a controller that was plugged in before the page loaded - the ordinary case, and
    // the only one on the first visit - was never written into the selector at all: the page showed
    // "—" with a working controller behind it. The listener above is attached first because this
    // render is what selects the only input there is, and selecting it is a change.
    showInputs(midi.inputs);

    // One input selects itself, and that writes the status line. Two or more say nothing yet, and
    // the selector is the list. None has nothing to say for itself.
    if (!midi.inputs.length) midiStatus.textContent = 'no controllers found — plug one in';
}

// ---- the page
async function main() {
    try {
        player = new Player({ auditionOnly: true });
        await player.init();
    } catch (err) {
        errorLine.textContent = `The engine could not be loaded: ${err.message}`;
        return;
    }

    createAuditionUI(player);

    await setupMidi();

    // A page that has been left alone with a key held should not still be sounding it when the
    // window comes back.
    window.addEventListener('blur', releaseAll);
}

main();
