import fs from 'fs';

import Packet from '#/io/Packet.js';

export const CrcBuffer: Packet = new Packet(new Uint8Array(4 * 9));
export let CrcTable: number[] = [];
export let CrcBuffer32: number = 0;

function makeCrc(path: string) {
    if (!fs.existsSync(path)) {
        return;
    }

    // use the host's native CRC when available
    const host = (globalThis as any).__host;
    let crc: number;
    const native = host && typeof host.fileCrc32 === 'function' ? host.fileCrc32(path) : null;
    if (native) {
        crc = native[0];
    } else {
        const packet = Packet.load(path);
        crc = Packet.getcrc(packet.data, 0, packet.data.length);
    }
    CrcTable.push(crc);
    CrcBuffer.p4(crc);
}

export function makeCrcs() {
    CrcTable = [];

    CrcBuffer.pos = 0;
    CrcBuffer.p4(0);
    makeCrc('data/pack/client/title');
    makeCrc('data/pack/client/config');
    makeCrc('data/pack/client/interface');
    makeCrc('data/pack/client/media');
    makeCrc('data/pack/client/models');
    makeCrc('data/pack/client/textures');
    makeCrc('data/pack/client/wordenc');
    makeCrc('data/pack/client/sounds');

    CrcBuffer32 = Packet.getcrc(CrcBuffer.data, 0, CrcBuffer.data.length);
}
