// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The tune is a Standard MIDI File - src/tune/fluyt-tune.mid, written by tools/tune-to-mid.mjs - and
// this is what reads one. It is named smf.js and not midi.js because src/js/midi.js is already the
// WebMIDI *input*, which is a different thing that happens to share a word.
//
// A MIDI file is a header and a list of tracks, each a list of (delta time, event) pairs. What this
// reads is the note events in it; what it does with them is turn them into the two arrays the worklet
// takes - which notes open on a step, and which close - so that a file written in a DAW reaches the
// engines by the same path the notation in src/js/tune.js describes.
//
// ---------------------------------------------------------------------------------------------
// The grid, which is the one real decision in here
//
// The page's transport counts steps, and a step is a fixed number of frames, so a MIDI file's ticks
// have to land on steps. A sixteenth is what a step is when the notation is the source, but a file
// that is not on sixteenths would then have its notes moved - a triplet figure snapped into
// straight time is a different rhythm, not a rounding error.
//
// So the grid is chosen from the file rather than assumed. The candidates are the divisions a bar
// actually gets played in - 12, 16, 24, 32, 48, 96 steps - and the coarsest one that divides every
// onset and every release in the file wins:
//
//   12   8th-note triplets        16   sixteenths              24   16th-note triplets
//   32   thirty-seconds           48   32nd-note triplets     96   sixty-fourths
//
// A file of straight sixteenths gets 16 steps to the bar and is bit-exact; a file of 16th-note
// triplets gets 24 and is equally exact; a file with both in it gets 48, because that is the first
// grid both fit on. Only a file that no grid in the list divides - one with a note between two
// ticks of every one of them - falls back to sixteenths, and then the number of notes moved and the
// furthest one moved are reported rather than hidden. `stepsPerBar` and `grid` in the result say
// which of the six it was, and `snapped` is 0 for every file that did not have to be quantised.
//
// The grid is musical, not temporal: it is ticks per step, not seconds. A tempo change therefore
// does not move a note - it only means the page, whose clock is one tempo, plays the loop at the
// file's first tempo throughout. `bpm` is that tempo and `tempoChanges` counts the others.

const HEADER_ID = 0x4d546864;   // 'MThd'
const TRACK_ID = 0x4d54726b;    // 'MTrk'

// The grids, coarsest first, which is the order they are tried in. `name` is for the page to say out
// loud which one it chose, and steps per bar is the thing itself.
const GRIDS = [
    { stepsPerBar: 12, name: '8th-note triplets' },
    { stepsPerBar: 16, name: 'sixteenths' },
    { stepsPerBar: 24, name: '16th-note triplets' },
    { stepsPerBar: 32, name: 'thirty-seconds' },
    { stepsPerBar: 48, name: '32nd-note triplets' },
    { stepsPerBar: 96, name: 'sixty-fourths' },
];

// A track is matched to a part by its name where it has one. The part's own id and label are tried
// first, so a track called "Bass" or "Bassline" is the bass part without this list being consulted;
// the words here are the other things a DAW's track is likely to be called.
const ROLE_WORDS = {
    bass: ['bass'],
    lead: ['lead', 'melody', 'solo'],
    pad: ['pad', 'chord', 'string'],
    drum: ['drum', 'kit', 'perc'],
};

// General MIDI puts percussion on channel 10, which is index 9 here. A file that follows that gets
// its drum track on the drums part whatever order its tracks are in.
const PERCUSSION_CHANNEL = 9;

/** Latin-1, which is what a MIDI name is: one byte per character, and no encoding to get wrong. */
function text(bytes) {
    let out = '';
    for (const b of bytes) out += String.fromCharCode(b);
    return out;
}

/**
 * One track's events. `end` is where the chunk ends rather than where the file does, so a truncated
 * file is a wrong note count rather than a loop that never finishes.
 *
 * A note-on with a velocity of 0 is a note-off: that is the running-status trick every sequencer
 * uses, and a reader that misses it hears the whole track as one long chord.
 */
