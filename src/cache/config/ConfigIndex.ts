import fs from 'fs';

import Jagfile from '#/io/Jagfile.js';
import Packet from '#/io/Packet.js';

// random access into a packed config .dat through its .idx
export default class ConfigIndex {
    readonly data: Uint8Array;
    readonly offsets: Int32Array; // count + 1 entries
    readonly count: number;

    constructor(dat: Uint8Array, idx: Uint8Array) {
        const idxPacket: Packet = new Packet(idx);
        const count: number = idxPacket.g2();
        const datCount: number = new Packet(dat).g2();
        if (count !== datCount || idx.length < 2 + count * 2) {
            throw new Error(`config index does not match its data (${count} vs ${datCount})`);
        }

        const offsets: Int32Array = new Int32Array(count + 1);
        let pos: number = 2;
        for (let id: number = 0; id < count; id++) {
            offsets[id] = pos;
            pos += idxPacket.g2();
        }
        offsets[count] = pos;
        if (pos !== dat.length) {
            throw new Error(`config index does not span its data (${pos} vs ${dat.length})`);
        }

        this.data = dat;
        this.offsets = offsets;
        this.count = count;
    }

    entry(id: number): Packet {
        return new Packet(this.data.subarray(this.offsets[id], this.offsets[id + 1]));
    }

    // debug name -> id, scanned without decoding
    names(): Map<string, number> {
        const map: Map<string, number> = new Map();
        const data: Uint8Array = this.data;
        for (let id: number = 0; id < this.count; id++) {
            const start: number = this.offsets[id];
            const end: number = this.offsets[id + 1] - 1; // 0 terminator
            if (end <= start + 1 || data[end] !== 0 || data[end - 1] !== 10) {
                continue;
            }
            const nl: number = end - 1;
            let k: number = nl - 1;
            while (k >= start && data[k] >= 0x20 && data[k] < 0x7f) {
                k--;
            }
            if (k < start || data[k] !== 250 || k + 1 >= nl) {
                continue;
            }
            map.set(String.fromCharCode.apply(null, data.subarray(k + 1, nl) as unknown as number[]), id);
        }
        return map;
    }
}

export type ConfigPair = {
    server: ConfigIndex;
    client: ConfigIndex | null;
};

// server and client indexes for one config type, null if either is missing
export function openConfigIndex(serverIdxPath: string, server: Packet, jag: Jagfile | null, clientDat: string | null, clientIdx: string | null): ConfigPair | null {
    if (!fs.existsSync(serverIdxPath)) {
        return null;
    }
    try {
        const serverIndex: ConfigIndex = new ConfigIndex(server.data, Packet.load(serverIdxPath).data);
        let clientIndex: ConfigIndex | null = null;
        if (jag && clientDat && clientIdx) {
            const dat: Packet | null = jag.read(clientDat);
            const idx: Packet | null = jag.read(clientIdx);
            if (!dat || !idx) {
                return null;
            }
            clientIndex = new ConfigIndex(dat.data, idx.data);
            if (clientIndex.count !== serverIndex.count) {
                return null;
            }
        }
        return { server: serverIndex, client: clientIndex };
    } catch (_) {
        return null;
    }
}
