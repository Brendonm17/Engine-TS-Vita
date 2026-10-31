import fs from 'fs';


import { ConfigType } from '#/cache/config/ConfigType.js';
import { ConfigPair, openConfigIndex } from '#/cache/config/ConfigIndex.js';
import Jagfile from '#/io/Jagfile.js';
import Packet from '#/io/Packet.js';

export default class IdkType extends ConfigType {
    private static configNames: Map<string, number> = new Map();
    private static configs: IdkType[] = [];
    // lazy decode index, null when decoded eagerly
    static index: ConfigPair | null = null;

    static load(dir: string) {
        if (!fs.existsSync(`${dir}/server/idk.dat`)) {
            return;
        }

        const server = Packet.load(`${dir}/server/idk.dat`);
        const jag = Jagfile.load(`${dir}/client/config`);
        const index: ConfigPair | null = openConfigIndex(`${dir}/server/idk.idx`, server, jag, 'idk.dat', 'idk.idx');
        if (index) {
            IdkType.index = index;
            IdkType.configNames = index.server.names();
            IdkType.configs = new Array(IdkType.count_(index));
        } else {
            IdkType.index = null;
            this.parse(server, jag);
        }
    }

    private static count_(index: ConfigPair): number {
        return index.server.count;
    }

    static decodeOne(id: number): IdkType {
        const index: ConfigPair = IdkType.index!;
        const config = new IdkType(id);
        config.decodeType(index.server.entry(id));
        if (index.client) {
            config.decodeType(index.client.entry(id));
        }
        return config;
    }

    static parse(server: Packet, jag: Jagfile) {
        IdkType.configNames = new Map();
        IdkType.configs = [];

        const count = server.g2();

        const client = jag.read('idk.dat')!;
        client.pos = 2;

        for (let id = 0; id < count; id++) {
            const config = new IdkType(id);
            config.decodeType(server);
            config.decodeType(client);

            IdkType.configs[id] = config;

            if (config.debugname) {
                IdkType.configNames.set(config.debugname, id);
            }
        }
    }

    static get(id: number): IdkType {
        let config: IdkType | undefined = IdkType.configs[id];
        if (config === undefined && IdkType.index !== null && id >= 0 && id < IdkType.index.server.count) {
            config = IdkType.decodeOne(id);
            IdkType.configs[id] = config;
        }
        return config as IdkType;
    }

    static getId(name: string): number {
        return IdkType.configNames.get(name) ?? -1;
    }

    static getByName(name: string): IdkType | null {
        const id = this.getId(name);
        if (id === -1) {
            return null;
        }

        return this.get(id);
    }

    static get count() {
        return this.configs.length;
    }

    // ----
    type: number = -1;
    models: Uint16Array | null = null;
    heads: Uint16Array = new Uint16Array(5).fill(-1);
    recol_s: Uint16Array = new Uint16Array(6).fill(0);
    recol_d: Uint16Array = new Uint16Array(6).fill(0);
    disable: boolean = false;

    decode(code: number, dat: Packet): void {
        if (code === 1) {
            this.type = dat.g1();
        } else if (code === 2) {
            const count = dat.g1();
            this.models = new Uint16Array(count);

            for (let i = 0; i < count; i++) {
                this.models[i] = dat.g2();
            }
        } else if (code === 3) {
            this.disable = true;
        } else if (code >= 40 && code < 50) {
            this.recol_s[code - 40] = dat.g2();
        } else if (code >= 50 && code < 60) {
            this.recol_d[code - 50] = dat.g2();
        } else if (code >= 60 && code < 70) {
            this.heads[code - 60] = dat.g2();
        } else if (code === 250) {
            this.debugname = dat.gjstr();
        } else {
            throw new Error(`Unrecognized idk config code: ${code}`);
        }
    }
}