function readTrack(data, from, length) {
    const end = Math.min(from + length, data.length);
    let pos = from;
    let tick = 0;
    let status = 0;
    let name = '';

    const open = new Map();     // channel:note -> the ticks of the note-ons still waiting for an off
    const notes = [];
    const tempos = [];
    let dropped = 0;            // note-offs that matched nothing, and notes with no length
    let lastTick = 0;

    const u8 = () => data[pos++];
    const u16 = () => { const v = (data[pos] << 8) | data[pos + 1]; pos += 2; return v; };
    const vlq = () => {
        let value = 0;
        for (let i = 0; i < 4; i++) {
            const b = u8();
            value = (value << 7) | (b & 0x7f);
            if (!(b & 0x80)) return value;
        }
        throw new Error('a delta time longer than four bytes - the track is not readable');
    };
    const skip = (n) => { pos += n; };

    const key = (channel, note) => channel * 128 + note;

    while (pos < end) {
        tick += vlq();
        lastTick = Math.max(lastTick, tick);

        // a status byte, or the running status of the last one. 0x80 and up is a status byte; below
        // it, the byte already read is this event's first data byte and pos must not move past it.
        const byte = data[pos];
        if (byte & 0x80) { status = byte; pos++; } else if (!status) {
            throw new Error(`a data byte with no status byte before it, at tick ${tick}`);
        }

        if (status === 0xff) {                                  // meta
            const type = u8();
            const size = vlq();
            const body = data.subarray(pos, pos + size);
            skip(size);
            if (type === 0x03) name = text(body);
            else if (type === 0x51 && size === 3) {
                tempos.push(((body[0] << 16) | (body[1] << 8) | body[2]));
            } else if (type === 0x2f) break;                    // end of track
            continue;
        }

        if (status === 0xf0 || status === 0xf7) {               // sysex, in one message or several
            const size = vlq();
            skip(size);
            continue;
        }

        if (status >= 0xf1 && status <= 0xf6) {                 // system common: skipped, and it ends
            skip({ 0xf1: 1, 0xf2: 2, 0xf3: 1, 0xf6: 0 }[status] || 0);
            status = 0;                                          // ... any running status with it
            continue;
        }

        const kind = status & 0xf0;
        const channel = status & 0x0f;
        const note = u8();
        const velocity = (kind === 0xc0 || kind === 0xd0) ? 0 : u8();

        if (kind === 0x90 && velocity > 0) {
            const k = key(channel, note);
            if (!open.has(k)) open.set(k, []);
            open.get(k).push(tick);
        } else if (kind === 0x80 || kind === 0x90) {
            const k = key(channel, note);
            const waiting = open.get(k);
            if (!waiting || !waiting.length) {
                dropped++;                                       // an off with no on: nothing to close
                continue;
            }
            const started = waiting.shift();
            // A note that starts and ends on the same tick has no length for the page's model to
            // carry: as a step it would open and close on the same frame, which is a note that gets
            // switched on and left sounding.
            if (tick <= started) { dropped++; continue; }
            notes.push({ note, channel, start: started, end: tick });
        }
        // 0xA0 aftertouch, 0xB0 control, 0xE0 bend: read above, and not the tune's business
    }

    // A note the track never closes is held: `end` of null, and the caller puts it on the wrap step,
    // which is where the notation in src/js/pattern.js releases a note still held at the end. A DAW
    // that omits the final note-off is saying the same thing as one that writes it at the last tick.
    for (const [k, waiting] of open) {
        for (const started of waiting) {
            notes.push({ note: k % 128, channel: Math.floor(k / 128), start: started, end: null });
        }
    }

    return { name, notes, tempos, dropped, lastTick };
}

/**
 * A Standard MIDI File -> its tracks, its tempo, and its grid resolution.
 *
 * Throws rather than guessing on anything it cannot read: a file that is not an SMF, one timed in
 * SMPTE frames rather than ticks, a format 2 file (independent patterns, which is not a tune), and a
 * header or track that claims more bytes than the file has.
 */
