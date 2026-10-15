#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// Run the worklet itself, outside a browser, and check where its notes land. Run with `make check`,
// or `node tools/workletcheck.mjs`.
//
// src/worklet/fluyt-worklet.js is the most intricate file here and the only one nothing else
// touches. smoke.mjs loads the modules the way the worklet does but never runs the worklet;
// tunecheck.mjs renders the tune but with its own scheduler, in whole blocks, with none of the
// splitting. So the part of the page that decides *which sample* a note starts on is, without this,
// checked by nothing but a listener's ear.
//
// What it does: it stands in for an AudioWorkletGlobalScope - `currentFrame`, `sampleRate`, a
// MessagePort, `registerProcessor` - imports the worklet, builds a processor, and feeds it the same
// messages the page sends. Then it runs the transport and watches two things:
//
//   * every call the worklet makes into the module, so the frame a note is started on can be
//     reconstructed exactly. `currentFrame` is the start of the quantum and does not move while
//     `process()` runs, so a note's real position is the quantum's start plus the frames already
//     rendered inside it - which is what the render block sizes add up to.
//   * the size of every render block, which is the other half of the same question: the blocks in a
//     quantum have to be exactly the 128 frames, with nothing skipped and nothing written twice.
//
// The step length is the default tune's own - 6428.571... frames, not a whole number - and that is
// what makes the timing worth measuring rather than assuming. Rounding it has a cost either way:
//
//   * a scheduler that keeps a running position and adds the step to it drifts by however much was
//     rounded away each time, and is 54.9 frames - nearly a whole step - out by the end of the tune
//   * a scheduler that recomputes from the absolute step index, which is what this one does, cannot
//     drift: the error stays inside half a frame. But rounding then puts half the notes up to half
//     a frame *early*, and the transport's contract is that a step fires at the first frame at or
//     after its boundary.
//
// So the tolerance is not symmetric and not slack: a note has to be at or after its step, and less
// than a frame past it. Either failure above lands outside that, and both were checked by breaking
// the worklet on purpose.

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { tuneById, DEFAULT_TUNE_ID } from '../src/js/tunes/index.js';
import { compileMidi } from '../src/js/tune.js';
import { presetForRole } from '../src/js/parts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WASM_DIR = path.join(ROOT, 'dist', 'wasm');
const WORKLET = path.join(ROOT, 'src', 'worklet', 'fluyt-worklet.js');
const SAMPLE_RATE = 48000;
const QUANTUM = 128;

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const YELLOW = '\u001b[1;33m';
const NC = '\u001b[0m';

const failures = [];
const fail = (what) => {
    failures.push(what);
    console.log(`  ${RED}✗${NC} ${what}`);
};
const ok = (what) => console.log(`  ${GREEN}✓${NC} ${what}`);

// --------------------------------------------------------------------------------- the sandbox
//
// The worklet's globals, defined before it is imported. AudioWorkletProcessor is the one that
// matters: the file extends it, and its `port` is where the constructor hangs the message handler
// and from which it announces `needWasm`.

class FakePort {
    constructor() {
        this.onmessage = null;
        this.sent = [];
    }
    postMessage(message) {
        this.sent.push(message);
    }
    /** Deliver a message the way the worklet scope would, and hand back its promise. */
    deliver(message) {
        return this.onmessage ? this.onmessage({ data: message }) : undefined;
    }
}

globalThis.AudioWorkletProcessor = class {
    constructor() {
        this.port = new FakePort();
    }
};

let Registered = null;
globalThis.registerProcessor = (name, cls) => {
    if (name === 'fluyt-part') Registered = cls;
};

// CurrentFrame and sampleRate are bare globals in an AudioWorkletGlobalScope - not properties of
// anything - and the file reads them that way, so they are set here as bare globals too.
globalThis.sampleRate = SAMPLE_RATE;
globalThis.currentFrame = 0;

// ------------------------------------------------------------------------------- the processor

