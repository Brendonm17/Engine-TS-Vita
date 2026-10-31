import fs from 'fs';

import { ConfigType } from '#/cache/config/ConfigType.js';
import { ConfigPair, openConfigIndex } from '#/cache/config/ConfigIndex.js';
import SeqFrame from '#/cache/config/SeqFrame.js';
import Jagfile from '#/io/Jagfile.js';
import Packet from '#/io/Packet.js';

export default class SeqType extends ConfigType {
    private static configNames = new Map<string, number>();
    private static configs: SeqType[] = [];
    // lazy decode index, null when decoded eagerly
    static index: ConfigPair | null = null;

    static load(dir: string) {
        if (!fs.existsSync(`${dir}/server/seq.dat`)) {
            return;
        }

        const server = Packet.load(`${dir}/server/seq.dat`);
        const jag = Jagfile.load(`${dir}/client/config`);
        const index: ConfigPair | null = openConfigIndex(`${dir}/server/seq.idx`, server, jag, 'seq.dat', 'seq.idx');
        if (index) {
            SeqType.index = index;
            SeqType.configNames = index.server.names();
            SeqType.configs = new Array(SeqType.count_(index));
        } else {
            SeqType.index = null;
            this.parse(server, jag);
        }
    }

    private static count_(index: ConfigPair): number {
        return index.server.count;
    }

    static decodeOne(id: number): SeqType {
        const index: ConfigPair = SeqType.index!;
        const config = new SeqType(id);
        config.decodeType(index.server.entry(id));
        if (index.client) {
            config.decodeType(index.client.entry(id));
        }
        return config;
    }

    static parse(server: Packet, jag: Jagfile) {
        SeqType.configNames = new Map();
        SeqType.configs = [];

        const count = server.g2();

        const client = jag.read('seq.dat')!;
        client.pos = 2;

        for (let id = 0; id < count; id++) {
            const config = new SeqType(id);
            config.decodeType(server);
            config.decodeType(client);

            SeqType.configs[id] = config;

            if (config.debugname) {
                SeqType.configNames.set(config.debugname, id);
            }
        }
    }

    static get(id: number): SeqType {
        let config: SeqType | undefined = SeqType.configs[id];
        if (config === undefined && SeqType.index !== null && id >= 0 && id < SeqType.index.server.count) {
            config = SeqType.decodeOne(id);
            SeqType.configs[id] = config;
        }
        return config as SeqType;
    }

    static getId(name: string): number {
        return SeqType.configNames.get(name) ?? -1;
    }

    static getByName(name: string): SeqType | null {
        const id = this.getId(name);
        if (id === -1) {
            return null;
        }

        return this.get(id);
    }

    static get count() {
        return SeqType.configs.length;
    }

    // ----

    frames: Int32Array | null = null;
    iframes: Int32Array | null = null;
    delay: Int32Array | null = null;
    loops: number = -1;
    walkmerge: Int32Array | null = null;
    stretches: boolean = false;
    priority: number = 5;
    replaceheldleft: number = -1;
    replaceheldright: number = -1;
    maxloops: number = 99;

    duration: number = 0;

    decode(code: number, dat: Packet) {
        if (code === 1) {
            const count = dat.g1();
            this.frames = new Int32Array(count);
            this.iframes = new Int32Array(count);
            this.delay = new Int32Array(count);

            for (let i = 0; i < count; i++) {
                this.frames[i] = dat.g2();

                this.iframes[i] = dat.g2();
                if (this.iframes[i] === 65535) {
                    this.iframes[i] = -1;
                }

                this.delay[i] = dat.g2();
                if (this.delay[i] === 0) {
                    this.delay[i] = SeqFrame.instances[this.frames[i]].delay;
                }

                if (this.delay[i] === 0) {
                    this.delay[i] = 1;
                }

                this.duration += this.delay[i];
            }
        } else if (code === 2) {
            this.loops = dat.g2();
        } else if (code === 3) {
            const count = dat.g1();
            this.walkmerge = new Int32Array(count + 1);

            for (let i = 0; i < count; i++) {
                this.walkmerge[i] = dat.g1();
            }

            this.walkmerge[count] = 9999999;
        } else if (code === 4) {
            this.stretches = true;
        } else if (code === 5) {
            this.priority = dat.g1();
        } else if (code === 6) {
            this.replaceheldleft = dat.g2();
        } else if (code === 7) {
            this.replaceheldright = dat.g2();
        } else if (code === 8) {
            this.maxloops = dat.g1();
        } else if (code === 250) {
            this.debugname = dat.gjstr();
        } else {
            throw new Error(`Unrecognized seq config code: ${code}`);
        }
    }
}
