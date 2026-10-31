import fs from 'fs';

import Packet from '#/io/Packet.js';

// client packs served at runtime, with their CRC and length
export const PRELOADED = new Map<string, Uint8Array>();
export const PRELOADED_CRC = new Map<string, number>();
export const PRELOADED_LEN = new Map<string, number>();

const MAPS_DIR = 'data/pack/client/maps';
const SONGS_DIR = 'data/pack/client/songs';
const JINGLES_DIR = 'data/pack/client/jingles';

// with a native host CRC only crc and length are kept, files load on demand
type HostCrc = (path: string) => [number, number] | null;
function hostCrc(): HostCrc | null {
    const host = (globalThis as any).__host;
    return host && typeof host.fileCrc32 === 'function' ? (host.fileCrc32 as HostCrc) : null;
}

function preloadDir(dir: string, keepData: boolean): void {
    const crcNative = hostCrc();
    const names = fs.readdirSync(dir);
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const path = `${dir}/${name}`;

        if (crcNative && !keepData) {
            const res = crcNative(path);
            if (res) {
                PRELOADED_CRC.set(name, res[0]);
                PRELOADED_LEN.set(name, res[1]);
            }
            continue;
        }

        const data = new Uint8Array(fs.readFileSync(path));
        const crc = crcNative ? (crcNative(path)?.[0] ?? Packet.getcrc(data, 0, data.length)) : Packet.getcrc(data, 0, data.length);

        PRELOADED.set(name, data);
        PRELOADED_CRC.set(name, crc);
        PRELOADED_LEN.set(name, data.length);
    }
}

export function preloadClient() {
    const lean = hostCrc() !== null;
    preloadDir(MAPS_DIR, !lean);
    preloadDir(SONGS_DIR, !lean);
    // jingles are always kept
    preloadDir(JINGLES_DIR, true);
}

// pack bytes, read from disk if only the CRC was kept
export function getPreloaded(name: string): Uint8Array | undefined {
    const cached = PRELOADED.get(name);
    if (cached) {
        return cached;
    }
    const dir = name.endsWith('.mid') ? SONGS_DIR : MAPS_DIR;
    const path = `${dir}/${name}`;
    if (!fs.existsSync(path)) {
        return undefined;
    }
    return new Uint8Array(fs.readFileSync(path));
}
