// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The tunes the page offers, in the order it offers them.
//
// One module per tune, each exporting the same handful of facts: the notation, the tempo, the grid,
// the engines it was written for, and where its file is. Adding a tune is adding a module here and a
// line to TUNES - nothing in the page, the player or the tools knows how many there are, and every
// one of them walks this list rather than naming a tune of its own.

import * as shanty from './shanty.js';
import * as synthpop from './synthpop.js';

export const TUNES = [shanty, synthpop];

/** The tune the page opens on, and the one every tool reads by default. */
export const DEFAULT_TUNE_ID = shanty.ID;

/** The tune with this id, or undefined - an id that is not here is not a tune, not an empty one. */
export function tuneById(id) {
    return TUNES.find((tune) => tune.ID === id);
}
