// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// An on-screen keyboard, a computer keyboard, and the note plumbing that keeps them in agreement.
//
// The screen is drawn from the same note numbers the computer keys produce, so the two cannot
// disagree about which key is which note - the drawing is not a second table of key positions, it
// is a view of this one.

// The two rows of a QWERTY keyboard, in the shape a piano has. The offsets are semitones above the
// lower row's C: the Z row is a white-key run with the black keys on S, D, G, H, J - which is where
// they physically sit - and the Q row is the same an octave up.
//
// The computer keyboard is a keyboard, not a piano: there is no black key between E and F or B and
// C on a screen either, so the letters that would be there are simply not mapped.
const LOWER_ROW = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
    KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14,
};

const UPPER_ROW = {
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18,
    KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26,
};

// The MIDI note the on-screen keyboard starts at when the page loads, and the range it draws.
// C2 to C5 covers every part of the tune with room either side; the DRUM engine's kit sits at
// 36-46, which is inside it, so the drum hits are reachable from the screen too.
export const KEYBOARD_LOW = 36;
export const KEYBOARD_HIGH = 84;
export const DEFAULT_OCTAVE = 4;   // the octave the Z row plays from, so Z is C4 = 60

const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);

function isBlack(midi) {
    return BLACK_SEMITONES.has(((midi % 12) + 12) % 12);
}

/**
 * The on-screen keyboard. Returns an object with `noteOn`/`noteOff` for anything else that knows a
 * note number - the computer keyboard, a MIDI controller - so that a key pressed on a controller
 * lights up on screen and a key clicked on screen sounds.
 */
export function createKeyboard(container, { onNoteOn, onNoteOff }) {
    const keyElements = new Map();
    const down = new Set();

    // White keys are placed one after another at an even width; black keys are positioned at the
    // boundary between the two whites they sit between, which is what makes the layout hold at any
    // width without measuring anything.
    const whites = [];
    for (let midi = KEYBOARD_LOW; midi <= KEYBOARD_HIGH; midi++) {
        if (!isBlack(midi)) whites.push(midi);
    }

    const whiteWidth = 100 / whites.length;

    whites.forEach((midi, index) => {
        const el = document.createElement('div');
        el.className = 'key white';
        el.style.left = `${index * whiteWidth}%`;
        el.style.width = `${whiteWidth}%`;
        container.append(el);
        keyElements.set(midi, el);
    });

    for (let midi = KEYBOARD_LOW; midi <= KEYBOARD_HIGH; midi++) {
        if (!isBlack(midi)) continue;
        // the black key sits on the boundary between the white below it and the next white up
        const whitesBelow = whites.filter((w) => w < midi).length;
        const el = document.createElement('div');
        el.className = 'key black';
        el.style.left = `${whitesBelow * whiteWidth - whiteWidth * 0.3}%`;
        el.style.width = `${whiteWidth * 0.6}%`;
        container.append(el);
        keyElements.set(midi, el);
    }

    function press(midi, fromUser) {
        const el = keyElements.get(midi);
        if (el) el.classList.add('down');
        if (fromUser && !down.has(midi)) {
            down.add(midi);
            onNoteOn(midi, 100);
        }
    }

    function release(midi, fromUser) {
        const el = keyElements.get(midi);
        if (el) el.classList.remove('down');
        if (fromUser && down.has(midi)) {
            down.delete(midi);
            onNoteOff(midi);
        }
    }

    // Pointer events cover mouse, touch and pen in one path, and setPointerCapture is what lets a
    // finger slide from one key to the next without the first key sticking down.
    let pointerNote = null;

    function noteAt(target) {
        for (const [midi, el] of keyElements) {
            if (el === target) return midi;
        }
        return null;
    }

    container.addEventListener('pointerdown', (event) => {
        const midi = noteAt(event.target);
        if (midi === null) return;
        event.preventDefault();
        container.setPointerCapture(event.pointerId);
        pointerNote = midi;
        press(midi, true);
    });

    container.addEventListener('pointermove', (event) => {
        if (pointerNote === null) return;
        const midi = noteAt(document.elementFromPoint(event.clientX, event.clientY));
        if (midi === null || midi === pointerNote) return;
        release(pointerNote, true);
        pointerNote = midi;
        press(midi, true);
    });

    function endPointer() {
        if (pointerNote === null) return;
        release(pointerNote, true);
        pointerNote = null;
    }

    container.addEventListener('pointerup', endPointer);
    container.addEventListener('pointercancel', endPointer);

    return {
        /** Light a key without sounding it, for a note that came from somewhere else. */
        highlight(midi, on) {
            const el = keyElements.get(midi);
            if (el) el.classList.toggle('down', on);
        },
        /** Everything up, for a blur or a lost controller. */
        releaseAll() {
            for (const midi of [...down]) release(midi, true);
        },
        noteOn: (midi) => press(midi, false),
        noteOff: (midi) => release(midi, false),
    };
}

/**
 * The computer keyboard, as a source of notes. Returns a `detach`.
 *
 * Keys are tracked by `event.code`, which is the physical key rather than the character it produces
 * - so the Z row is the Z row on a layout where Z is somewhere else, and the mapping does not
 * change when a modifier is held.
 */
export function createComputerKeyboard({ onNoteOn, onNoteOff, onOctaveChange, getOctave }) {
    const held = new Map();   // code -> the note it started, so a change of octave mid-hold is safe

    function noteFor(code) {
        const offset = LOWER_ROW[code] ?? UPPER_ROW[code];
        if (offset === undefined) return null;
        // middle C is 60, so C in octave n is 12 * (n + 1): octave 4 -> Z is C4 -> 60
        const midi = 12 * (getOctave() + 1) + offset;
        return midi >= 0 && midi <= 127 ? midi : null;
    }

    function onKeyDown(event) {
        if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

        // the octave shift, and nothing else, is a modifier-free arrow
        if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
            event.preventDefault();
            onOctaveChange(event.code === 'ArrowRight' ? 1 : -1);
            return;
        }

        const midi = noteFor(event.code);
        if (midi === null) return;
        event.preventDefault();
        if (held.has(event.code)) return;
        held.set(event.code, midi);
        onNoteOn(midi, 100);
    }

    function onKeyUp(event) {
        const midi = held.get(event.code);
        if (midi === undefined) return;
        held.delete(event.code);
        onNoteOff(midi);
    }

    // A key held while the window loses focus never gets its keyup, and would hang. A blurred
    // window is not playing.
    function onBlur() {
        for (const midi of held.values()) onNoteOff(midi);
        held.clear();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return {
        detach() {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
            onBlur();
        },
    };
}
