// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The transport, the four parts, and the two ways of choosing what they play: a tune from
// src/js/tunes/, or a MIDI file a visitor brings.
//
// The clock is an epoch frame - the absolute frame at which step 0 of the current pass began -
// rather than a timer. The worklet compares it against the AudioContext's own currentFrame, so the
// notes land on the sample the transport says and a node built halfway through a bar joins where
// the bar already is. A setTimeout here would drift against the audio clock, and it would drift
// differently on each of the four parts.
//
// A tune changing while the page is stopped is the case the whole swap is shaped around: the parts
// are built once and then handed new notes, the notes go over before the transport does (so nothing
// can be armed against a tune that is on its way out), and a page that was playing stops and starts
// again rather than being left half in one tune and half in the next. See setSong.

import { presetForRole } from './parts.js';
import { compileMidi, loadTune, DEFAULT_TUNE_ID } from './tune.js';
import { tuneById } from './tunes/index.js';
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
 * engines loaded, instanced and never heard. The default tune's file is still read whole, so what a
 * tune is is the same on both pages; it is the parts that are not built.
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
        this.song = null;

        // What is playing. A bundled tune is `{kind: 'tune', id}` and a file a visitor brought is
        // `{kind: 'file', name}`, which is everything the page needs to name it and to know which of
        // the two it is looking at - see get tuneName, and ui.js, which builds the picker from it.
        this.source = null;

        this.playing = false;

        this.epochFrame = 0;
        this.stepFrames = 0;
        this.sampleRate = 48000;

        // Building the parts and loading four engines calls emit() many times over; the page renders
        // once, when the swap that does all of it is finished. See setSong.
        this.quiet = false;
    }

    get totalSteps() {
        return this.tune.length ? this.tune[0].steps : 0;
    }

    get secondsPerLoop() {
        return (this.totalSteps * this.stepFrames) / this.sampleRate;
    }

    /** The tempo the tune's file carries, which is what the transport is running at. */
    get bpm() {
        return this.song ? this.song.bpm : 0;
    }

    /**
     * What is playing, named the way the page shows it: a bundled tune's own name, or the name of
     * the file a visitor chose. Empty before anything has been chosen, which is what the picker and
     * the status line render from rather than a blank they would have to guard.
     */
    get tuneName() {
        if (!this.source) return '';
        if (this.source.kind === 'file') return this.source.name;
        const notation = tuneById(this.source.id);
        return notation ? notation.LABEL : this.source.id;
    }

    /** Whether the engine on `partId` is already the one `slug` names - what setSong compares. */
    engineIs(partId, slug) {
        const engine = this.engineFor(partId);
        return Boolean(engine) && engine.slug === slug;
    }

    /**
     * The grid the file landed on - "sixteenths", or one of the five others in src/js/smf.js.
     *
     * The page says which one, because it is the file's and not a constant: the same page plays a
     * tune of straight sixteenths and one of 16th-note triplets, and the step is a different length
     * of music in each. `snapped` is how many notes had to be moved onto it, which is 0 for every
     * file that is on a grid at all - and worth saying out loud when it is not.
     */
    get grid() {
        return this.song ? this.song.grid : '';
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
        this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
        this.sampleRate = this.ctx.sampleRate;

        // One bus for the four parts. They are each at roughly full scale on their own and the
        // page sums them, so the trim that keeps the sum inside full scale belongs here and not on
        // any one part. See src/js/mix.js for the number and how it was arrived at.
        this.master = this.ctx.createGain();
        this.master.gain.value = MASTER_GAIN;
        this.master.connect(this.ctx.destination);

        this.engines = await loadEngines();

        // The tune itself is a MIDI file (src/tune/), and the facts the transport needs come out of
        // it: the page does not assume a tempo or a step, it reads the one the music has. Opening
        // the page is the same swap as changing the tune, so it is the same code that does it.
        await this.selectTune(DEFAULT_TUNE_ID);
        return this;
    }

    // -------------------------------------------------------------------------------- the tune

    /**
     * Play a bundled tune - one out of src/js/tunes/ - and give the parts the engines it was written
     * for.
     *
     * The file is fetched and compiled before anything is touched, so a tune that fails to load
     * leaves what is playing alone. The rule the whole page keeps, and the README states: a bundled
     * tune brings its own engines, and a file a visitor loads keeps the ones already on screen.
     */
    async selectTune(id) {
        const notation = tuneById(id);
        if (!notation) throw new Error(`${id} is not one of the tunes the page has`);

        const song = await loadTune(id);
        await this.setSong(song, { source: { kind: 'tune', id }, engines: notation.ENGINES });
    }

    /**
     * Play a MIDI file a visitor brought, on the engines that are already there.
     *
     * The bytes are read and compiled before setSong is called, and that order is the point: a file
     * that is not a MIDI file throws here, while the tune that is playing is still playing, rather
     * than stopping the page and then discovering it has nothing to put in its place.
     */
    async loadMidiFile(file) {
        const song = compileMidi(new Uint8Array(await file.arrayBuffer()));
        await this.setSong(song, { source: { kind: 'file', name: file.name } });
    }

    /**
     * Play `song` instead - the one place a tune changes, for both paths above.
     *
     * The order is load-bearing, and it is:
     *
     *   1. stop, if anything was playing, so every part is disarmed and released before its notes
     *      are replaced;
     *   2. the new song, its step length and its parts onto this object and onto every part - notes
     *      only, with no transport, which the worklet holds without playing;
     *   3. only then the engines, awaited, because setEngine builds a new node and hands it the
     *      pattern the part is holding. Assigning first would push the *outgoing* tune's notes into
     *      the new node; not awaiting would let play() post a transport to a node that is about to
     *      be replaced;
     *   4. play again, if it was playing - one epoch for every part together, so the loop restarts
     *      at the top of the new tune rather than at whatever phase the old one was in. Which is the
     *      only honest thing to do when the new tune's step length and length are both its own.
     *
     * `engines` is a map of part id to slug - a bundled tune's own. Left out, the parts keep what
     * they have, which is what a loaded file does.
     */
    async setSong(song, { source = null, engines = null } = {}) {
        this.quiet = true;

        const wasPlaying = this.playing;
        if (wasPlaying) this.stop();

        this.source = source;
        this.song = song;
        this.tune = this.auditionOnly
            ? song.parts.filter((part) => part.id === AUDITION_PART)
            : song.parts;

        // a step is whatever the file's own grid is, at the exact fractional length the tempo works
        // out to - not rounded, because rounding it would put the loop out of phase with the beat
        this.stepFrames = (this.sampleRate * 60) / (song.bpm * (song.stepsPerBar / 4));

        // The parts are built once, the first time there is a song to build them from, and every
        // tune after that is new notes handed to the same nodes - which is what makes a swap a swap
        // and not a rebuild.
        for (const part of this.tune) {
            let node = this.parts.get(part.id);
            if (!node) {
                node = new Part(this.ctx, this.cache, { id: part.id, role: part.role }, this.master);
                this.parts.set(part.id, node);
            }
            node.setPattern(part);
        }

        if (engines) {
            await Promise.all(this.tune
                .filter((part) => !this.engineIs(part.id, engines[part.id]))
                .map((part) => this.assign(part.id, engines[part.id], { presetIndex: null })));
        }

        this.quiet = false;
        this.emit();

        if (wasPlaying) await this.play();
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
