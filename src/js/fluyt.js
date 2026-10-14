// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The engine list, a cache of the module pairs, and one Part - a worklet node with a gain, and the
// swap that replaces the engine under it without a click while the tune is playing.

const WORKLET_URL = new URL('../worklet/fluyt-worklet.js', import.meta.url);
const WASM_BASE = new URL('../wasm/', import.meta.url);

/** The engines this build produced, from dist/wasm/engines.json. */
export async function loadEngines() {
    const res = await fetch(new URL('engines.json', WASM_BASE));
    if (!res.ok) throw new Error(`could not read the engine list (${res.status})`);
    const engines = await res.json();
    if (!Array.isArray(engines) || !engines.length) {
        throw new Error('the engine list is empty - run ./build-wasm.sh');
    }
    return engines;
}

/**
 * The built modules, fetched once each and kept as text and bytes.
 *
 * A pair is about 100 KB and four parts are four engines, so the same engine on two parts is worth
 * not fetching twice - and it is not merely the fetch: the glue is evaluated inside the worklet,
 * and having one copy of the text to send twice is one thing to reason about rather than two.
 */
export class ModuleCache {
    constructor() {
        this.pairs = new Map();
        this.workletAdded = null;
    }

    /** The AudioWorklet is registered once per context, however many parts ask for it. */
    ensureWorklet(ctx) {
        if (!this.workletAdded) {
            this.workletAdded = ctx.audioWorklet.addModule(WORKLET_URL).catch((err) => {
                this.workletAdded = null;   // let the next part try again rather than cache the failure
                throw err;
            });
        }
        return this.workletAdded;
    }

    async load(engine) {
        if (!this.pairs.has(engine.slug)) {
            this.pairs.set(engine.slug, (async () => {
                const jsUrl = new URL(engine.module, WASM_BASE);
                const wasmUrl = new URL(engine.module.replace(/\.js$/, '.wasm'), WASM_BASE);
                const [js, wasm] = await Promise.all([fetch(jsUrl), fetch(wasmUrl)]);
                if (!js.ok || !wasm.ok) {
                    throw new Error(`${engine.name}: could not fetch its module (${js.status}/${wasm.status})`);
                }
                return { jsCode: await js.text(), wasmBytes: await wasm.arrayBuffer() };
            })());
        }
        return this.pairs.get(engine.slug);
    }
}

const SWAP_SECONDS = 0.03;

/**
 * One part of the tune: an AudioWorkletNode playing one engine, into its own GainNode.
 *
 * The gain is not a volume control - it is what makes an engine swap inaudible. A new node is built
 * at gain 0 and only ramped up once it is ready and playing in time, and the old one is ramped down
 * over the same 30 ms before it is disconnected. Nothing is ever connected at a gain that would let
 * a half-initialised node be heard.
 *
 * `output` is where the part goes: the player's master bus, not the destination, because four
 * engines at full scale do not fit in one output. See src/js/mix.js.
 */
export class Part {
    constructor(ctx, cache, { id, role }, output) {
        this.ctx = ctx;
        this.cache = cache;
        this.id = id;
        this.role = role;

        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.gain.connect(output);

        this.node = null;
        this.swapGain = null;        // the node's own gain in the crossfade; a swap replaces both
        this.engine = null;
        this.presetNames = [];
        this.presetIndex = 0;
        this.engineName = '';

        // the transport, kept here so a node swapped in later can be handed the same position
        this.pattern = null;
        this.epochFrame = 0;
        this.stepFrames = 0;

        this.muted = false;
    }

    get targetGain() {
        return this.muted ? 0 : 1;
    }

    /**
     * Play `engine` on this part. Resolves once the new node has reported which engine it is and
     * what presets it has.
     *
     * `choosePreset` is asked only after the module has answered, because that is the first moment
     * the preset names exist: a preset index means nothing across engines, and a name is the only
     * thing that does. The caller supplies the policy (src/js/tune.js has it) so that nothing here
     * has an opinion about what a bass should sound like.
     */
    async setEngine(engine, { choosePreset = null } = {}) {
        const { jsCode, wasmBytes } = await this.cache.load(engine);
        await this.cache.ensureWorklet(this.ctx);

        const node = new AudioWorkletNode(this.ctx, 'fluyt-part', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });

        const swapGain = this.ctx.createGain();
        swapGain.gain.value = 0;
        node.connect(swapGain);
        swapGain.connect(this.gain);

