// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The tune page's controls: the transport, the Random button, and the table of parts.
//
// There is one set of engine selectors, and every row is its own. Random is an action over them and
// not a mode, so nothing here has to decide which rows are linked to which: it is always none of
// them.
//
// This module is the tune page's and nothing else. The audition page has its own
// (src/js/audition-ui.js), because the two look up different ids and a module shared between them
// could not be checked for that - pagecheck attributes a module's getElementById calls to every
// page that imports it, which is exactly right and which a shared module makes useless.
//
// Rendering is driven by the player's own state rather than by the events that changed it, so a
// swap that takes a moment (four modules loading) cannot leave the controls describing a state the
// audio is not in.

import { syncOptions } from './select.js';

export function createUI(player) {
    const els = {
        play: document.getElementById('play'),
        status: document.getElementById('transport-status'),
        random: document.getElementById('random'),
        parts: document.getElementById('parts'),
        rate: document.getElementById('rate-note'),
    };

    // ---- the parts table, built once: four rows, each with an engine and a preset
    const rows = new Map();
    for (const part of player.tune) {
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

    // ---- render
    function render(p) {
        els.play.textContent = p.playing ? 'Stop' : 'Play';
        els.status.textContent = p.playing ? `${p.secondsPerLoop.toFixed(0)} s loop` : '';

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
