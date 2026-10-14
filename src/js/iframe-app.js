// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The iframe page: build the player, wire the shared controls, and press Play once the modules are
// there.
//
// Nothing plays before a click, and that is not a choice: browsers will not start an AudioContext
// until the page has been interacted with, and an iframe that tried to autoplay would be muted by
// the host page anyway. So the first Play is also what resumes the context.

import { Player } from './player.js';
import { createUI } from './ui.js';

const errorLine = document.getElementById('error');
const playButton = document.getElementById('play');

function showError(message) {
    errorLine.textContent = message;
}

playButton.disabled = true;

async function main() {
    const player = new Player();

    try {
        await player.init();
    } catch (err) {
        // The one failure worth naming plainly: nothing is built yet, so there is nothing to play
        // and no partial state to describe.
        playButton.disabled = true;
        showError(`The engines could not be loaded: ${err.message}`);
        return;
    }

    createUI(player);

    // The button stays disabled until every part has an engine, so the first Play is a Play and not
    // a wait for four modules. There is no "loading" state to render in between; init() resolving
    // is the state.
    playButton.disabled = false;
}

main();
