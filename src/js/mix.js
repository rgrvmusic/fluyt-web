// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// The level decision, in one place, because both the page and the check have to make it: the page
// applies MASTER_GAIN to the bus every part plays into, and tools/tunecheck.mjs imports the same
// number to prove that what the page does cannot clip.
//
// Why there is a master trim at all. Each engine arrives at roughly full scale on its own - an
// engine's own peak is around 0.5 to 0.7 of full scale, measured in tunecheck - and the page plays
// four parts at once. Four of those summed measure a peak of 1.689, which is not a mix that is
// slightly loud, it is one that is clipped on every backbeat.
//
// Why it is a trim and not a limiter. This page exists so a visitor can hear what an engine sounds
// like, and a compressor on the master bus changes exactly what they came to hear - the punch of a
// kick, the attack of a bass. A fixed trim changes the level and nothing else.
//
// Why 0.35. It is measured, not chosen: the check's worst case is the sum of the loudest peak each
// part reaches over all nine engines, and the loudest tune is the one that decides it. That is the
// chiptune, at 0.606 + 0.671 + 0.731 + 0.729 = 2.737 - no combination of engines on any part of any
// tune can exceed it, so a trim of 0.35 leaves the worst mix this page can reach at 0.958 of full
// scale: inside full scale, with 4% to spare. It is the narrowest margin here and that tune earns it,
// striking its bass on every one of its 128 steps and its kit 164 times; the next worst are the bossa
// at 2.671 (0.935) and the house at 2.644 (0.925), and the quietest is the ballad at 2.400 (0.840).
//
// What the page *opens* on is lower than any of those, because a tune is also which engines it named:
// 0.604 on the shanty and 0.641 on the ballad - the highest of the six, since FORMANT's three voice
// presets all sit near 0.6 - and between 0.453 and 0.516 on the other four.
//
// tunecheck asserts that sum against this number rather than trusting it, per tune, so a future tune
// or preset that is louder than the ones measured fails the check and asks for this to be revisited,
// instead of arriving as a clipped preview.

export const MASTER_GAIN = 0.35;
