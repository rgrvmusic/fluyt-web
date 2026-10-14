#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Fluyt web - the browser preview of Felucca's engines as Fluyt units.
// Copyright (C) 2026 Gerard Braad (Regroove | RGRV).
//
// Check the page itself: that every module in src/ parses and its imports resolve, that every file
// a page asks the browser for exists, and that every element a script looks up by id is in the
// markup. Run with `make check`, or `node tools/pagecheck.mjs`.
//
// smoke.mjs and tunecheck.mjs exercise the engines and the tune, and between them they load
// src/js/pattern.js and src/js/tune.js and nothing else. Everything the page is built out of - the
// player, the UI, the keyboard, the worklet, the two entry points - is never executed by either of
// them, and a mistake in it does not fail anything: it shows up as a blank page in a browser, in
// front of a visitor, on a page whose whole job is to look like it works.
//
// The three checks here are the ones worth having for that layer:
//
//   * every module parses, and every relative import in it names a file that exists. A module is
//     imported rather than merely parsed, because a missing import is an error the parser cannot
//     see - and importing also tells a syntax error from the ReferenceError the browser globals
//     raise, which is what a module that is fine throws when it is evaluated outside a browser.
//   * every url a page asks for - script, stylesheet, and the worklet the module graph loads by
//     constructing its own url - resolves to a file.
//   * every id a script looks up is in the markup. This is the silent one: getElementById returns
//     null for a typo and the null only surfaces at the first click.
//   * every name a module uses that another module exports is imported by it. Also silent, because
//     a use inside a method body throws only when that method runs - player.js applied MASTER_GAIN
//     for a whole build without importing it, which no other check here could have caught.

import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

// A url a page or a module asks for is resolved against the tree the browser reads, which is dist/
// - the page is dist/index.html and dist/js/fluyt.js at runtime, not src/. But dist/ is copied from
// src/ and is not committed, so both are searched: the answer "it is in src/, and the build copies
// it" is as good as "it is in dist/", and it is the answer on a tree that has not been built.
const ROOTS = [SRC, DIST];

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const NC = '\u001b[0m';

const failures = [];
const fail = (what) => {
    failures.push(what);
    console.log(`  ${RED}✗${NC} ${what}`);
};

// The two pages, and the module each one starts from.
const PAGES = [
    { html: 'index.html', entry: 'js/iframe-app.js' },
    { html: 'keyboard.html', entry: 'js/keyboard-app.js' },
];

/** Every .js under src/, as paths relative to src/. */
async function jsFiles(dir = SRC, prefix = '') {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) found.push(...await jsFiles(path.join(dir, entry.name), rel));
        else if (entry.name.endsWith('.js')) found.push(rel);
    }
    return found.sort();
}

/** The relative specifiers a module imports, in source order. */
function importsOf(code) {
    const specifiers = [];
    const re = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;])import\s*['"]([^'"]+)['"]/gm;
    for (const m of code.matchAll(re)) {
        const spec = m[1] || m[2] || m[3];
        if (spec) specifiers.push(spec);
    }
    return specifiers;
}

/**
 * The code with every comment blanked out, in place, so offsets are preserved - and, unless
 * `strings` is 'keep', every string body with them.
 *
 * A name that appears only in a comment or a log message is not a use of it, and without this the
 * check below would be reading prose. Quotation marks are kept so that an import specifier is still
 * a string; what is between them is spaces.
 *
 * The runtime urls are the other way round: what they are looking for *is* a string, so they keep
 * them and ask only that the comments go - a url written about in a comment is not a url the page
 * asks for.
 */
function stripLiterals(code, { strings = 'blank' } = {}) {
    const blank = (s) => s.replace(/[^\n]/g, ' ');
    let out = '';
    let i = 0;
    while (i < code.length) {
        const c = code[i];
        const next = code[i + 1];
        if (c === '/' && next === '/') {
            const end = code.indexOf('\n', i);
            const stop = end === -1 ? code.length : end;
            out += blank(code.slice(i, stop));
            i = stop;
        } else if (c === '/' && next === '*') {
            const end = code.indexOf('*/', i + 2);
            const stop = end === -1 ? code.length : end + 2;
            out += blank(code.slice(i, stop));
            i = stop;
        } else if (c === "'" || c === '"' || c === '`') {
            let j = i + 1;
            while (j < code.length && code[j] !== c) {
                if (code[j] === '\\') j++;
                j++;
            }
            const body = code.slice(i + 1, Math.min(j, code.length));
            out += c + (strings === 'keep' ? body : blank(body)) + (j < code.length ? c : '');
            i = Math.min(j + 1, code.length);
        } else {
            out += c;
            i++;
        }
    }
    return out;
}

