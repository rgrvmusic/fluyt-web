// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// WebMIDI input, for the keyboard page only. See src/keyboard.html for why that page exists
// separately from the one that goes in the iframe.
//
// Nothing here is required for the page to work: a browser without WebMIDI, a browser that refuses
// the permission, or a machine with no controller all end in the same place - no inputs, and a page
// that still plays from its own keyboard. The failure is reported in the status line rather than
// thrown, because an auditioning page that will not start without a MIDI device would be a worse
// page than one that starts without it.

/** Note numbers 0-127, and the channel's own all-notes-off controllers. */
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const ALL_SOUND_OFF = 120;
const ALL_NOTES_OFF = 123;

/**
 * Connect to WebMIDI and report the inputs. Returns { inputs, listen, detach }.
 *
 * The list arrives twice and the caller needs both halves: `inputs` is what is connected now, and
 * `onInputsChanged` is called afterwards, whenever a controller is plugged in or unplugged. A page
 * that renders only the callback shows an empty selector beside a controller that has been sitting
 * there since before the page loaded - which is the ordinary first visit.
 *
 * `listen` is how the page says which input to play: it detaches the previous listener, so two
 * controllers chosen one after the other do not both sound.
 */
export async function createMidiInput({ onNoteOn, onNoteOff, onAllNotesOff, onInputsChanged }) {
    if (!navigator.requestMIDIAccess) {
        return { inputs: [], unsupported: true, listen() {}, detach() {} };
    }

    let access;
    try {
        access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
        return { inputs: [], denied: true, error: err, listen() {}, detach() {} };
    }

    const listeners = new Map();

    const noteMessage = (data) => {
        const status = data[0] & 0xf0;
        const note = data[1];
        const value = data[2] ?? 0;

        // A note-on with velocity 0 is a note-off. Controllers send it that way rather than as
        // 0x80, and the bridge reads it the same way, so it is treated as one here too - otherwise
        // a key released on such a controller would hang.
        if (status === NOTE_ON && value > 0) onNoteOn(note, value);
        else if (status === NOTE_OFF || status === NOTE_ON) onNoteOff(note);
        else if (status === CONTROL_CHANGE && (note === ALL_NOTES_OFF || note === ALL_SOUND_OFF)) {
            onAllNotesOff();
        }
    };

    function onMessage(event) {
        noteMessage(event.data);
    }

    function attach(input) {
        input.addEventListener('midimessage', onMessage);
        listeners.set(input.id, input);
    }

    function detachInput(input) {
        input.removeEventListener('midimessage', onMessage);
        listeners.delete(input.id);
    }

    // A controller plugged in while the page is open shows up without a reload, and one unplugged
    // stops sounding. The list is re-reported either way so the selector stays true.
    function refresh() {
        for (const input of listeners.values()) {
            if (input.state !== 'connected') detachInput(input);
        }
        onInputsChanged(list(access));
    }

    access.addEventListener('statechange', refresh);

    return {
        inputs: list(access),
        listen(id) {
            for (const input of [...listeners.values()]) {
                if (input.id !== id) detachInput(input);
            }
            const input = [...access.inputs.values()].find((i) => i.id === id);
            if (input && !listeners.has(input.id)) attach(input);
            return input ? input.name : '';
        },
        detach() {
            for (const input of [...listeners.values()]) detachInput(input);
            access.removeEventListener('statechange', refresh);
        },
    };
}

function list(access) {
    return [...access.inputs.values()].map((input) => ({
        id: input.id,
        name: input.name || input.manufacturer || 'MIDI input',
        state: input.state,
    }));
}
