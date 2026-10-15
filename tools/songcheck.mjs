#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// Changing the tune, watched from the main thread. Run with `make check`, or `node tools/songcheck.mjs`.
//
// Player.setSong is the one place a tune changes - a tune picked out of src/js/tunes/, or a MIDI file
// a visitor brings - and what it does is a sequence, near enough every line of it load-bearing:
//
//   * the notes go over before the engines, because setEngine builds a new node and hands it the
//     pattern the part is holding: doing it the other way round pushes the *outgoing* tune's notes
//     into the new node
//   * the engines are awaited before Play, because an unawaited one lets Play post a transport to a
//     node that is about to be replaced
//   * every part is handed its notes with no transport, so a tune swapped in while the page is
//     stopped is held and not played (src/worklet/fluyt-worklet.js's side of that is tools/
//     workletcheck.mjs §8)
//   * and a page that was playing plays again, with one epoch for all four parts, so the loop starts
//     at the top of the new tune rather than wherever the old one had got to
//
// A wrong order in any of those is not a crash: it is a page that plays the previous tune's notes on
// the new engine, or plays four parts a step apart, or starts playing when it was stopped. So the
// swap is driven here against a fake browser and the messages are read back.
//
// What this does *not* cover: selectTune's own fetch. A file:// url is refused by Node's fetch, so the
// tune path is exercised through setSong - which is everything selectTune does after the bytes have
// arrived - and the url it fetches is covered by tools/pagecheck.mjs, which resolves every url a
// module builds for itself. What is left uncovered is the fetch call itself.
//
// Nothing here needs dist/wasm or a browser: the context, the nodes and the engine modules are fake,
// and what is real is the Player and the files the tunes are compiled from.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Player } from '../src/js/player.js';
import { LAYOUT } from '../src/js/parts.js';
import { compileMidi } from '../src/js/tune.js';
import { TUNES } from '../src/js/tunes/index.js';
import { buildMidi, noteEvents } from './midifile.mjs';

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const NC = '\u001b[0m';

const SAMPLE_RATE = 48000;

const failures = [];
const fail = (what, detail) => {
    failures.push(what);
    console.log(`  ${RED}✗${NC} ${what}`);
    if (detail) console.log(`    ${detail}`);
};
const ok = (what) => console.log(`  ${GREEN}✓${NC} ${what}`);
const check = (what, condition, detail) => (condition ? ok(what) : fail(what, detail));

// ------------------------------------------------------------------------------- the fake browser

/** A gain's AudioParam. Nothing here is read back except that it was told something. */
class FakeParam {
    constructor(value) { this.value = value; }
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
    cancelScheduledValues() {}
    setTargetAtTime(value) { this.value = value; }
}

class FakeGain {
    constructor() { this.gain = new FakeParam(1); this.targets = []; }
    connect(target) { this.targets.push(target); }
    disconnect() {}
}

class FakeContext {
    constructor() {
        this.sampleRate = SAMPLE_RATE;
        this.currentTime = 0;
        this.state = 'suspended';       // as a context is before the click that starts it
        this.destination = new FakeGain();
        this.audioWorklet = { addModule: async () => {} };
    }
    createGain() { return new FakeGain(); }
    async resume() { this.state = 'running'; }
}

/** Every node the page has built, in the order it built them. */
const built = [];

/**
 * A stand-in for the part worklet, from the outside only: it speaks the same protocol the real one
 * does - announce `needWasm`, be answered with the module, report `ready` with its preset names - and
 * makes no sound. What is read back is every message the main thread posted to it, in order.
 */
class FakeNode {
    constructor(engine) {
        this.engine = engine;
        this.sent = [];
        this.port = {
            postMessage: (message) => this.receive(message),
            onmessage: null,
        };
        queueMicrotask(() => this.deliver({ type: 'needWasm' }));
    }

    receive(message) {
        this.sent.push(message);
        if (message.type === 'wasmBytes') {
            queueMicrotask(() => this.deliver({
                type: 'ready',
                data: {
                    engineName: this.engine.name,
                    presetCount: this.engine.presets.length,
                    presetNames: this.engine.presets,
                },
            }));
        }
    }

    deliver(message) {
        if (this.port.onmessage) this.port.onmessage({ data: message });
    }

    connect(target) { this.connectsTo = target; }
    disconnect() {}

