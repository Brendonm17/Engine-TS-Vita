// Bundles the single-player server into one IIFE for QuickJS.
// Run from the engine dir: node sp/build.mjs
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// provided by the host (zlib and ws are shimmed below)
const nodeBuiltins = [
    'fs', 'net', 'path', 'os', 'crypto', 'worker_threads', 'module',
    'http', 'https', 'stream', 'buffer', 'url', 'util', 'events', 'tls', 'dns',
    'child_process', 'assert', 'process', 'perf_hooks', 'v8', 'cluster',
    'timers', 'diagnostics_channel', 'readline', 'fs/promises',
    'sqlite', 'string_decoder', 'querystring', 'async_hooks', 'tty', 'constants'
];

// server-only packages single-player never reaches
const serverOnly = [
    'fastify', '@fastify/static', '@fastify/view', '@fastify/websocket',
    'ejs', 'mysql2', 'kysely', 'jimp', '@jimp/js-png',
    '@jimp/plugin-quantize', '@lostcityrs/runescript'
];

const externalizePlugin = {
    name: 'externalize-host',
    setup(build) {
        const isExternal = (p) =>
            p === 'bun' || p.startsWith('bun:') ||
            p.startsWith('node:') ||
            nodeBuiltins.includes(p) ||
            serverOnly.includes(p);
        build.onResolve({ filter: /.*/ }, (args) => (isExternal(args.path) ? { path: args.path, external: true } : null));

    }
};

try {
    const result = await esbuild.build({
        absWorkingDir: engineDir,
        entryPoints: ['src/sp.ts'],
        bundle: true,
        format: 'iife',
        platform: 'neutral',
        target: 'es2022',
        mainFields: ['module', 'browser', 'main'],
        conditions: ['import', 'browser', 'default'],
        alias: {
            '#/io/BZip2.js': path.join(engineDir, 'sp/stub-bzip2.js'),
            '#/db/query.js': path.join(engineDir, 'sp/stub-query.js'),
            '#/server/Metrics.js': path.join(engineDir, 'sp/stub-metrics.js'),
            zlib: path.join(engineDir, 'sp/shim-zlib.js'),
            ws: path.join(engineDir, 'sp/stub-ws.js'),
            '#/engine/routefinder/index.js': path.join(engineDir, 'sp/shim-routefinder.js')
        },
        plugins: [externalizePlugin],
        // syntax only, identifiers and whitespace are kept
        minifySyntax: true,
        define: {
            __dirname: '""',
            __filename: '""'
        },
        logLevel: 'info',
        metafile: true,
        outfile: path.join(engineDir, 'sp/server.bundle.js')
    });
    const out = Object.values(result.metafile.outputs)[0];
    console.log(`BUNDLE OK  bytes=${out.bytes}  modules=${Object.keys(result.metafile.inputs).length}  warnings=${result.warnings.length}`);
    for (const w of result.warnings.slice(0, 12)) {
        console.log(`  WARN ${w.text}${w.location ? ` (${w.location.file}:${w.location.line})` : ''}`);
    }
} catch (e) {
    console.log('BUNDLE FAILED');
    for (const err of (e.errors ?? []).slice(0, 40)) {
        console.log(`  ERR ${err.text}${err.location ? ` (${err.location.file}:${err.location.line})` : ''}`);
    }
    process.exit(1);
}
