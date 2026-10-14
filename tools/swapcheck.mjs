#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The engine swap, watched from the main thread. Run with `make check`, or `node tools/swapcheck.mjs`.
//
// src/js/fluyt.js's Part is the half of the page that replaces an engine under a playing part, and it
// is the half nothing ran: it wants an AudioContext, an AudioWorkletNode and a module the worklet can
// instantiate, so it has only ever been exercised in a browser, by ear - and this is where a bug
// lived:
//
//   a Part kept the last transport it was handed, and handed it to any node it built. So an engine
//   swapped in while the page was *stopped* was given an epoch that was by then in the past; the
//   worklet did as it was told, worked out which step that lands on now, re-articulated it, and
//   started playing. Only the parts that were swapped did - so a stopped page that Random appeared to
//   start was three parts of the four, and the drums, which Random never touches, only joined when
//   Play was pressed.
//
// The fake browser below is three objects deep and no deeper - a context, a gain and a node - and what
// it records is what each node was told, and when. The claims are the ones a listener would otherwise
// have to catch:
//
//   * a page that is stopped stays stopped after a swap
//   * a page that is playing hands the new node the position the old one had, so it joins in time
//   * neither the incoming nor the outgoing node is ever heard at a gain that would make a click
//
// Nothing here needs dist/wasm: the node is fake, and what is real is the class under test.

import { Part } from '../src/js/fluyt.js';

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const NC = '\u001b[0m';

const SAMPLE_RATE = 48000;

// src/js/fluyt.js fades a swap over 30 ms and tears the outgoing node down 20 ms later. Neither
// number is exported - they are the same fact, and this is the only other place that has to know it.
const FADE_SECONDS = 0.03;
const TEARDOWN_MS = FADE_SECONDS * 1000 + 20;

const failures = [];
const fail = (what, detail) => {
    failures.push(what);
    console.log(`  ${RED}✗${NC} ${what}`);
    if (detail) console.log(`    ${detail}`);
};
const ok = (what) => console.log(`  ${GREEN}✓${NC} ${what}`);
const check = (what, condition, detail) => (condition ? ok(what) : fail(what, detail));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------------------- the fake browser

/** A gain's AudioParam: what was asked of it, in the order it was asked. */
class FakeParam {
    constructor(value) {
        this.value = value;
        this.calls = [];
    }
    setValueAtTime(value, time) { this.calls.push({ op: 'set', value, time }); this.value = value; }
    linearRampToValueAtTime(value, time) { this.calls.push({ op: 'ramp', value, time }); }
    cancelScheduledValues(time) { this.calls.push({ op: 'cancel', time }); }
    setTargetAtTime(value, time) { this.calls.push({ op: 'target', value, time }); }
}

