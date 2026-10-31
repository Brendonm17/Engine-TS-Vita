import fs from 'fs';


import { ConfigType } from '#/cache/config/ConfigType.js';
import { ConfigPair, openConfigIndex } from '#/cache/config/ConfigIndex.js';
import { ParamHelper, ParamHolder, ParamMap } from '#/cache/config/ParamHelper.js';
import Packet from '#/io/Packet.js';

export default class StructType extends ConfigType implements ParamHolder {
    private static configNames = new Map<string, number>();
    private static configs: StructType[] = [];
    // lazy decode index, null when decoded eagerly
    static index: ConfigPair | null = null;

    static load(dir: string) {
        if (!fs.existsSync(`${dir}/server/struct.dat`)) {
            return;
        }

        const dat = Packet.load(`${dir}/server/struct.dat`);
        const index: ConfigPair | null = openConfigIndex(`${dir}/server/struct.idx`, dat, null, null, null);
        if (index) {
            StructType.index = index;
            StructType.configNames = index.server.names();
            StructType.configs = new Array(index.server.count);
        } else {
            StructType.index = null;
            this.parse(dat);
        }
    }

    static decodeOne(id: number): StructType {
        const config = new StructType(id);
        config.decodeType(StructType.index!.server.entry(id));
        return config;
    }

    static parse(dat: Packet) {
        StructType.configNames = new Map();
        StructType.configs = [];

        const count = dat.g2();

        for (let id = 0; id < count; id++) {
            const config = new StructType(id);
            config.decodeType(dat);

            StructType.configs[id] = config;

            if (config.debugname) {
                StructType.configNames.set(config.debugname, id);
            }
        }
    }

    static get(id: number): StructType {
        let config: StructType | undefined = StructType.configs[id];
        if (config === undefined && StructType.index !== null && id >= 0 && id < StructType.index.server.count) {
            config = StructType.decodeOne(id);
            StructType.configs[id] = config;
        }
        return config as StructType;
    }

    static getId(name: string): number {
        return StructType.configNames.get(name) ?? -1;
    }

    static getByName(name: string): StructType | null {
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

    params: ParamMap | null = null;

    decode(code: number, dat: Packet) {
        if (code === 249) {
            this.params = ParamHelper.decodeParams(dat);
        } else if (code === 250) {
            this.debugname = dat.gjstr();
        } else {
            throw new Error(`Unrecognized struct config code: ${code}`);
        }
    }
}
