// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// Writing a Standard MIDI File, which is the other half of src/js/smf.js. The page only ever reads
// one - it plays the tune in src/tune/, and a visitor brings nothing - so this is a tool: what
// writes that file from the notation, and what builds the fixtures tools/midicheck.mjs reads back.
// It is not in src/ because the page would then carry a MIDI writer it never calls.
//
// The one thing worth knowing about the format from this side: a track is a list of events, each
// with the time since the last one rather than an absolute time. So the track has to be in order
// before it is written, and the delta times fall out of the difference. Two events at the same tick
// are written in the order they were sorted in, which is how a note-off ends up before the note-on
// that repeats it - the order src/worklet/fluyt-worklet.js applies them in.

/** A variable-length quantity: seven bits a byte, high bit set on all but the last. */
export function vlq(value) {
    const out = [value & 0x7f];
    let rest = value >> 7;
    while (rest > 0) {
        out.unshift((rest & 0x7f) | 0x80);
        rest >>= 7;
    }
    return out;
}

const chunk = (id, body) => [
    ...id,
    (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff,
    (body.length >>> 8) & 0xff, body.length & 0xff,
    ...body,
];

/** A meta event, which is 0xFF, a type, a length and that many bytes. */
const meta = (type, bytes) => [0xff, type, ...vlq(bytes.length), ...bytes];

const ascii = (string) => [...string].map((c) => c.charCodeAt(0) & 0x7f);

/**
 * One track chunk from its events.
 *
 * An event is `{ tick, order, bytes }`. `order` breaks ties at the same tick and nothing else does:
 * the sort is stable, so events that share a tick keep the order they were given in, and a caller
 * that cares - a note-off before the note-on on the same frame - controls it with that number.
 * Every track ends with the end-of-track meta event, which is not optional.
 */
export function trackChunk(events) {
    const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
    const body = [];
    let at = 0;
    for (const event of sorted) {
        body.push(...vlq(event.tick - at), ...event.bytes);
        at = event.tick;
    }
    body.push(...vlq(0), ...meta(0x2f, []));
    return chunk([0x4d, 0x54, 0x72, 0x6b], body);   // 'MTrk'
}

/**
 * A whole file: a header, then one track per entry.
 *
 *   format   1 for a track per part, 0 for everything on one track (which then has to be separated
 *            by channel, and which is what a phone app exports)
 *   division ticks per quarter note. 480 puts a sixteenth on 120, so every grid in
 *            src/js/smf.js divides it exactly.
 *   bpm      the tempo written into the file. Null writes none, which is a file that leaves the
 *            reader to assume the standard 120.
 */
export function buildMidi({ format = 1, division = 480, bpm = 120, tracks }) {
    if (format === 0 && tracks.length !== 1) {
        throw new Error('format 0 is one track, with the parts told apart by their channel');
    }

    // Format 1 keeps the tempo in a track of its own, which is what a sequencer writes; format 0
    // has one track and the tempo goes at the head of it.
    const list = format === 0 ? [tracks[0]] : [{ name: 'Tempo', events: [] }, ...tracks];
    const chunks = [];

    for (const [index, track] of list.entries()) {
        const events = [];
        if (track.name) events.push({ tick: 0, order: -2, bytes: meta(0x03, ascii(track.name)) });
        if (index === 0 && bpm) {
            const us = Math.round(60000000 / bpm);
            events.push({ tick: 0, order: -1, bytes: meta(0x51, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]) });
        }
        events.push(...(track.events || []));
        chunks.push(...trackChunk(events));
    }

    const count = list.length;
    return Uint8Array.from([
        ...chunk([0x4d, 0x54, 0x68, 0x64], [                    // 'MThd'
            0x00, format, (count >> 8) & 0xff, count & 0xff,
            (division >> 8) & 0xff, division & 0xff,
        ]),
        ...chunks,
    ]);
}

/**
 * Notes -> the events that play them.
 *
 * `end` of null means the note is never released, which is a DAW's way of writing a note held past
 * the end of the file; src/js/smf.js puts one on the wrap step, so it is written the same way here
 * as one that is released at the end. Velocity 100 and a note-off rather than a note-on at velocity
 * 0, because this file is read by this page and by people.
 */
export function noteEvents(notes, { channel = 0, velocity = 100 } = {}) {
    const events = [];
    for (const note of notes) {
        events.push({ tick: note.start, order: 1, bytes: [0x90 | channel, note.note, velocity] });
        if (note.end !== null) {
            events.push({ tick: note.end, order: 0, bytes: [0x80 | channel, note.note, 64] });
        }
    }
    return events;
}
