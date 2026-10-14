// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The transport, the four parts, and the two ways of choosing an engine: per part, or one engine
// across the melodic parts at a time.
//
// The clock is an epoch frame - the absolute frame at which step 0 of the current pass began -
// rather than a timer. The worklet compares it against the AudioContext's own currentFrame, so the
// notes land on the sample the transport says and a node built halfway through a bar joins where
// the bar already is. A setTimeout here would drift against the audio clock, and it would drift
// differently on each of the four parts.

import { BPM, STEPS_PER_BAR, compileTune, presetForRole, DEFAULT_ENGINES } from './tune.js';
import { Part, ModuleCache, loadEngines } from './fluyt.js';
import { MASTER_GAIN } from './mix.js';

// The parts that carry pitch, and so the parts one engine can be heard across. DRUM is deliberately
// not one of them: it is the only engine here whose notes are a kit rather than pitches, it is the
// tune's pulse, and replacing it is not a way to hear an engine - it is a way to stop hearing the
// tune.
const MELODIC = ['bass', 'lead', 'pad'];

// The part the keyboard and a MIDI controller play through. It is the lead, because that is the
// part a visitor would reach for, and it is one of the melodic parts - so the engine being
// auditioned is chosen in the same place as the engine playing the tune, and no second engine is
// loaded just to be played by hand.
const AUDITION_PART = 'lead';

/**
 * `auditionOnly` builds just the part a visitor plays by hand - the keyboard page.
 *
 * That page has no transport and never runs the tune, so the other three parts would be three
 * engines loaded, instanced and never heard. The tune is still compiled whole, so the notation is
 * checked either way; it is the parts that are not built.
 */
export class Player {
    constructor({ onChange = () => {}, auditionOnly = false } = {}) {
        this.auditionOnly = auditionOnly;
        this.cache = new ModuleCache();
        this.onChange = onChange;

        this.ctx = null;
        this.engines = [];
        this.parts = new Map();
        this.tune = [];

        this.playing = false;

        this.epochFrame = 0;
        this.stepFrames = 0;
        this.sampleRate = 48000;

        // Loading four engines calls emit() four times; the page renders once, at the end of init.
        this.quiet = false;
    }

    get totalSteps() {
        return this.tune.length ? this.tune[0].steps : 0;
    }

    get secondsPerLoop() {
        return (this.totalSteps * this.stepFrames) / this.sampleRate;
    }

    /**
     * The context this page needs is 48000 Hz, not the default.
     *
     * Felucca's tables are generated for 48 kHz (tools/gen-tables.sh) and fluyt_init only records
     * the rate it is handed - nothing resamples. A context at 44.1 kHz would therefore play
     * everything 8.8% flat and slow, which is the exact error regenerating the tables for the
     * drumlogue exists to avoid. So the rate is asked for, and `actualSampleRate` reports what the
     * browser gave back rather than what was asked for.
     */
    async init() {
        this.quiet = true;

        this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
        this.sampleRate = this.ctx.sampleRate;

        // One bus for the four parts. They are each at roughly full scale on their own and the
        // page sums them, so the trim that keeps the sum inside full scale belongs here and not on
        // any one part. See src/js/mix.js for the number and how it was arrived at.
        this.master = this.ctx.createGain();
        this.master.gain.value = MASTER_GAIN;
        this.master.connect(this.ctx.destination);

        this.engines = await loadEngines();
        this.tune = compileTune();
        if (this.auditionOnly) this.tune = this.tune.filter((part) => part.id === AUDITION_PART);

        // a sixteenth note, at the exact fractional length the tempo works out to - not rounded,
        // because rounding it would put the loop gradually out of phase with the beat
        this.stepFrames = (this.sampleRate * 60) / (BPM * (STEPS_PER_BAR / 4));

        for (const part of this.tune) {
            const node = new Part(this.ctx, this.cache, { id: part.id, role: part.role }, this.master);
            node.setPattern(part);
            this.parts.set(part.id, node);
        }

        // Every part gets its engine before anything is played, so the first Play is not four
        // modules loading one after another.
        await Promise.all(this.tune.map((part) => {
            const slug = DEFAULT_ENGINES[part.id] || this.engines[0].slug;
            return this.assign(part.id, slug, { presetIndex: null });
        }));

        this.quiet = false;
        this.emit();
        return this;
    }