    told(type) { return this.sent.filter((m) => m.type === type); }

    /** The last thing of one type it was told, or undefined. */
    last(type) { return this.told(type).at(-1); }
}

globalThis.AudioWorkletNode = function AudioWorkletNode() {
    const node = new FakeNode(cache.loading);
    built.push(node);
    return node;
};

// ---------------------------------------------------------------------------------- the engines

/**
 * The engines this check pretends are built.
 *
 * Every slug any tune names, plus two the tunes do not use - so a tune that names an engine, and a
 * tune that names the engine another tune named, both have something to resolve to. The names are the
 * shape src/js/parts.js's role patterns look for, so a preset is chosen the way the page chooses one.
 */
const SLUGS = [...new Set([...TUNES.flatMap((tune) => Object.values(tune.ENGINES)), 'formant', 'noise'])];
const ENGINES = SLUGS.map((slug) => ({
    slug,
    name: `FLUYT ${slug.toUpperCase()}`,
    module: `fluyt-${slug}-synth.js`,
    presets: ['SQR BASS', 'FAT BASS', 'SAW LEAD', 'SOFT PAD', 'DRUM KIT'],
}));

/** The module cache, which is the one page object here that is not a browser one. */
const cache = { loading: null };

// ----------------------------------------------------------------------------------- the fixtures

/** A file a visitor might bring: four tracks, sixteenths, and a tempo that is nobody's default. */
const VISITOR_BPM = 96;
const visitorFile = () => {
    const bars = 2;
    const steps = bars * 16;
    const notes = [];
    for (let i = 0; i < steps; i++) {
        notes.push({ note: 60 + (i % 4), start: i * 120, end: i * 120 + 120 });
    }
    const tracks = ['Bass', 'Lead', 'Pad', 'Drums'].map((name, index) => ({
        name,
        // channel 10 for the last track, which is where a DAW puts a kit and where the page looks
        events: noteEvents(notes, { channel: index === 3 ? 9 : index }),
    }));
    return buildMidi({ format: 1, division: 480, bpm: VISITOR_BPM, tracks });
};

const asFile = (name, bytes) => ({
    name,
    arrayBuffer: async () => new Uint8Array(bytes),
});

// -------------------------------------------------------------------------------------- the check

/** Whether every part is holding notes it has not been told to play. */
function allHeld(player) {
    for (const part of player.parts.values()) {
        const pattern = part.node?.last('setPattern');
        if (!pattern || pattern.data.stepFrames !== 0 || pattern.data.epochFrame !== 0) return false;
    }
    return true;
}

