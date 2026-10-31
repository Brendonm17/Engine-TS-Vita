// Bundles the single-player server into one IIFE for QuickJS.
// Run from the engine dir: node sp/build.mjs
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// provided by the host
const nodeBuiltins = [
    'fs', 'net', 'path', 'os', 'crypto', 'worker_threads', 'zlib', 'module',
    'http', 'https', 'stream', 'buffer', 'url', 'util', 'events', 'tls', 'dns',
    'child_process', 'assert', 'process', 'perf_hooks', 'v8', 'cluster',
    'timers', 'diagnostics_channel', 'readline', 'fs/promises'
];

// native packages, provided by the host's C ports
const hostProvided = ['@2004scape/rsmod-pathfinder', '@2004scape/rsbuf'];

const externalizePlugin = {
    name: 'externalize-host',
    setup(build) {
        const isExternal = (p) =>
            p === 'bun' || p.startsWith('bun:') ||
            p.startsWith('node:') ||
            nodeBuiltins.includes(p) ||
            hostProvided.includes(p);
        build.onResolve({ filter: /.*/ }, (args) => {
            if (isExternal(args.path)) {
                return { path: args.path, external: true };
            }
            return null;
        });
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
            '#/server/Metrics.js': path.join(engineDir, 'sp/stub-metrics.js')
        },
        plugins: [externalizePlugin],
        // syntax only, identifiers and whitespace are kept
        minifySyntax: true,
        define: { __dirname: '""', __filename: '""' },
        logLevel: 'info',
        metafile: true,
        outfile: path.join(engineDir, 'sp/server.bundle.js')
    });
    const out = Object.values(result.metafile.outputs)[0];
    console.log(`BUNDLE OK  bytes=${out.bytes}  warnings=${result.warnings.length}`);
} catch (e) {
    console.log('BUNDLE FAILED');
    process.exit(1);
}