export function parseMidi(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (data.length < 14) throw new Error('not a MIDI file: too short for a header');

    const u32 = (i) => ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
    const u16 = (i) => (data[i] << 8) | data[i + 1];

    if (u32(0) !== HEADER_ID) throw new Error('not a MIDI file: no MThd');
    const headerLength = u32(4);
    if (headerLength < 6) throw new Error(`a header of ${headerLength} bytes, and six is the least`);
    const format = u16(8);
    const trackCount = u16(10);
    const division = u16(12);

    if (format > 1) throw new Error(`format ${format}: this reads the two that are a tune, not ` +
                                   'independent patterns');
    // bit 15 set means SMPTE: ticks per second, not per quarter note, so a step is not a musical
    // length and the grid below has nothing to divide
    if (division & 0x8000) throw new Error('SMPTE timecode division: this needs ticks per quarter note');
    if (!division) throw new Error('a division of 0 ticks per quarter note');
    if (!trackCount) throw new Error('no tracks');

    const tracks = [];
    // past the header chunk: 'MThd', its four length bytes, and the body that length describes
    let pos = 8 + headerLength;
    while (tracks.length < trackCount) {
        if (pos + 8 > data.length) throw new Error(`track ${tracks.length + 1} of ${trackCount} is missing`);
        if (u32(pos) !== TRACK_ID) throw new Error(`track ${tracks.length + 1} does not start with MTrk`);
        const length = u32(pos + 4);
        if (pos + 8 + length > data.length) {
            throw new Error(`track ${tracks.length + 1} claims ${length} bytes, past the end of the file`);
        }
        tracks.push(readTrack(data, pos + 8, length));
        pos += 8 + length;
    }

    // The tempo events, in the order the tracks are in - which is the order they are played in a
    // format 1 file, whose first track is where a sequencer writes them.
    const tempos = tracks.flatMap((track) => track.tempos);

    // 120 BPM is the tempo a file that never sets one is played at: 500000 microseconds a quarter.
    const first = tempos.length ? tempos[0] : 500000;
    const distinct = new Set(tempos);

    return {
        format,
        division,
        tracks,
        bpm: 60000000 / first,
        tempoChanges: Math.max(0, distinct.size - 1),
        dropped: tracks.reduce((n, track) => n + track.dropped, 0),
    };
}

/** The coarsest grid every one of `ticks` lands on, or sixteenths and a count of what moved. */
function chooseGrid(division, ticks) {
    for (const grid of GRIDS) {
        const ticksPerStep = (division * 4) / grid.stepsPerBar;
        if (!Number.isInteger(ticksPerStep)) continue;          // a division this grid does not fit
        if (ticks.every((tick) => tick % ticksPerStep === 0)) {
            return { ...grid, ticksPerStep, snapped: 0, worst: 0 };
        }
    }

    const ticksPerStep = Math.max(1, Math.round(division / 4));
    let snapped = 0;
    let worst = 0;
    for (const tick of ticks) {
        const off = Math.abs(tick - Math.round(tick / ticksPerStep) * ticksPerStep);
        if (off) {
            snapped++;
            worst = Math.max(worst, off);
        }
    }
    return { stepsPerBar: 16, name: 'sixteenths', ticksPerStep, snapped, worst };
}

/**
 * The tracks, as the parts of the page.
 *
 * A track that carries more than one channel becomes one voice per channel, which is what a format 0
 * file is: everything on one track, separated by channel. An empty track is dropped rather than
 * mapped - a format 1 file's first track is usually the tempo, and a part that plays nothing because
 * a conductor track took its place is a confusing thing to be shown.
 */
function voicesOf(parsed) {
    const voices = [];
    for (const track of parsed.tracks) {
        if (!track.notes.length) continue;
        const channels = [...new Set(track.notes.map((n) => n.channel))].sort((a, b) => a - b);
        for (const channel of channels) {
            voices.push({
                name: track.name,
                channel,
                notes: channel === channels[0] && channels.length === 1
                    ? track.notes
                    : track.notes.filter((n) => n.channel === channel),
            });
        }
    }
    return voices;
}

function matchesName(voice, part) {
    if (!voice.name) return false;
    const name = voice.name.toLowerCase();
    const words = [part.id, String(part.label).toLowerCase(), ...(ROLE_WORDS[part.role] || [])];
    return words.some((word) => word && name.includes(word));
}

