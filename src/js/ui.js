// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The tune page's controls: the transport, what is playing, the Random button, and the table of
// parts.
//
// There is one set of engine selectors, and every row is its own. Random is an action over them and
// not a mode, so nothing here has to decide which rows are linked to which: it is always none of
// them.
//
// The rows are built from src/js/parts.js's LAYOUT rather than from the song, so changing the tune
// changes the notes and the engines and never the table: the four rows a visitor is looking at do not
// disappear and come back because a different file is playing.
//
// This module is the tune page's and nothing else. The audition page has its own
// (src/js/audition-ui.js), because the two look up different ids and a module shared between them
// could not be checked for that - pagecheck attributes a module's getElementById calls to every
// page that imports it, which is exactly right and which a shared module makes useless.
//
// Nothing here reports a failure itself. A file that is not a MIDI file and a tune that will not load
// both arrive as a rejected promise, and `onError` - which the page supplies, and which owns the
// footer's error line - says so: that keeps the ids this module looks up to the ones it renders.
//
// Rendering is driven by the player's own state rather than by the events that changed it, so a
// swap that takes a moment (four modules loading) cannot leave the controls describing a state the
// audio is not in.

import { LAYOUT } from './parts.js';
import { TUNES } from './tunes/index.js';
import { syncOptions } from './select.js';

/** The value the picker holds while a file a visitor chose is what is playing. */
const FILE_OPTION = '__file__';

/** "3 notes", "1 note" - the counts below are all read as English, not as "3 note(s)". */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * What a loaded file had to have done to it, in the page's own words.
 *
 * Every one of these is a decision src/js/smf.js made about a file that was not quite what the page
 * assumes - notes off the grid, events it could not place, a tempo that changes mid-file. Said only
 * when it is not zero, the same rule the sample-rate warning follows: a line that lists four zeroes
 * every time is a line nobody reads.
 */
function notesAbout(song) {
    const said = [];
    if (song.snapped) said.push(`${count(song.snapped, 'note', 'notes')} moved onto the grid`);
    if (song.dropped) said.push(`${count(song.dropped, 'event', 'events')} dropped`);
    if (song.unmapped) said.push(`${count(song.unmapped, 'voice', 'voices')} with nowhere to go`);
    if (song.tempoChanges) said.push(`${count(song.tempoChanges, 'tempo change', 'tempo changes')} ignored`);
    return said;
}

