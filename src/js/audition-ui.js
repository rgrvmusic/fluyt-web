// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The audition page's controls: one engine, one preset, and nothing else. There is no tune and no
// transport here, so there is no table of parts and nothing to start.

import { syncOptions } from './select.js';

/**
 * The keyboard page's controls: one engine, one preset, and nothing else.
 *
 * That page is for playing an engine by hand, so it gets the one voice being played rather than the
 * tune's four-part table - and no transport, because there is no tune there to start. Two labelled
 * selectors are not the noise four rows of them were: they appear once, and they are the only thing
 * on the page that is not a keyboard.
 */
export function createAuditionUI(player) {
    const els = {
        engine: document.getElementById('engine'),
        preset: document.getElementById('preset'),
        rate: document.getElementById('rate-note'),
    };

    els.engine.addEventListener('change', () => player.setAuditionEngine(els.engine.value));
    els.preset.addEventListener('change', () => player.setAuditionPreset(Number(els.preset.value)));

    function render(p) {
        const part = p.audition;
        if (!part) return;

        syncOptions(els.engine, p.engines.map((e) => ({ value: e.slug, label: e.name })),
                    part.engine ? part.engine.slug : '');
        syncOptions(els.preset, part.presetNames.map((name, i) => ({ value: String(i), label: name })),
                    part.presetIndex);

        els.engine.disabled = !p.engines.length;
        els.preset.disabled = !part.presetNames.length;

        // only when it is wrong: see the note in ui.js
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