/** Whether `name` is used as a value - not as a property, and not as an object literal's key. */
function usesValue(code, name) {
    const re = new RegExp(`(?<![.\\w$])${name}(?![\\w$])`, 'g');
    for (const m of code.matchAll(re)) {
        const after = code.slice(m.index + name.length);
        const before = code.slice(0, m.index);
        // `{ NAME: ... }` names a key rather than using the binding. A ternary's `? NAME :` does use
        // it, which is what the lookbehind rules out.
        if (/^\s*:/.test(after) && !/\?\s*$/.test(before.slice(-2))) continue;
        return true;
    }
    return false;
}

/**
 * Whether `name` could be bound somewhere in this file: declared, imported, a parameter, a catch
 * binding, or assigned to.
 *
 * Deliberately generous, because the two mistakes are not equally bad: a false "yes" here only
 * means this check stays quiet about a name it could have caught, and the checks above still cover
 * the file. A false "no" would fail a build over correct code.
 */
function looksBound(code, name) {
    return [
        `\\b(?:const|let|var)\\s+${name}\\b`,
        `\\b(?:const|let|var)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`,
        `\\b(?:const|let|var)\\s*\\[[^\\]]*\\b${name}\\b[^\\]]*\\]`,
        `\\b(?:const|let|var)\\b[^;{}]*?,\\s*${name}\\s*=`,
        `\\b(?:async\\s+)?function\\s*\\*?\\s*${name}\\b`,
        `\\bclass\\s+${name}\\b`,
        `\\bimport\\b[^;]*\\b${name}\\b[^;]*\\bfrom\\b`,
        `\\bcatch\\s*\\(\\s*${name}\\b`,
        `[(,]\\s*${name}\\s*[,)]\\s*(?:=>|\\{)`,
        `\\b${name}\\s*(?:=[^=]|\\+=|-=)`,
        `\\b(?:get|set|static)\\s+${name}\\b`,
        `\\bexport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`,
    ].some((pattern) => new RegExp(pattern).test(code));
}

/** The local names a module's import statements bind. */
function importedNames(code) {
    const names = new Set();
    const importRe = /\bimport\s+([^'"]*?)\s*from\s*['"][^'"]*['"]|\bimport\s*['"][^'"]*['"]/g;
    for (const m of code.matchAll(importRe)) {
        const clause = m[1];
        if (!clause) continue;
        for (const braces of clause.matchAll(/\{([^}]*)\}/g)) {
            for (const part of braces[1].split(',')) {
                const name = part.trim().split(/\s+as\s+/).pop().trim();
                if (name) names.add(name);
            }
        }
        const rest = clause.replace(/\{[^}]*\}/g, ' ').replace(/\bimport\b/g, ' ');
        const star = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(rest);
        if (star) names.add(star[1]);
        for (const token of rest.replace(/\*\s+as\s+[A-Za-z_$][\w$]*/g, ' ').split(/[\s,]+/)) {
            if (/^[A-Za-z_$][\w$]*$/.test(token) && token !== 'as') names.add(token);
        }
    }
    return names;
}

/** Every name src/ exports, and the module that exports it. */
function exportedNames(code) {
    const exported = new Map();
    const keep = (name, rel) => { if (!exported.has(name)) exported.set(name, rel); };
    for (const [rel, text] of code) {
        const bare = stripLiterals(text);
        for (const m of bare.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g)) {
            keep(m[1], rel);
        }
        for (const m of bare.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
            for (const part of m[1].split(',')) {
                const name = part.trim().split(/\s+as\s+/).pop().trim();
                if (/^[A-Za-z_$][\w$]*$/.test(name)) keep(name, rel);
            }
        }
    }
    return exported;
}

const exists = async (p) => {
    try { await stat(p); return true; } catch { return false; }
};

/**
 * The urls a module builds for itself at runtime, as paths relative to that module.
 *
 * `new URL('../worklet/fluyt-worklet.js', import.meta.url)` is the form; the other is a url
 * assembled out of the module's own constants - `new URL(`../${TUNE_FILE}`, import.meta.url)` -
 * which is how a module asks for a file whose name it also publishes. Those constants are
 * substituted here, so what is checked is the file that is named rather than the shape of the
 * expression that names it. A name that is not one of the module's own string constants is left as
 * it was, and will simply not resolve.
 */
