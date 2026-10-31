import fs from 'fs';

import AnimBase from '#/cache/graphics/AnimBase.js';
import OnDemand from '#/engine/OnDemand.js';
import Packet from '#/io/Packet.js';
import { printFatalError } from '#/util/Logger.js';

export default class AnimFrame {
    static instances: AnimFrame[] = [];
    static order: number[] = [];

    delay: number = 0;
    base: number = 0;
    length: number = 0;
    groups: Int32Array = new Int32Array();
    x: Int32Array = new Int32Array();
    y: Int32Array = new Int32Array();
    z: Int32Array = new Int32Array();

    static load() {
        const count = OnDemand.cache.count(2);
        if (!count) {
            printFatalError('Cache not packed');
        }

        for (let i = 0; i < count; i++) {
            const data = OnDemand.cache.read(2, i, true);
            if (data) {
                AnimFrame.unpack(data);
            }
        }
    }

    // frame delays by frame id
    static delays: Int32Array = new Int32Array(0);

    static loadDelays() {
        const count = OnDemand.cache.count(2);
        if (!count) {
            printFatalError('Cache not packed');
        }

        const key = OnDemand.cache.indexChecksum(2);
        if (AnimFrame.readCachedDelays(key)) {
            return;
        }

        const delays: number[] = [];
        for (let i = 0; i < count; i++) {
            const data = OnDemand.cache.read(2, i, true);
            if (data) {
                AnimFrame.scanDelays(data, delays);
            }
        }

        AnimFrame.delays = new Int32Array(delays.length);
        for (let i = 0; i < delays.length; i++) {
            AnimFrame.delays[i] = delays[i] ?? 0;
        }

        AnimFrame.writeCachedDelays(key);
    }

    private static readonly DELAY_CACHE = 'data/cache/anim-delays.dat';
    private static readonly DELAY_CACHE_MAGIC = 0x41444c31; // 'ADL1'

    private static readCachedDelays(key: number): boolean {
        try {
            const raw = fs.readFileSync(AnimFrame.DELAY_CACHE);
            if (!raw || raw.length < 12) {
                return false;
            }

            const buf = new Packet(new Uint8Array(raw));
            if (buf.g4() !== AnimFrame.DELAY_CACHE_MAGIC || (buf.g4() >>> 0) !== key) {
                return false; // stale
            }

            const count = buf.g4();
            if (count < 0 || count > raw.length - 12) {
                return false;
            }

            const delays = new Int32Array(count);
            for (let i = 0; i < count; i++) {
                delays[i] = buf.g1();
            }

            AnimFrame.delays = delays;
            return true;
        } catch (_e) {
            return false;
        }
    }

    private static writeCachedDelays(key: number) {
        try {
            const count = AnimFrame.delays.length;
            const buf = new Packet(new Uint8Array(12 + count));
            buf.p4(AnimFrame.DELAY_CACHE_MAGIC);
            buf.p4(key | 0);
            buf.p4(count);
            for (let i = 0; i < count; i++) {
                buf.p1(AnimFrame.delays[i] & 0xff);
            }

            try {
                fs.mkdirSync('data/cache');
            } catch (_e) {
                // already exists
            }
            fs.writeFileSync(AnimFrame.DELAY_CACHE, buf.data);
        } catch (_e) {
            // read-only data dir
        }
    }

    // read frame ids and delays only, skipping the transform streams
    private static scanDelays(src: Uint8Array, out: number[]) {
        const meta = new Packet(src);
        meta.pos = src.length - 8;

        let offset = 0;
        const head = new Packet(src);
        head.pos = offset;
        offset += meta.g2() + 2;
        offset += meta.g2();
        offset += meta.g2();

        const del = new Packet(src);
        del.pos = offset;

        const total = head.g2();
        for (let i = 0; i < total; i++) {
            const id = head.g2();
            out[id] = del.g1();
            head.g1(); // group count
        }
    }

    static getDelay(id: number): number {
        return AnimFrame.delays[id] ?? 0;
    }

    static unpack(src: Uint8Array) {
        const meta = new Packet(src);
        meta.pos = src.length - 8;

        let offset = 0;
        const head = new Packet(src);
        head.pos = offset;
        offset += meta.g2() + 2;

        const tran1 = new Packet(src);
        tran1.pos = offset;
        offset += meta.g2();

        const tran2 = new Packet(src);
        tran2.pos = offset;
        offset += meta.g2();

        const del = new Packet(src);
        del.pos = offset;
        offset += meta.g2();

        const baseData = new Packet(src);
        baseData.pos = offset;
        const baseId = AnimBase.unpack(baseData);

        const total = head.g2();
        const bases = new Int32Array(500);
        const x = new Int32Array(500);
        const y = new Int32Array(500);
        const z = new Int32Array(500);

        for (let i = 0; i < total; i++) {
            const id = head.g2();
            AnimFrame.order.push(id);

            const frame = new AnimFrame();
            frame.delay = del.g1();
            frame.base = baseId;

            const groupCount = head.g1();
            let lastGroup = -1;
            let length = 0;

            for (let group = 0; group < groupCount; group++) {
                const flags = tran1.g1();
                if (flags === 0) {
                    continue;
                }

                if (AnimBase.instances[baseId].types[group] !== AnimBase.OP_BASE) {
                    for (let cur = group - 1; cur > lastGroup; cur--) {
                        if (AnimBase.instances[baseId].types[cur] === AnimBase.OP_BASE) {
                            bases[length] = cur;
                            x[length] = 0;
                            y[length] = 0;
                            z[length] = 0;
                            length++;
                            break;
                        }
                    }
                }

                bases[length] = group;

                let defaultValue = 0;
                if (AnimBase.instances[baseId].types[group] === AnimBase.OP_SCALE) {
                    defaultValue = 128;
                }

                if ((flags & 0x1) != 0) {
                    x[length] = tran2.gsmart();
                } else {
                    x[length] = defaultValue;
                }

                if ((flags & 0x2) != 0) {
                    y[length] = tran2.gsmart();
                } else {
                    y[length] = defaultValue;
                }

                if ((flags & 0x4) != 0) {
                    z[length] = tran2.gsmart();
                } else {
                    z[length] = defaultValue;
                }

                lastGroup = group;
                length++;
            }

            frame.length = length;
            frame.groups = new Int32Array(length);
            frame.x = new Int32Array(length);
            frame.y = new Int32Array(length);
            frame.z = new Int32Array(length);

            for (let j = 0; j < length; j++) {
                frame.groups[j] = bases[j];
                frame.x[j] = x[j];
                frame.y[j] = y[j];
                frame.z[j] = z[j];
            }

            AnimFrame.instances[id] = frame;
        }
    }
}
