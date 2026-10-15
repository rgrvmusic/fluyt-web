// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The four parts the page has, and which preset of an engine each one takes.
//
// These are the page's facts and not a tune's. A tune is notes - it says what is played, and nothing
// about what plays it - and this table is the four things those notes can land on: a bass, a lead, a
// pad and a kit, in the order the page shows them. src/js/smf.js matches a track of a file to one of
// these by name (falling back to the channel, and then to their order), and src/js/tune.js checks
// that every tune has something to say to each of them, so the two cannot disagree about how many
// parts there are or what they are called.

/**
 * The parts, in the order they are built, shown and written to the file.
 *
 * `id` is the part's name everywhere: in the notation, in the MIDI track that carries it, and as the
 * key src/js/player.js holds its node under. `role` is what a preset is chosen by, and it is
 * deliberately not the id: it says what the part is *for* rather than what it is called, so a tune
 * that renames a part - or a fifth part that is a second lead - still gets the sound the page means.
 */
export const LAYOUT = [
    { id: 'bass', label: 'Bass', role: 'bass' },
    { id: 'lead', label: 'Lead', role: 'lead' },
    { id: 'pad', label: 'Pad', role: 'pad' },
    { id: 'drums', label: 'Drums', role: 'drum' },
];

/**
 * Which preset of a loaded engine a part should use.
 *
 * Preset indices are not comparable across engines - ANALOG's 3 is not TRIO's 3 - and they move
 * when an engine gains a preset, so nothing here is a number. The names come from the module at
 * runtime, so this cannot disagree with the firmware; and the list is ordered, so the first match
 * wins and the earlier patterns are the more literal ones. Falling back to 0 is not a mistake to
 * hide: an engine with nothing bass-like in it plays its first sound, which is what a preview of
 * that engine should do.
 */
const ROLE_PATTERNS = {
    bass: [/BASS/i, /SUB/i, /WOW/i],
    lead: [/LEAD/i, /ACID/i, /PLUCK/i, /BELL/i, /WIRE/i, /RESO/i, /SOLO/i],
    pad: [/PAD/i, /^STR/i, /STRING/i, /CHOIR/i, /ORGAN/i, /BRASS/i, /WIND/i, /RAIN/i],
    drum: [/DRUM/i, /KIT/i, /PERC/i],
};

export function presetForRole(role, presetNames) {
    const patterns = ROLE_PATTERNS[role] || [];
    for (const pattern of patterns) {
        const index = presetNames.findIndex((name) => pattern.test(name));
        if (index >= 0) return index;
    }
    return 0;
}