/**
 * A parsed file -> the page's parts, each with its `on`/`off` arrays.
 *
 * `layout` is the parts themselves - id, label, role, in the order the page shows them - because
 * which four parts there are is the page's business and not the file's. A voice is matched to a
 * part by its name, then by channel 10 for the drums, and whatever is left takes the parts that are
 * left in order. A file with more voices than the page has parts is not refused - the extra notes
 * are counted in `unmapped`, and the parts that did map play.
 *
 * The length is the file's own, rounded up to a whole bar, so a tune of two bars loops in two and a
 * tune of twelve in twelve. A note still held at the end gets no step of its own - it is released on
 * the wrap entry one past the last step, which is the frame the next pass begins on.
 */
export function partsFromMidi(parsed, layout) {
    const voices = voicesOf(parsed);
    if (!voices.length) throw new Error('the file has no notes in it');

    const ticks = voices.flatMap((voice) => voice.notes
        .flatMap((note) => (note.end === null ? [note.start] : [note.start, note.end])));
    const grid = chooseGrid(parsed.division, ticks);
    const stepOf = (tick) => Math.round(tick / grid.ticksPerStep);

    // by name, then the drums by channel, then whatever is left in the order the file has it
    const pairs = new Map();
    const spare = new Set(voices);
    for (const part of layout) {
        const voice = voices.find((v) => spare.has(v) && matchesName(v, part));
        if (voice) { pairs.set(part.id, voice); spare.delete(voice); }
    }
    const drums = layout.find((part) => part.role === 'drum');
    if (drums && !pairs.has(drums.id)) {
        const voice = [...spare].find((v) => v.channel === PERCUSSION_CHANNEL);
        if (voice) { pairs.set(drums.id, voice); spare.delete(voice); }
    }
    for (const part of layout) {
        if (pairs.has(part.id) || !spare.size) continue;
        const [voice] = spare;                                   // insertion order: the file's own
        pairs.set(part.id, voice);
        spare.delete(voice);
    }

    // How long the tune is: far enough to hold every onset, and every release that is not a note
    // held to the end (those belong on the wrap, which is a step past the last one), rounded up to a
    // whole bar. An onset on the last step of a bar needs the whole of that step, hence the +1.
    let lastOnset = -1;
    let lastEnd = -1;
    for (const voice of pairs.values()) {
        for (const note of voice.notes) {
            lastOnset = Math.max(lastOnset, stepOf(note.start));
            if (note.end !== null) lastEnd = Math.max(lastEnd, stepOf(note.end));
        }
    }
    const steps = Math.ceil(Math.max(lastOnset + 1, lastEnd) / grid.stepsPerBar) * grid.stepsPerBar;
    if (steps <= 0) throw new Error('the file has no length: every note is on step 0 and none is held');

    const parts = layout.map((part) => {
        const voice = pairs.get(part.id);
        // one entry per step, and one past the end for the wrap - the shape src/js/pattern.js
        // produces and src/worklet/fluyt-worklet.js expects
        const on = Array.from({ length: steps + 1 }, () => []);
        const off = Array.from({ length: steps + 1 }, () => []);

        let held = 0;
        for (const note of voice ? voice.notes : []) {
            const start = stepOf(note.start);
            if (start >= steps) continue;                        // cannot happen: steps covers them
            on[start].push(note.note);

            if (note.end === null) {
                off[steps].push(note.note);
                held++;
                continue;
            }
            const end = stepOf(note.end);
            off[end >= steps ? steps : end].push(note.note);
        }

        return { id: part.id, label: part.label, role: part.role, steps, on, off, held };
    });

    return {
        bpm: parsed.bpm,
        stepsPerBar: grid.stepsPerBar,
        grid: grid.name,
        snapped: grid.snapped,
        worst: grid.worst,
        steps,
        bars: steps / grid.stepsPerBar,
        parts,
        tempoChanges: parsed.tempoChanges,
        dropped: parsed.dropped,
        unmapped: [...spare].reduce((n, voice) => n + voice.notes.length, 0),
    };
}