function runtimeUrls(text) {
    const values = new Map();
    for (const m of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']*)'/g)) {
        values.set(m[1], m[2]);
    }

    const urls = [];
    for (const m of stripLiterals(text, { strings: 'keep' })
        .matchAll(/new URL\(\s*['"`]([^'"`]+)['"`]\s*,\s*import\.meta\.url\s*\)/g)) {
        urls.push(m[1].replace(/\$\{([A-Za-z_$][\w$]*)\}/g,
            (whole, name) => (values.has(name) ? values.get(name) : whole)));
    }
    return urls;
}

/**
 * Whether a url, relative to a module or page at `from` under src/, resolves in either tree.
 *
 * A url ending in `/` is a directory the build produces rather than one that is in the source -
 * `dist/wasm/` is where build-wasm.sh leaves the modules - so it is only asked of dist/, and a
 * tree that has not been built skips it rather than reporting it missing. Every other url is a
 * file that is either in src/ or copied there from it by `make`, which is why both are searched.
 */
async function resolves(from, url) {
    const dir = url.endsWith('/');
    for (const root of (dir ? [DIST] : ROOTS)) {
        if (dir && !await exists(root)) continue;   // not built yet: nothing to say about it
        if (await exists(path.resolve(root, from, url))) return true;
    }
    return dir && !await exists(DIST) ? null : false;   // null: unbuilt, neither present nor absent
}

async function main() {
    console.log('========================================');
    console.log('Fluyt page - modules, urls and ids');
    console.log('========================================');

    const files = await jsFiles();
    console.log('');
    console.log(`Modules in src/ (${files.length}):`);

    const code = new Map();
    for (const rel of files) code.set(rel, await readFile(path.join(SRC, rel), 'utf8'));

    for (const rel of files) {
        // importing rather than parsing: a bad import specifier is not a syntax error, and this is
        // the only way to catch it. A module that is fine throws a ReferenceError here, because
        // `document` and `window` do not exist outside a browser - which is the expected outcome
        // for the app modules and is not a failure.
        try {
            await import(pathToFileURL(path.join(SRC, rel)).href);
            console.log(`  ${GREEN}✓${NC} ${rel}`);
        } catch (err) {
            if (err?.name === 'SyntaxError' || err?.code === 'ERR_MODULE_NOT_FOUND' ||
                err?.code === 'ERR_UNSUPPORTED_DIR_IMPORT') {
                fail(`${rel}: ${err.message.split('\n')[0]}`);
            } else {
                // evaluated and reached for a browser global, or threw from a worklet's
                // registerProcessor - it parsed, and everything it imports resolved
                console.log(`  ${GREEN}✓${NC} ${rel}  (parses; wants a browser: ${err?.constructor?.name})`);
            }
        }
    }

    // every relative import names a file that exists. The import above already proves this for the
    // specifiers it followed, but it reports one missing file per run; this names all of them.
    console.log('');
    console.log('Imports resolve:');
    let checked = 0;
    for (const [rel, text] of code) {
        for (const spec of importsOf(text)) {
            if (!spec.startsWith('.')) continue;
            checked++;
            const target = path.resolve(path.dirname(path.join(SRC, rel)), spec);
            if (!await exists(target)) fail(`${rel}: imports ${spec}, which is not there`);
        }
    }
    console.log(`  ${GREEN}✓${NC} ${checked} relative imports, all present`);

    // the urls a page asks for, and the urls a module builds for itself
    console.log('');
    console.log('Files the pages ask for:');

    for (const page of PAGES) {
        const html = await readFile(path.join(SRC, page.html), 'utf8');

        if (!await exists(path.join(SRC, page.entry))) {
            fail(`${page.html}: no ${page.entry}`);
            continue;
        }

        const wanted = [
            ...[...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]),
            ...[...html.matchAll(/<link[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]),
        ];

        for (const url of wanted) {
            if (/^[a-z]+:/i.test(url) || url.startsWith('//')) continue;   // absolute, not ours
            if (!await resolves('', url)) fail(`${page.html}: asks for ${url}, which is not there`);
        }
        console.log(`  ${GREEN}✓${NC} ${page.html}: ${wanted.length} urls, all present`);
    }

    // The files a module builds its own url for at runtime, out of import.meta.url: the worklet, and
    // the tune's MIDI file. Nothing in the markup names either of them, so they are looked for here.
    // A url is relative to the module that asks for it, and resolves under src/ (the .mid, which is
    // committed) or under dist/ (the worklet, which the build copies there) - `resolves` answers for
    // both, and for a tree that has not been built.
    console.log('');
    console.log('Files the modules ask for at runtime:');

    let runtime = 0;
    for (const [rel, text] of code) {
        const urls = runtimeUrls(text);
        if (!urls.length) continue;

        const missing = [];
        let unbuilt = false;
        for (const url of urls) {
            const found = await resolves(path.dirname(rel), url);
            if (found === false) missing.push(url);
            else if (found === null) unbuilt = true;
        }

        for (const url of missing) fail(`${rel}: loads ${url} at runtime, which is not there`);
        runtime += urls.length;

        if (!missing.length) {
            const note = unbuilt ? ' (dist/ is not built yet, so one of them is unchecked)' : '';
            console.log(`  ${GREEN}✓${NC} ${rel}: ${urls.length} url` +
                        `${urls.length === 1 ? '' : 's'} built at runtime, all there${note}`);
        }
    }

    // every id a script looks up is in the markup of the page that runs it
    console.log('');
    console.log('Ids the scripts look up:');

    for (const page of PAGES) {
        const html = await readFile(path.join(SRC, page.html), 'utf8');
        const inMarkup = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

        // the entry point and everything it imports, transitively - the ids a page's own modules
        // reach for are the ones that page has to carry
        const seen = new Set();
        const queue = [page.entry];
        const ids = new Map();
        while (queue.length) {
            const rel = queue.pop();
            if (seen.has(rel) || !code.has(rel)) continue;
            seen.add(rel);
            const text = code.get(rel);
            for (const m of text.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
                if (!ids.has(m[1])) ids.set(m[1], rel);
            }
            for (const spec of importsOf(text)) {
                if (spec.startsWith('.')) {
                    queue.push(path.relative(SRC, path.resolve(SRC, path.dirname(rel), spec)));
                }
            }
        }

        let missing = 0;
        for (const [id, rel] of ids) {
            if (!inMarkup.has(id)) {
                fail(`${page.html}: ${rel} looks up #${id}, which the page does not have`);
                missing++;
            }
        }
        if (!missing) {
            console.log(`  ${GREEN}✓${NC} ${page.html}: ${ids.size} ids across ${seen.size} modules, all in the markup`);
        }
    }

    // A module that uses a name another module exports and never imports it. None of the checks
    // above can see this one: the page parses, every import resolves, every id is in the markup, and
    // the module even evaluates, because the use is inside a method body - so the first sign of it
    // is a ReferenceError in front of a visitor at the moment that method runs. Which is exactly
    // what happened: player.js applied MASTER_GAIN through a whole build without importing it, and
    // the page showed "The engines could not be loaded: MASTER_GAIN is not defined".
    //
    // A free variable is not decidable without a parser. A name that is an export of this tree, used
    // without being imported or bound anywhere in the file, is - and that is the shape this mistake
    // takes, because the name was there to be used precisely because something else exports it.
    console.log('');
    const exported = exportedNames(code);
    console.log(`Names crossing between modules (${exported.size} exported across src/):`);

    for (const [rel, text] of code) {
        const bare = stripLiterals(text);
        const imported = importedNames(text);
        for (const [name, from] of exported) {
            if (from === rel) continue;                              // its own export
            if (imported.has(name)) continue;                        // imported: the normal case
            if (!usesValue(bare, name)) continue;                    // not used here at all
            if (looksBound(bare, name)) continue;                    // bound locally, shadowing
            fail(`${rel}: uses ${name}, which ${from} exports and ${rel} does not import`);
        }
    }
    if (!failures.some((f) => f.includes('does not import'))) {
        console.log(`  ${GREEN}✓${NC} every exported name used in another module is imported there`);
    }

    console.log('');
    if (failures.length) {
        console.log(`${RED}${failures.length} failure${failures.length === 1 ? '' : 's'}${NC}`);
        for (const f of failures) console.log(`  ${f}`);
        process.exit(1);
    }
    console.log(`${GREEN}the page parses, its files are there, and its ids exist${NC}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(`${RED}pagecheck: ${err && err.stack ? err.stack : err}${NC}`);
    process.exit(1);
});
