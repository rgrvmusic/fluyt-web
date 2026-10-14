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
// part reaches over all nine engines, which for this tune is 0.574 + 0.573 + 0.630 + 0.734 = 2.511.
// No combination of engines can exceed that, so a trim of 0.35 leaves the page's worst reachable
// mix at 0.879 of full scale - inside full scale with margin, for every engine on every part. What
// the page opens with sits at 0.591.
//
// tunecheck asserts that sum against this number rather than trusting it, so a future preset that
// is louder than the ones measured fails the check and asks for this to be revisited, instead of
// arriving as a clipped preview.

export const MASTER_GAIN = 0.35;