class FakeGain {
    constructor() {
        this.gain = new FakeParam(1);
        this.targets = [];
        this.disconnected = false;
    }
    connect(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
}

class FakeContext {
    constructor() {
        this.sampleRate = SAMPLE_RATE;
        this.currentTime = 0;
        this.gains = [];
        this.audioWorklet = { addModule: async () => {} };
    }
    createGain() {
        const gain = new FakeGain();
        this.gains.push(gain);
        return gain;
    }
}

/** Every node the page has built, in order, which is the order the parts were swapped. */
const built = [];

/**
 * A stand-in for the part worklet, from the outside only.
 *
 * It speaks the same protocol the real one does - it announces `needWasm` from its constructor, is
 * answered with the module, and reports `ready` with its preset names - because Part's sequencing
 * around that handshake is half of what this checks. What it does not do is make any sound.
 */
class FakeNode {
    constructor(engine) {
        this.engine = engine;
        this.sent = [];                    // every message the main thread posted to it, in order
        this.targets = [];                 // what it was connected to: the gain it plays through
        this.disconnected = false;

        this.port = {
            postMessage: (message) => this.receive(message),
            onmessage: null,
        };

        // The real processor announces itself from its own constructor, which is the same tick in
        // which Part assigns onmessage - so this is a microtask and not a timer.
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

    connect(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }

    /** Everything it was told of one type, in order. */
    told(type) { return this.sent.filter((m) => m.type === type); }

    /** Whether it was ever given a transport position - the thing a stopped page must not do. */
    get positioned() {
        return this.sent.some((m) => m.data && (m.data.stepFrames || m.data.epochFrame));
    }
}

/** Each message as one legible line, for when a claim fails and the log is the only evidence. */
function describe(message) {
    const data = message.data || {};
    const bits = [message.type];
    if ('stepFrames' in data) bits.push(`stepFrames ${data.stepFrames}`);
    if ('epochFrame' in data) bits.push(`epochFrame ${data.epochFrame}`);
    if ('index' in data) bits.push(`preset ${data.index}`);
    return bits.join(' ');
}

const told = (node) => (node.sent.length ? node.sent.map(describe).join('; ') : 'nothing');

// ---------------------------------------------------------------------------------- the engines

const ENGINES = [
    { slug: 'trio', name: 'FLUYT TRIO', presets: ['SQUARE LEAD', 'SAW LEAD', 'FAT BASS', 'SOFT PAD'] },
    { slug: 'phase', name: 'FLUYT PHASE', presets: ['VELVET PAD', 'SYNC LEAD', 'PHASE BASS'] },
    { slug: 'analog', name: 'FLUYT ANALOG', presets: ['SQR BASS', 'SAW LEAD'] },
];

const engine = (slug) => ENGINES.find((e) => e.slug === slug);

/** The module cache, which is the one thing here that is not a browser object but a page one. */
const cache = {
    loading: null,
    async load(e) {
        cache.loading = e;
        return { jsCode: `// ${e.slug}`, wasmBytes: new ArrayBuffer(0) };
    },
    async ensureWorklet() {},
};

globalThis.AudioWorkletNode = function AudioWorkletNode() {
    const node = new FakeNode(cache.loading);
    built.push(node);
    return node;
};

// -------------------------------------------------------------------------------------- the check

const PATTERN = { on: [[60], [62]], off: [[], [60]] };
const STEP_FRAMES = 6428.568;         // the tune's own step, which is not a whole number of frames
const EPOCH = 480000;                 // where Play puts step 0

async function main() {
    console.log('========================================');
    console.log('Fluyt swap - what a new node is told');
    console.log('========================================');
    console.log('');

    const ctx = new FakeContext();
    const output = ctx.createGain();

    // ---- 1. a page that has never played
    console.log('A part built while the page is stopped:');

    const part = new Part(ctx, cache, { id: 'lead', role: 'lead' }, output);
    part.setPattern(PATTERN);                       // what Player.init does, before any engine
    await part.setEngine(engine('trio'));
    const trio = built.at(-1);

    const patterned = trio.told('setPattern');
    check('it is given the pattern the page compiled', patterned.length === 1 &&
          patterned[0].data.on === PATTERN.on && patterned[0].data.off === PATTERN.off,
          `it was told: ${told(trio)}`);

    check('and no position with it - a stopped page arms no transport',
          patterned.length === 1 && patterned[0].data.stepFrames === 0 &&
          patterned[0].data.epochFrame === 0 && trio.told('setTransport').length === 0,
          `it was told: ${told(trio)}`);

    // ---- 2. Play
    part.setTransport(EPOCH, STEP_FRAMES);
    const armed = trio.told('setTransport');
    check('Play hands it the epoch and the step length, which are one fact and go together',
          armed.length === 1 && armed[0].data.epochFrame === EPOCH &&
          armed[0].data.stepFrames === STEP_FRAMES,
          `it was told: ${told(trio)}`);

    // ---- 3. Stop, and then a swap. This is the bug: the part remembered the epoch, so the node
    // built here was handed a position that was by then in the past, and started playing.
    part.stop();
    check('Stop stops it', trio.told('stop').length === 1, `it was told: ${told(trio)}`);

    await part.setEngine(engine('phase'));
    const phase = built.at(-1);
    const handover = [...phase.told('setPattern'), ...phase.told('setTransport')];

    check('an engine swapped in while the page is stopped is given no position',
          handover.length === 1 && handover[0].type === 'setPattern' &&
          handover[0].data.stepFrames === 0 && handover[0].data.epochFrame === 0,
          `it was told: ${told(phase)}`);

    check('so the part it replaced is left stopped, and the page stays silent',
          !phase.positioned, `it was told: ${told(phase)}`);

    // ---- 4. the same swap while the page is playing: the node has to join the tune already in
    // progress, on the step it is on, or a mid-tune swap arrives at its own bar one.
    const LATER = 900000;
    part.setTransport(LATER, STEP_FRAMES);
    await part.setEngine(engine('analog'));
    const analog = built.at(-1);

    const joined = analog.told('setPattern');
    check('an engine swapped in while the page is playing is given the position the part had',
          joined.length === 1 && joined[0].data.epochFrame === LATER &&
          joined[0].data.stepFrames === STEP_FRAMES,
          `it was told: ${told(analog)}`);

    // ---- 5. the crossfade, which is what makes a swap inaudible
    console.log('');
    console.log('The crossfade:');

    // What was asked of a gain, with the cancel that opens each swap taken out: it is bookkeeping,
    // and the two instructions that matter are the value it starts at and the value it ramps to.
    const ramps = (gain) => gain.calls.filter((c) => c.op === 'set' || c.op === 'ramp');
    const incoming = ramps(analog.targets[0].gain);
    check(`the node swapped in is ramped up from silence over ${FADE_SECONDS * 1000} ms`,
          incoming.length === 2 && incoming[0].value === 0 &&
          incoming[1].op === 'ramp' && incoming[1].value === 1 &&
          incoming[1].time - incoming[0].time === FADE_SECONDS,
          `its gain was told: ${JSON.stringify(incoming)}`);

    const outgoing = ramps(phase.targets[0].gain);
    const down = outgoing.find((c) => c.op === 'ramp' && c.value === 0);
    check('and the one it replaced is ramped down at the same moment, not cut',
          Boolean(down) && down.time === incoming[1].time,
          `the replaced node's gain was told: ${JSON.stringify(outgoing)}`);

    check('the node it replaced is still connected and sounding while it fades',
          !phase.disconnected && !phase.told('allNotesOff').length,
          `it was told: ${told(phase)}`);

    await sleep(TEARDOWN_MS);
    check('and is stopped and disconnected once the fade is over',
          phase.disconnected && phase.told('allNotesOff').length === 1,
          `it was told: ${told(phase)}${phase.disconnected ? '' : ', and never disconnected'}`);

    // ---- 6. mute, which is the part's own gain and not the engine's
    console.log('');
    console.log('Mute:');

    // The last thing the part's own gain was asked for, since every swap sets it too - the mute is
    // not a mode a swap can end, it is the value this gain is being held at.
    const held = () => part.gain.gain.calls.filter((c) => c.op === 'target').at(-1);

    part.setMuted(true);
    check('mute takes the part to silence rather than stopping its engine',
          held()?.value === 0, `its gain was last told: ${JSON.stringify(held())}`);

    part.setMuted(false);
    check('and unmuting brings it back', held()?.value === 1,
          `its gain was last told: ${JSON.stringify(held())}`);

    // ---- the tally
    console.log('');
    if (failures.length) {
        console.log(`${RED}${failures.length} failure${failures.length === 1 ? '' : 's'}${NC}`);
        process.exit(1);
    }
    console.log(`${GREEN}a swap neither starts a stopped page nor drops a playing one${NC}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(`${RED}swapcheck: ${err && err.stack ? err.stack : err}${NC}`);
    process.exit(1);
});