    get actualSampleRate() {
        return this.ctx ? this.ctx.sampleRate : 0;
    }

    get rateIsExact() {
        return this.actualSampleRate === 48000;
    }

    engineFor(partId) {
        const part = this.parts.get(partId);
        return part ? part.engine : null;
    }

    engineBySlug(slug) {
        return this.engines.find((e) => e.slug === slug) || null;
    }

    /**
     * Put `slug`'s engine on `partId`. `presetIndex` of null means the part takes its role's preset
     * from the new engine's own list; a number means that preset of that engine.
     */
    async assign(partId, slug, { presetIndex = null } = {}) {
        const engine = this.engineBySlug(slug);
        const part = this.parts.get(partId);
        if (!engine || !part) return null;

        const role = part.role;
        const info = await part.setEngine(engine, {
            choosePreset: presetIndex === null
                ? (names) => presetForRole(role, names)
                : () => presetIndex,
        });

        this.emit();
        return info;
    }

    // ------------------------------------------------------------------------------- transport

    async play() {
        if (this.playing) return;

        // A context created before a user gesture starts suspended, and resuming is what the click
        // that got here is for.
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        // Start a little ahead, so the first step is not already in the past by the time the
        // message reaches four worklets.
        this.epochFrame = Math.round((this.ctx.currentTime + 0.12) * this.sampleRate);
        this.playing = true;

        for (const part of this.parts.values()) {
            part.setTransport(this.epochFrame, this.stepFrames);
        }
        this.emit();
    }

    stop() {
        if (!this.playing) return;
        this.playing = false;
        for (const part of this.parts.values()) part.stop();
        this.emit();
    }

    async toggle() {
        if (this.playing) this.stop();
        else await this.play();
    }

    // ---------------------------------------------------------------------------- the Random button

    /**
     * Give each melodic part its own engine, drawn at random and all different from each other.
     *
     * Three different ones rather than one engine across all three. Sharing one engine answers "what
     * does this engine sound like", but this button is what a visitor presses to hear something new,
     * and three rows already showing the same engine is not that - it is the thing they just
     * pressed it to get away from. Drawing without replacement is what makes a press audible as a
     * new combination every time, and it means a few presses have been over most of the nine.
     *
     * Each part keeps its role's preset, because "the lead preset" and "the bass preset" are
     * different sounds of whatever engine lands there - which is how a bass engine is recognisable
     * as one.
     *
     * DRUM is never one of them: it is the only engine here whose notes are a kit rather than
     * pitches, it is the tune's pulse, and randomising it is a way to stop hearing the tune rather
     * than a way to hear an engine.
     */
    async randomEngines() {
        const pool = [...this.engines];

        await Promise.all(MELODIC.map((partId) => {
            const part = this.parts.get(partId);
            // a page that builds only the audition part has the other melodic parts absent, not empty
            if (!part || !pool.length) return null;

            const engine = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
            return part.setEngine(engine, {
                choosePreset: (names) => presetForRole(part.role, names),
            });
        }));

        this.emit();
    }

    // ---------------------------------------------------------------------------------- presets

    setPreset(partId, index) {
        const part = this.parts.get(partId);
        if (!part) return;
        part.loadPreset(index);
        this.emit();
    }

    setMuted(partId, muted) {
        const part = this.parts.get(partId);
        if (!part) return;
        part.setMuted(muted);
        this.emit();
    }

    // ------------------------------------------------------------------------------ live playing

    /** The part a visitor plays by hand, or null on a page that does not build it. */
    get audition() {
        return this.parts.get(AUDITION_PART) || null;
    }

    /** The engine the keyboard plays. */
    setAuditionEngine(slug) {
        return this.assign(AUDITION_PART, slug);
    }

    /** The preset of it. */
    setAuditionPreset(index) {
        this.setPreset(AUDITION_PART, index);
    }

    noteOn(note, velocity) {
        const part = this.parts.get(AUDITION_PART);
        if (part) part.noteOn(note, velocity);
    }

    noteOff(note) {
        const part = this.parts.get(AUDITION_PART);
        if (part) part.noteOff(note);
    }

    allNotesOff() {
        for (const part of this.parts.values()) part.allNotesOff();
    }

    emit() {
        if (!this.quiet) this.onChange(this);
    }
}