        const info = await new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error(`${engine.name}: the module did not become ready`)),
                10000,
            );
            node.port.onmessage = (event) => {
                const { type, data } = event.data;
                if (type === 'needWasm') {
                    node.port.postMessage({
                        type: 'wasmBytes',
                        data: { jsCode, wasmBytes, sampleRate: this.ctx.sampleRate },
                    });
                } else if (type === 'ready') {
                    clearTimeout(timeout);
                    resolve(data);
                } else if (type === 'error') {
                    clearTimeout(timeout);
                    reject(new Error(`${engine.name}: ${data.message}`));
                }
            };
        });

        const names = info.presetNames || [];

        // The preset is applied before the node is allowed to be heard, so a swap never plays the
        // engine's first preset for 30 ms and then jumps to the one that was asked for.
        const wanted = choosePreset ? choosePreset(names) : this.presetIndex;
        const index = Math.max(0, Math.min(wanted, names.length - 1));
        node.port.postMessage({ type: 'loadPreset', data: { index } });

        if (this.pattern) {
            node.port.postMessage({
                type: 'setPattern',
                data: {
                    on: this.pattern.on,
                    off: this.pattern.off,
                    stepFrames: this.stepFrames,
                    epochFrame: this.epochFrame,
                },
            });
        }

        const oldNode = this.node;
        const oldGain = this.swapGain;

        this.node = node;
        this.swapGain = swapGain;
        this.engine = engine;
        this.presetNames = names;
        this.presetIndex = index;
        this.engineName = info.engineName || engine.name;

        const now = this.ctx.currentTime;
        swapGain.gain.cancelScheduledValues(now);
        swapGain.gain.setValueAtTime(0, now);
        swapGain.gain.linearRampToValueAtTime(1, now + SWAP_SECONDS);

        if (oldGain) {
            oldGain.gain.cancelScheduledValues(now);
            oldGain.gain.setValueAtTime(oldGain.gain.value, now);
            oldGain.gain.linearRampToValueAtTime(0, now + SWAP_SECONDS);
        }

        // The outgoing node is torn down only once it is silent, and its destroy is what stops it
        // mid-note - a node disconnected while sounding is a click.
        if (oldNode) {
            const gone = oldNode;
            setTimeout(() => {
                try {
                    gone.port.postMessage({ type: 'allNotesOff' });
                    gone.disconnect();
                    if (oldGain) oldGain.disconnect();
                } catch { /* already gone */ }
            }, SWAP_SECONDS * 1000 + 20);
        }

        this.gain.gain.setTargetAtTime(this.targetGain, now, 0.01);

        return info;
    }

    setMuted(muted) {
        this.muted = muted;
        this.gain.gain.setTargetAtTime(this.targetGain, this.ctx.currentTime, 0.02);
    }

    loadPreset(index) {
        if (!this.node) return;
        this.presetIndex = index;
        this.node.port.postMessage({ type: 'loadPreset', data: { index } });
    }

    setPattern(pattern) {
        this.pattern = pattern;
        if (this.node) {
            this.node.port.postMessage({
                type: 'setPattern',
                data: {
                    on: pattern.on,
                    off: pattern.off,
                    stepFrames: this.stepFrames,
                    epochFrame: this.epochFrame,
                },
            });
        }
    }

    /**
     * Where the tune is, and how long a step is. Both, because a frame position means nothing
     * without the step length and the worklet will not arm its transport until it has one - so
     * sending the epoch alone leaves the engine silent.
     */
    setTransport(epochFrame, stepFrames) {
        this.epochFrame = epochFrame;
        this.stepFrames = stepFrames;
        if (this.node) {
            this.node.port.postMessage({ type: 'setTransport', data: { epochFrame, stepFrames } });
        }
    }

    /** Stop following the transport, and silence whatever is sounding. */
    stop() {
        if (this.node) this.node.port.postMessage({ type: 'stop' });
    }

    // live playing, for the keyboard page and for a MIDI controller
    noteOn(note, velocity = 100) {
        if (this.node) this.node.port.postMessage({ type: 'noteOn', data: { note, velocity } });
    }

    noteOff(note) {
        if (this.node) this.node.port.postMessage({ type: 'noteOff', data: { note } });
    }

    allNotesOff() {
        if (this.node) this.node.port.postMessage({ type: 'allNotesOff' });
    }
}