/** Everything one processor was asked to do, in order, with the frame each thing happened on. */
function instrument(processor) {
    // quantum 0 and offset 0 to begin with, because the transport can be set before the audio
    // thread has run once - that is what a node joining a tune in progress does, and its events
    // are then at the frame currentFrame already holds rather than before the beginning.
    const log = { events: [], blocks: [], quantum: 0, offset: 0 };

    const realOn = processor.mod._regroove_synth_note_on;
    const realOff = processor.mod._regroove_synth_note_off;
    const realAllOff = processor.mod._regroove_synth_all_notes_off;
    const realRender = processor.mod._regroove_synth_process_f32;

    const at = () => log.quantum * QUANTUM + log.offset;

    processor.mod._regroove_synth_note_on = (h, note, velocity) => {
        log.events.push({ kind: 'on', note, frame: at() });
        return realOn(h, note, velocity);
    };
    processor.mod._regroove_synth_note_off = (h, note) => {
        log.events.push({ kind: 'off', note, frame: at() });
        return realOff(h, note);
    };
    processor.mod._regroove_synth_all_notes_off = (h) => {
        log.events.push({ kind: 'allOff', note: -1, frame: at() });
        return realAllOff(h);
    };
    processor.mod._regroove_synth_process_f32 = (h, ptr, frames, rate) => {
        log.blocks.push({ quantum: log.quantum, frames, offset: log.offset });
        const result = realRender(h, ptr, frames, rate);
        log.offset += frames;
        return result;
    };

    log.beginQuantum = (index) => {
        log.quantum = index;
        log.offset = 0;
    };

    // The capture heap grows when the module does, so the memory the module writes is read from
    // wherever it is now rather than from a view taken before it moved.
    log.read = (ptr, frames) => {
        const heap = processor.mod.HEAPF32;
        const base = ptr >> 2;
        const out = new Float32Array(frames * 2);
        for (let i = 0; i < frames * 2; i++) out[i] = heap[base + i];
        return out;
    };

    return log;
}

async function blankProcessor() {
    const p = new Registered();
    for (const message of p.port.sent) {
        if (message.type !== 'needWasm') fail(`a new processor's first message was ${message.type}`);
    }
    return p;
}

async function loadInto(processor, engine) {
    await processor.port.deliver({
        type: 'wasmBytes',
        data: {
            jsCode: await readFile(path.join(WASM_DIR, engine.module), 'utf8'),
            wasmBytes: await readFile(path.join(WASM_DIR, engine.module.replace(/\.js$/, '.wasm'))),
            sampleRate: SAMPLE_RATE,
        },
    });

    const ready = processor.port.sent.find((m) => m.type === 'ready');
    if (!ready) {
        const error = processor.port.sent.find((m) => m.type === 'error');
        throw new Error(`the worklet never reported ready: ${error ? error.data.message : 'silently'}`);
    }
    return ready.data;
}

/** Run whole quanta, exactly as the audio thread would, and count what comes out. */
function run(processor, log, quanta, sink) {
    const left = new Float32Array(QUANTUM);
    const right = new Float32Array(QUANTUM);
    for (let q = 0; q < quanta; q++) {
        const index = log.quantum + 1;
        globalThis.currentFrame = index * QUANTUM;
        log.beginQuantum(index);
        left.fill(0);
        right.fill(0);
        processor.process([], [[left, right]]);
        if (sink) sink(left, right);
    }
}

// ------------------------------------------------------------------------------------- the checks

