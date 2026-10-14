// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// One function, in its own module because both pages' controls need it and they share nothing else.
// It is here rather than in ui.js so that the audition page does not import the tune page's
// controls to get it: a module's getElementById calls belong to the page that imports it, and one
// module serving two pages with different markup cannot be checked that way.

/**
 * Fill a <select> without disturbing it.
 *
 * Rewriting a select's options on every render would close it if it were open and drop focus if it
 * had it, and the player renders on every engine change. So the options are only rebuilt when the
 * list itself differs - by a signature of what would be written - and the value is set separately,
 * which is cheap and does not touch the DOM's structure.
 */
export function syncOptions(select, items, value) {
    const signature = items.map((i) => `${i.value}\u0000${i.label}`).join('\u0001');
    if (select.dataset.signature !== signature) {
        select.textContent = '';
        for (const item of items) {
            const option = document.createElement('option');
            option.value = item.value;
            option.textContent = item.label;
            if (item.disabled) option.disabled = true;
            select.append(option);
        }
        select.dataset.signature = signature;
    }
    if (select.value !== String(value)) select.value = String(value);
}