export function createUI(player, { onError = () => {} } = {}) {
    const els = {
        play: document.getElementById('play'),
        status: document.getElementById('transport-status'),
        random: document.getElementById('random'),
        parts: document.getElementById('parts'),
        rate: document.getElementById('rate-note'),
        tune: document.getElementById('tune'),
        tuneFile: document.getElementById('tune-file'),
    };

    // ---- the parts table, built once: four rows, each with an engine and a preset
    const rows = new Map();
    for (const part of LAYOUT) {
        const row = document.createElement('div');
        row.className = 'row';

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = part.label;

        const picks = document.createElement('div');
        picks.className = 'picks';

        // Named for a screen reader and not on the page. A row reads "Bass [ANALOG] [BASS 1]
        // [Mute]", and one list holds engine names and the other preset names, so which is which is
        // the list itself. Four rows of the words "Engine" and "Preset" are eight words that say
        // nothing the two lists do not.
        const engine = document.createElement('select');
        engine.setAttribute('aria-label', `${part.label} engine`);
        const preset = document.createElement('select');
        preset.setAttribute('aria-label', `${part.label} preset`);
        picks.append(engine, preset);

        const mute = document.createElement('button');
        mute.type = 'button';
        mute.className = 'secondary';
        mute.textContent = 'Mute';
        mute.setAttribute('aria-pressed', 'false');
        picks.append(mute);

        row.append(name, picks);
        els.parts.append(row);

        engine.addEventListener('change', () => player.assign(part.id, engine.value));
        preset.addEventListener('change', () => player.setPreset(part.id, Number(preset.value)));

        mute.addEventListener('click', () => {
            const node = player.parts.get(part.id);
            player.setMuted(part.id, !node.muted);
        });

        rows.set(part.id, { row, engine, preset, mute });
    }

    // ---- the transport and the Random button
    els.play.addEventListener('click', () => player.toggle());
    els.random.addEventListener('click', () => player.randomEngines());

    // ---- what plays: a tune out of the picker, or a file a visitor brings
    els.tune.addEventListener('change', () => {
        const id = els.tune.value;
        if (id === FILE_OPTION) return;         // the entry that describes a file, not one that is a tune
        player.selectTune(id).catch(onError);
    });

    els.tuneFile.addEventListener('change', () => {
        const file = els.tuneFile.files && els.tuneFile.files[0];
        // Cleared straight away, before the file is read: a file input's value can only be emptied,
        // and leaving it set would put a stale filename next to a tune the picker is now showing -
        // and, worse, would make choosing the same file twice fire no change event at all.
        els.tuneFile.value = '';
        if (file) player.loadMidiFile(file).catch(onError);
    });

    // The page is only ever given these once the first tune is loaded, so wiring them is also what
    // makes them usable; see the note in src/index.html.
    els.tune.disabled = false;
    els.tuneFile.disabled = false;

    // ---- render
    function render(p) {
        els.play.textContent = p.playing ? 'Stop' : 'Play';

        // The tune's own facts, not the page's: the tempo, the grid and how long the loop is all come
        // out of the MIDI file, so saying them is how a visitor - and whoever put the file there - can
        // see what is playing. 128 steps of sixteenths at 112 BPM is a 17 s loop; the same tune on a
        // triplet grid would say so here instead.
        //
        // All of them are known as soon as the file is read, and none of them can be changed from this
        // page - so the line is the same stopped as playing, rather than something a visitor has to
        // press Play to be told.
        els.status.textContent = p.grid
            ? [p.tuneName, `${p.totalSteps} steps`, p.grid, `${p.bpm.toFixed(2)} BPM`,
               `${p.secondsPerLoop.toFixed(0)} s loop`, ...notesAbout(p.song)].join(' · ')
            : '';

        // The tunes the page has, and - when that is what is playing - the file instead of a tune.
        // A pure function of the player's own state, which is what keeps the list from being rebuilt
        // on every render: see src/js/select.js.
        const tuneItems = TUNES.map((tune) => ({ value: tune.ID, label: tune.LABEL }));
        if (p.source?.kind === 'file') tuneItems.push({ value: FILE_OPTION, label: p.source.name });
        syncOptions(els.tune, tuneItems, p.source?.kind === 'file' ? FILE_OPTION : p.source?.id || '');

        const engineItems = p.engines.map((e) => ({ value: e.slug, label: e.name }));

        for (const part of p.tune) {
            const ui = rows.get(part.id);
            const node = p.parts.get(part.id);
            if (!ui || !node) continue;

            syncOptions(ui.engine, engineItems, node.engine ? node.engine.slug : '');
            syncOptions(
                ui.preset,
                node.presetNames.map((name, i) => ({ value: String(i), label: name })),
                node.presetIndex,
            );

            ui.engine.disabled = !node.engine;
            ui.preset.disabled = !node.presetNames.length;

            const muted = node.muted;
            ui.mute.setAttribute('aria-pressed', String(muted));
            ui.mute.textContent = muted ? 'Muted' : 'Mute';
        }

        // Only when it is wrong. Felucca's tables are generated for 48 kHz and nothing resamples, so
        // a browser that would not give us 48000 plays every engine 8.8% flat - which is worth
        // saying. Where it gave us 48000 there is nothing to say, and an empty <p> is hidden.
        if (els.rate) {
            els.rate.textContent = p.rateIsExact
                ? ''
                : `${p.actualSampleRate} Hz — these engines are built for 48000, so they will play flat`;
        }
    }

    player.onChange = render;
    render(player);

    return { render };
}