async function main() {
    console.log('========================================');
    console.log('Fluyt worklet - the transport, measured');
    console.log('========================================');
    console.log('');

    if (!Registered) {
        await import(pathToFileURL(WORKLET).href);
        if (!Registered) {
            fail('importing the worklet did not register fluyt-part');
            return report();
        }
    }

    const engines = JSON.parse(await readFile(path.join(WASM_DIR, 'engines.json'), 'utf8'));
    const engine = engines.find((e) => e.slug === 'analog') || engines[0];
    // the tune the page opens on, read by the page's own reader: the pattern, the tempo and the grid
    // measured here are the ones that go to the worklet, not a second copy of them
    const song = compileMidi(new Uint8Array(await readFile(fileURLToPath(
        tuneById(DEFAULT_TUNE_ID).SONG_URL))));
    const tune = song.parts;
    const bass = tune.find((p) => p.id === 'bass');

    // the tune's own step length: fractional, and the whole point of the exercise
    const stepFrames = (SAMPLE_RATE * 60) / (song.bpm * (song.stepsPerBar / 4));
    const totalSteps = bass.steps;
    const step = { on: bass.on, off: bass.off, stepFrames, epochFrame: 0 };

    console.log(`One step is ${stepFrames.toFixed(6)} frames; the tune is ${totalSteps} of them, ` +
                `${(totalSteps * stepFrames / SAMPLE_RATE).toFixed(2)} s.`);
    console.log('');

    // ---- 1. every step lands where the transport says, and the error does not grow
    console.log('A tune played from frame 0:');

    const processor = await blankProcessor();
    const ready = await loadInto(processor, engine);
    processor.loadPreset(presetForRole('bass', ready.presetNames));

    globalThis.currentFrame = 0;
    const log = instrument(processor);

    // the pattern is set at frame 0 with the epoch at 0, so step 0 is articulated as part of the
    // join - which is what a node that starts the tune does too
    await processor.port.deliver({ type: 'setPattern', data: step });

    const quanta = Math.ceil((totalSteps * stepFrames) / QUANTUM) + 2;
    let energy = 0;
    run(processor, log, quanta, (left) => {
        for (let i = 0; i < left.length; i++) energy += left[i] * left[i];
    });

    // what should have happened, in order: the gates a step closes, then the ones it opens, which
    // is the order applyStep does them in
    const wanted = [];
    for (let s = 0; s < bass.on.length; s++) {
        for (const note of bass.off[s]) wanted.push({ kind: 'off', note, step: s });
        for (const note of bass.on[s]) wanted.push({ kind: 'on', note, step: s });
    }

    // The join begins by releasing everything - it cannot know what was sounding - and only then
    // re-articulates the step in progress. That release is not part of the pattern's schedule, so
    // it is taken out of the comparison here and counted on its own.
    //
    // The quanta are rounded up, so the log reaches a little past the last step and holds the far
    // side of the loop point as well - the wrap entry and step 0 of the next pass. That boundary is
    // what section 1b measures; here the claim is the pass itself, so the boundary is left to it.
    const passEnd = totalSteps * stepFrames;
    const clears = log.events.filter((e) => e.kind === 'allOff').length;
    const played = log.events
        .filter((e) => e.kind !== 'allOff' && e.frame < passEnd)
        .map((e) => ({ kind: e.kind, note: e.note, frame: e.frame }));

    if (clears !== 1) fail(`setting the pattern released everything ${clears} times, not once`);
    else ok('setting the pattern releases whatever was sounding, once, before it re-articulates');

    // played against wanted, by kind and note. Reported as the first divergence rather than a
    // count, because "129 and 128" says nothing about which event is wrong.
    const describe = (e, step) =>
        `${e.kind}${e.kind === 'off' ? ' ' : ' '}${e.note}` + (step === undefined ? '' : ` (step ${step})`);

    let firstDiff = -1;
    for (let i = 0; i < Math.max(played.length, wanted.length); i++) {
        const p = played[i];
        const w = wanted[i];
        if (!p || !w || p.kind !== w.kind || p.note !== w.note) {
            firstDiff = i;
            break;
        }
    }

    if (firstDiff >= 0) {
        const p = played[firstDiff];
        const w = wanted[firstDiff];
        fail(`at event ${firstDiff}: the worklet played ` +
             `${p ? describe(p) + ' at frame ' + p.frame : 'nothing'}, and the pattern asks for ` +
             `${w ? describe(w) + ' at frame ' + w.step * stepFrames : 'nothing'} ` +
             `(${played.length} played, ${wanted.length} asked for)`);
        for (let i = Math.max(0, firstDiff - 2); i < Math.min(played.length, firstDiff + 3); i++) {
            console.log(`      ${i}: played ${played[i] ? describe(played[i]) : '-'}` +
                        `   wanted ${wanted[i] ? describe(wanted[i]) : '-'}`);
        }
    } else {
        let worst = 0;
        let worstStep = 0;
        let moved = 0;
        for (let i = 0; i < wanted.length; i++) {
            const exact = wanted[i].step * stepFrames;
            const error = played[i].frame - exact;
            // the worklet fires a step at the first frame at or after its boundary, so 0..1 is the
            // whole tolerance - anything else is a note that moved
            if (error < 0 || error >= 1) moved++;
            if (Math.abs(error) > Math.abs(worst)) {
                worst = error;
                worstStep = wanted[i].step;
            }
        }
        const last = played[played.length - 1];
        const lastExact = wanted[wanted.length - 1].step * stepFrames;
        const lastError = last.frame - lastExact;

        // The claim is only made when it holds: a run that moved notes still reports where, and
        // saying "each within a sample" over the top of a failure is how a check gets believed.
        if (moved) {
            fail(`${moved} of ${wanted.length} note events are not on their step ` +
                 `(worst ${worst.toFixed(2)} frames, at step ${worstStep}; ` +
                 `the last is ${lastError.toFixed(2)} frames out)`);
        } else {
            ok(`${wanted.length} note events, in the pattern's order, each within a sample of its step`);
        }
        console.log(`    worst error ${worst.toFixed(4)} frames, at step ${worstStep} - ` +
                    `${(worst / stepFrames * 100).toFixed(4)}% of a step`);
        console.log(`    the last event is at frame ${last.frame}, its step at ` +
                    `${lastExact.toFixed(2)} - ${lastError.toFixed(4)} frames out after ` +
                    `${totalSteps} steps`);
        console.log(`    (a scheduler that added the step to a running position instead of ` +
                    `recomputing it would be ${(totalSteps * (Math.round(stepFrames) - stepFrames)).toFixed(1)} ` +
                    'frames out by now)');
    }

    // ---- 1b. the loop point: the second pass starts one period after the first, not one step
    console.log('');
    console.log('The loop point - two passes, not one:');

    // The pad is the part that exercises this: its chord is held to the pattern's last step, so its
    // wrap entry is the only one that is not empty, and the loop point is the only place it fires.
    const pad = tune.find((p) => p.id === 'pad');
    const held = pad.off[pad.steps];
    if (!held.length) fail('no part holds a note across the loop point, so nothing here tests it');

    const loopProcessor = await blankProcessor();
    const loopReady = await loadInto(loopProcessor, engine);
    loopProcessor.loadPreset(presetForRole('pad', loopReady.presetNames));

    globalThis.currentFrame = 0;
    const loopLog = instrument(loopProcessor);
    await loopProcessor.port.deliver({
        type: 'setPattern',
        data: { on: pad.on, off: pad.off, stepFrames, epochFrame: 0 },
    });

    // Exactly short of the end of the second pass, so what is in the log is the two passes and not
    // the boundary after them.
    const passes = 2;
    run(loopProcessor, loopLog, Math.floor((passes * totalSteps * stepFrames) / QUANTUM), null);

    // What two passes ask for: the pattern, and then the pattern again with step 0 one period later.
    // The wrap entry is not a step of its own - the notes a pass leaves sounding close as the next
    // pass begins, which is the frame step 0 opens on - so they come first, on step 0's own frame.
    const round = [];
    for (let pass = 0; pass < passes; pass++) {
        for (let s = 0; s < totalSteps; s++) {
            const frame = (pass * totalSteps + s) * stepFrames;
            if (s === 0 && pass > 0) for (const note of held) round.push({ kind: 'off', note, frame });
            for (const note of pad.off[s]) round.push({ kind: 'off', note, frame });
            for (const note of pad.on[s]) round.push({ kind: 'on', note, frame });
        }
    }

    const playedRound = loopLog.events
        .filter((e) => e.kind !== 'allOff' && e.frame < passes * totalSteps * stepFrames);
    let loopDiff = -1;
    for (let i = 0; i < Math.max(playedRound.length, round.length); i++) {
        const p = playedRound[i];
        const w = round[i];
        // the order within a step is the step's own - the gates it closes, then the notes it opens -
        // and so is the tolerance: at or after the boundary, less than a frame past it
        if (!p || !w || p.kind !== w.kind || p.note !== w.note ||
            p.frame < w.frame || p.frame >= w.frame + 1) {
            loopDiff = i;
            break;
        }
    }

    const show = (e) => (e ? `${e.kind} ${e.note} at frame ${typeof e.frame === 'number' ? e.frame.toFixed(2) : e.frame}` : '-');

    if (loopDiff >= 0) {
        fail(`over two passes, event ${loopDiff} is ` +
             `${playedRound[loopDiff] ? show(playedRound[loopDiff]) : 'nothing'}` +
             ` where the pattern asks for ${round[loopDiff] ? show(round[loopDiff]) : 'nothing'}` +
             ` (${playedRound.length} played, ${round.length} asked for)`);
        for (let i = Math.max(0, loopDiff - 2); i < Math.min(playedRound.length, loopDiff + 3); i++) {
            console.log(`      ${i}: played ${show(playedRound[i])}   wanted ${show(round[i])}`);
        }
    } else {
        ok(`${round.length} note events over two passes, the second on the first pass's own frames ` +
           `plus exactly one period`);
    }

    // The one number the extra entry in `on` moved: where the second pass's step 0 is, measured from
    // where the first pass's step 0 was. Indexing by `on.length` instead of the step count puts it a
    // step late, which is the skipped beat - and one more step every loop after that.
    const downbeat = totalSteps * stepFrames;
    const onsPerPass = pad.on.slice(0, totalSteps).reduce((n, entry) => n + entry.length, 0);
    const secondPass = loopLog.events.filter((e) => e.kind === 'on')[onsPerPass];
    if (!secondPass) {
        fail('the second pass never opened a note - the loop did not come round');
    } else {
        const error = secondPass.frame - downbeat;
        if (error < 0 || error >= 1) {
            fail(`the second pass's step 0 is at frame ${secondPass.frame}, ${error.toFixed(2)} frames ` +
                 `from one period (${downbeat.toFixed(2)}) - ${(error / stepFrames).toFixed(2)} steps ` +
                 'out after a single loop');
        } else {
            console.log(`    pass 2's step 0 is at frame ${secondPass.frame}, one period ` +
                        `(${downbeat.toFixed(2)}) after pass 1's - ${error.toFixed(4)} frames out`);
        }

        // and the notes the pass ended holding close on that same frame, before step 0's own ons -
        // one event, not a step, which is what keeps them from being a silent sixteenth
        const before = loopLog.events[loopLog.events.indexOf(secondPass) - 1];
        if (!before || before.kind !== 'off' || before.frame !== secondPass.frame) {
            fail(`the ${held.length} notes held to the end of the pass are not released on the frame ` +
                 `the next one begins on (the event before step 0 is ${
                     before ? `${before.kind} at frame ${before.frame}` : 'nothing'})`);
        } else {
            ok(`the ${held.length} notes held to the end close on that same frame, before step 0 ` +
               'opens its own');
        }
    }

    // ---- 2. the render blocks add up to the quantum, every time
    const perQuantum = new Map();
    for (const block of log.blocks) {
        perQuantum.set(block.quantum, (perQuantum.get(block.quantum) || 0) + block.frames);
    }
    const bad = [...perQuantum].filter(([, frames]) => frames !== QUANTUM);
    const splits = log.blocks.length - quanta;
    if (bad.length) {
        fail(`${bad.length} quanta did not render exactly ${QUANTUM} frames ` +
             `(first: quantum ${bad[0][0]}, ${bad[0][1]} frames)`);
    } else {
        ok(`every one of ${perQuantum.size} quanta rendered exactly ${QUANTUM} frames ` +
           `across ${log.blocks.length} blocks - the steps split ${splits} of them`);
    }
    if (log.blocks.some((b) => b.frames < 1) || log.blocks.some((b) => b.frames > QUANTUM)) {
        fail('a render block was empty or longer than a quantum');
    }
    if (splits === 0) fail(`no quantum was split at a step boundary, so the steps were not sample-accurate`);

    // ---- 3. it made a sound
    const rms = Math.sqrt(energy / (quanta * QUANTUM));
    if (rms === 0) fail('the worklet rendered silence');
    else ok(`and it sounds: rms ${rms.toFixed(4)} over ${(quanta * QUANTUM / SAMPLE_RATE).toFixed(1)} s`);

    // ---- 4. a node joining mid-tune lands in time, with the current step already sounding
    console.log('');
    console.log('A node joining a tune already in progress:');

    const joiner = await blankProcessor();
    await loadInto(joiner, engine);
    globalThis.currentFrame = 0;
    const joinLog = instrument(joiner);

    // the tune began 100000 frames ago - 15.55 steps in, so step 15 is the one in progress
    const epoch = -100000;
    await joiner.port.deliver({
        type: 'setPattern',
        data: { ...step, epochFrame: epoch },
    });

    const inProgress = Math.floor((0 - epoch) / stepFrames);       // 15
    const expectedStep = inProgress % totalSteps;                  // 15
    const soundingThen = bass.on.slice(0, expectedStep + 1).flat();
    const articulated = joinLog.events.filter((e) => e.kind === 'on').map((e) => e.note);

    if (articulated.length !== soundingThen.length ||
        !articulated.every((n, i) => n === soundingThen[i])) {
        fail(`joining at step ${expectedStep} articulated ${JSON.stringify(articulated)}, ` +
             `and the notes held are ${JSON.stringify(soundingThen)}`);
    } else {
        ok(`joining at step ${expectedStep} re-articulated exactly the notes still held ` +
           `(${articulated.join(', ')})`);
    }

    run(joiner, joinLog, 200);
    const after = joinLog.events.filter((e) => e.kind === 'on' && e.frame > 0);
    const firstStep = expectedStep + 1;
    const firstExact = epoch + firstStep * stepFrames;
    if (!after.length) {
        fail('a joined node never played another note');
    } else {
        const error = after[0].frame - firstExact;
        if (error < 0 || error >= 1) {
            fail(`its next note is at frame ${after[0].frame}, and step ${firstStep} of the tune ` +
                 `is at ${firstExact.toFixed(2)} - ${error.toFixed(2)} frames out`);
        } else {
            ok(`its next note lands on the tune's own step ${firstStep}, not on its own bar one ` +
               `(frame ${after[0].frame}, step at ${firstExact.toFixed(2)})`);
        }
    }

    // ---- 5. stop means stopped
    console.log('');
    console.log('Stop:');

    const before = joinLog.events.length;
    await joiner.port.deliver({ type: 'stop' });
    const stopped = joinLog.events.filter((e) => e.kind === 'allOff').length;
    run(joiner, joinLog, 400);

    const during = joinLog.events.slice(before).filter((e) => e.kind === 'on' || e.kind === 'off');
    if (stopped < 1) fail('stop did not release what was sounding');
    else if (during.length) {
        fail(`stop left the transport running: ${during.length} note events after it`);
    } else {
        ok('stop released everything sounding and fires no further notes');
    }

    // ---- 6. a note played by hand reaches the engine
    console.log('');
    console.log('Playing by hand:');

    const hand = await blankProcessor();
    await loadInto(hand, engine);
    globalThis.currentFrame = 0;
    const handLog = instrument(hand);
    await hand.port.deliver({ type: 'noteOn', data: { note: 64, velocity: 100 } });
    await hand.port.deliver({ type: 'noteOff', data: { note: 64 } });
    const handOn = handLog.events.filter((e) => e.kind === 'on' && e.note === 64).length;
    const handOff = handLog.events.filter((e) => e.kind === 'off' && e.note === 64).length;
    if (handOn !== 1 || handOff !== 1) {
        fail(`a note played by hand reached the engine ${handOn} times on and ${handOff} off`);
    } else {
        ok('a note played by hand starts and stops once, with no transport running');
    }

    // ---- 7. the order the page actually starts a part in
    //
    // init() hands a part its pattern before the context has told it the step length, so that
    // message carries stepFrames 0; Play then sends the epoch. It used to send only the epoch, so
    // the worklet never armed its transport and Play produced nothing at all - the page showed its
    // loop length and made no sound until an engine was swapped, which re-sent the pattern with a
    // step length known by then. A frame position and a step length are one fact, and this is the
    // check that they arrive together.
    console.log('');
    console.log('A part started the way the page starts one:');

    const page = await blankProcessor();
    const pageReady = await loadInto(page, engine);
    page.loadPreset(presetForRole('bass', pageReady.presetNames));
    globalThis.currentFrame = 0;
    const pageLog = instrument(page);

    await page.port.deliver({ type: 'setPattern', data: { ...step, stepFrames: 0 } });
    run(page, pageLog, 20);
    const beforePlay = pageLog.events.filter((e) => e.kind === 'on' || e.kind === 'off').length;
    if (beforePlay) {
        fail(`a part given a pattern but no transport played ${beforePlay} notes before Play`);
    }

    const startAt = globalThis.currentFrame + QUANTUM * 2;
    await page.port.deliver({ type: 'setTransport', data: { epochFrame: startAt, stepFrames } });
    run(page, pageLog, 60);
    const fromPlay = pageLog.events.filter((e) => e.kind === 'on');

    if (!fromPlay.length) {
        fail('Play started nothing: the pattern arrived without a step length and the transport ' +
             'arrived without one either, so the engine was never armed');
    } else {
        const error = fromPlay[0].frame - startAt;
        if (error < 0 || error >= 1) {
            fail(`after Play the first note is at frame ${fromPlay[0].frame} and step 0 is at ` +
                 `${startAt} - ${error.toFixed(2)} frames out`);
        } else {
            ok(`Play starts the part on step 0's own frame (${fromPlay[0].frame}, step at ` +
               `${startAt}), with ${beforePlay} notes before it`);
        }
    }

    // ---- 8. a new tune handed to a part that is stopped
    //
    // Switching tunes while the page is stopped hands every part a new pattern and no transport,
    // and the part it is handed to has played before - it still holds the step length of the tune
    // it was playing. A worklet that kept that step length and armed itself against the epoch it
    // was given (0) would start playing from wherever currentFrame had got to, firing every onset
    // of the new tune between then and now on one frame. `joiner` is exactly that part: it has
    // played the tune and been stopped.
    console.log('');
    console.log('A new tune handed to a part that is stopped:');

    const lead = tune.find((p) => p.id === 'lead');
    const swapMark = joinLog.events.length;

    await joiner.port.deliver({
        type: 'setPattern',
        data: { on: lead.on, off: lead.off, stepFrames: 0, epochFrame: 0 },
    });
    run(joiner, joinLog, 400);

    const silent = joinLog.events.slice(swapMark).filter((e) => e.kind === 'on' || e.kind === 'off');
    if (silent.length) {
        fail(`a pattern handed to a stopped part started it playing: ${silent.length} note ` +
             `events with no transport sent`);
    } else {
        ok('a pattern handed to a stopped part is held and plays nothing');
    }

    // ...and Play then plays the tune that was swapped in, from that tune's own step 0
    const restartAt = globalThis.currentFrame + QUANTUM * 2;
    const restartMark = joinLog.events.length;
    await joiner.port.deliver({ type: 'setTransport', data: { epochFrame: restartAt, stepFrames } });
    run(joiner, joinLog, 60);

    const restarted = joinLog.events.slice(restartMark).filter((e) => e.kind === 'on');
    if (!restarted.length) {
        fail('Play after a tune was swapped in started nothing');
    } else if (!lead.on[0].includes(restarted[0].note)) {
        fail(`Play after a tune was swapped in started note ${restarted[0].note}, which is not on ` +
             `the new tune's step 0 (${lead.on[0].join(', ')}) - the old pattern is still armed`);
    } else {
        const error = restarted[0].frame - restartAt;
        if (error < 0 || error >= 1) {
            fail(`after a tune was swapped in the first note is at frame ${restarted[0].frame} and ` +
                 `the new tune's step 0 is at ${restartAt} - ${error.toFixed(2)} frames out`);
        } else {
            ok(`Play starts the new tune on its own step 0 (frame ${restarted[0].frame}, step at ` +
               `${restartAt})`);
        }
    }

    processor.mod._regroove_synth_destroy(processor.handle);

    report();
}

function report() {
    console.log('');
    if (failures.length) {
        console.log(`${RED}${failures.length} failure${failures.length === 1 ? '' : 's'}${NC}`);
        for (const f of failures) console.log(`  ${f}`);
        process.exit(1);
    }
    console.log(`${GREEN}the worklet plays the tune on the sample, joins in time, and stops${NC}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(`${RED}workletcheck: ${err && err.stack ? err.stack : err}${NC}`);
    process.exit(1);
});