async function main() {
    console.log('========================================');
    console.log('Fluyt tunes - changing one, from the main thread');
    console.log('========================================');

    if (!TUNES.length) {
        fail('there are no tunes in TUNES to play');
        return;
    }

    // The songs, compiled from the files the page plays, with the page's own reader.
    const songs = new Map();
    for (const notation of TUNES) {
        songs.set(notation.ID, compileMidi(new Uint8Array(await readFile(fileURLToPath(notation.SONG_URL)))));
    }

    const renders = [];
    const player = new Player({ onChange: () => renders.push(player.source) });
    player.ctx = new FakeContext();
    player.sampleRate = player.ctx.sampleRate;
    player.master = player.ctx.createGain();
    player.engines = ENGINES;
    player.cache.load = async (engine) => {
        cache.loading = engine;
        return { jsCode: `// ${engine.slug}`, wasmBytes: new ArrayBuffer(0) };
    };

    // ---- 1. the page opening on a tune: four parts, their engines, and nothing armed
    const first = TUNES[0];
    console.log('');
    console.log(`Opening on ${first.LABEL}, the way selectTune does once the file has arrived:`);

    await player.setSong(songs.get(first.ID), {
        source: { kind: 'tune', id: first.ID },
        engines: first.ENGINES,
    });

    check(`all ${LAYOUT.length} parts are built`, player.parts.size === LAYOUT.length,
          `${player.parts.size} parts: ${[...player.parts.keys()].join(', ')}`);
    check('each with the tune in it and no transport, so the page opens stopped',
          allHeld(player) && !player.playing);
    check(`each on the engine ${first.ID} names`,
          LAYOUT.every((p) => player.engineFor(p.id)?.slug === first.ENGINES[p.id]),
          LAYOUT.map((p) => `${p.id}: ${player.engineFor(p.id)?.slug}`).join(', '));
    check(`the parts are the file's own tempo and grid - ${player.bpm} BPM, ` +
          `${player.song.stepsPerBar} to the bar`,
          player.bpm === songs.get(first.ID).bpm &&
          player.stepFrames === (SAMPLE_RATE * 60) / (player.bpm * (player.song.stepsPerBar / 4)),
          `${player.bpm} BPM, one step ${player.stepFrames.toFixed(1)} frames`);
    check('and the page was rendered once, not once per part',
          renders.length === 1, `${renders.length} renders`);

    // ---- 2. Play: one epoch, handed to every part together
    console.log('');
    console.log('Play:');

    await player.play();

    check('every part is armed with one epoch and the tune\'s own step length',
          [...player.parts.values()].every((part) => {
              const m = part.node.last('setTransport');
              return m && m.data.epochFrame === player.epochFrame &&
                     m.data.stepFrames === player.stepFrames;
          }),
          `epoch ${player.epochFrame}`);

    // Now + 120 ms, and not `currentFrame`: the epoch is the frame step 0 will be on, and starting it
    // at the frame the click happened on would have the first step already in the past by the time
    // the message reaches four worklets.
    check('and the epoch is a little way ahead, not the frame the click happened on',
          player.epochFrame === Math.round((player.ctx.currentTime + 0.12) * SAMPLE_RATE) &&
          player.epochFrame > player.ctx.currentTime * SAMPLE_RATE,
          `epoch ${player.epochFrame}`);

    check('every part was handed its notes before the transport that plays them',
          [...player.parts.values()].every((part) => {
              const node = part.node;
              const pattern = node.sent.findIndex((m) => m.type === 'setPattern');
              const transport = node.sent.findIndex((m) => m.type === 'setTransport');
              return pattern >= 0 && transport > pattern;
          }));

    // ---- 3. another tune, while it is playing
    //
    // Every tune in TUNES is swapped in, in turn, and swapped back out again - so a tune that is added
    // is checked against whatever the page was already playing, and the list is walked twice round.
    //
    // `held` is the tune the page is on, and it stays the same one for the whole loop: Play above left
    // the page on TUNES[0], each pass swaps a tune in and then swaps back to that, so what the page is
    // holding at the top of a pass is what the previous pass left it holding. Reading it off TUNES
    // instead - assuming pass i started where pass i-1's *swap* went, rather than where its swap *back*
    // left it - is a check that passes only while there is one tune, and the first pass is then the
    // zero-difference case (the page re-told the tune it is already on, and rebuilds nothing).
    const held = TUNES[0];
    for (const tune of TUNES) {
        const differs = LAYOUT.filter((p) => held.ENGINES[p.id] !== tune.ENGINES[p.id]);

        console.log('');
        console.log(`Swapping ${held.LABEL} for ${tune.LABEL} while it is playing:`);

        const before = built.length;
        renders.length = 0;
        await player.setSong(songs.get(tune.ID), {
            source: { kind: 'tune', id: tune.ID },
            engines: tune.ENGINES,
        });

        check('it is still playing afterwards', player.playing);
        check(`only the ${differs.length} part${differs.length === 1 ? '' : 's'} whose engine ` +
              `differs ${differs.length === 1 ? 'is' : 'are'} rebuilt`,
              built.length - before === differs.length,
              `${built.length - before} nodes built, for ${differs.map((p) => p.id).join(', ') || 'nothing'}`);

        check(`every part is on ${tune.ID}'s own engine`,
              LAYOUT.every((p) => player.engineFor(p.id)?.slug === tune.ENGINES[p.id]),
              LAYOUT.map((p) => `${p.id}: ${player.engineFor(p.id)?.slug}`).join(', '));

        check('every part holds the new tune before any of them is armed again',
              [...player.parts.values()].every((part) => {
                  const node = part.node;
                  const patterns = node.told('setPattern');
                  const last = patterns.at(-1);
                  const transport = node.last('setTransport');
                  if (!last || last.data.stepFrames !== 0) return false;
                  // a part whose engine was rebuilt has a fresh node, so its transport is after its
                  // pattern by construction; one that was not has both, in this order
                  return node.sent.indexOf(last) < node.sent.indexOf(transport);
              }));

        check('and all four are armed to one epoch at the new tune\'s step length',
              [...player.parts.values()].every((part) => {
                  const m = part.node.last('setTransport');
                  return m && m.data.epochFrame === player.epochFrame &&
                         m.data.stepFrames === player.stepFrames;
              }),
              [...player.parts.values()].map((part) =>
                  `${part.id}: ${part.node.last('setTransport')?.data.stepFrames.toFixed(1)}`).join(', '));

        check('the loop restarted at the top of the new tune rather than at the old phase',
              player.epochFrame === Math.round((player.ctx.currentTime + 0.12) * SAMPLE_RATE),
              `epoch ${player.epochFrame}`);

        check('and the page was rendered at the end, not while it was half swapped',
              renders.length === 2, `${renders.length} renders`);

        // A tune swapped in while the page is *stopped* is the case the worklet's contract exists
        // for: the notes arrive and nothing plays. Swapping back to `held` is that swap, and it changes
        // engines in the other direction - so this pass ends where it started, with the page holding
        // the tune it was holding.
        player.stop();
        renders.length = 0;
        await player.setSong(songs.get(held.ID), {
            source: { kind: 'tune', id: held.ID },
            engines: held.ENGINES,
        });

        check(`swapping back to ${held.ID} while stopped leaves the page stopped, holding it`,
              !player.playing && allHeld(player));
        check('and renders once, with nothing armed in between',
              renders.length === 1, `${renders.length} renders`);

        await player.play();
    }

    // ---- 4. a file a visitor brings
    console.log('');
    console.log('A MIDI file a visitor brings:');

    const enginesBefore = LAYOUT.map((p) => player.engineFor(p.id)?.slug);
    const nodesBefore = built.length;
    renders.length = 0;
    await player.loadMidiFile(asFile('mine.mid', visitorFile()));

    check('not one engine is rebuilt - a loaded file keeps the engines that were on screen',
          built.length === nodesBefore &&
          LAYOUT.every((p, i) => player.engineFor(p.id)?.slug === enginesBefore[i]),
          `${built.length - nodesBefore} nodes built, engines now ` +
          LAYOUT.map((p) => player.engineFor(p.id)?.slug).join(', '));

    check('and the page plays it at the file\'s own tempo and grid, not the tune\'s',
          player.bpm === VISITOR_BPM && player.song.stepsPerBar === 16 &&
          player.stepFrames === (SAMPLE_RATE * 60) / (VISITOR_BPM * 4),
          `${player.bpm} BPM, ${player.stepFrames.toFixed(1)} frames a step`);

    check('the page says which file it is, so the picker can show it',
          player.source?.kind === 'file' && player.source.name === 'mine.mid' &&
          player.tuneName === 'mine.mid',
          JSON.stringify(player.source));

    check('it is still playing, on the one epoch all four parts were given',
          player.playing && [...player.parts.values()].every(
              (part) => part.node.last('setTransport')?.data.epochFrame === player.epochFrame));

    check('and the page was rendered at the end, not while it was half swapped',
          renders.length === 2, `${renders.length} renders`);

    // ---- 5. a file that is not a MIDI file
    //
    // The bytes are read and compiled before anything is touched, so this is the check that a bad
    // file costs a message and not the tune: what was playing is still playing, and still the same.
    console.log('');
    console.log('A file that is not a MIDI file:');

    const songBefore = player.song;
    const sourceBefore = player.source;
    let threw = null;
    try {
        await player.loadMidiFile(asFile('notes.txt', new TextEncoder().encode('not a midi file')));
    } catch (err) {
        threw = err;
    }

    check('it is refused, with the reader\'s own reason', Boolean(threw), threw ? '' : 'nothing was thrown');
    check('and what was playing is still playing, and still the same tune',
          player.playing && player.song === songBefore && player.source === sourceBefore,
          `${player.tuneName}, playing: ${player.playing}`);
    check('with no engine rebuilt and no part left holding a tune nobody asked for',
          built.length === nodesBefore, `${built.length - nodesBefore} nodes built`);

    // ---- the tally
    console.log('');
    if (failures.length) {
        console.log(`${RED}${failures.length} failure${failures.length === 1 ? '' : 's'}${NC}`);
        process.exit(1);
    }
    console.log(`${GREEN}a tune changes without dropping the page, and a bad file costs nothing${NC}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(`${RED}songcheck: ${err && err.stack ? err.stack : err}${NC}`);
    process.exit(1);
});
