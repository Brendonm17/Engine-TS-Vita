import fs from 'fs';

import { ConfigType } from '#/cache/config/ConfigType.js';
import { ConfigPair, openConfigIndex } from '#/cache/config/ConfigIndex.js';
import { HuntCheckNotTooStrong } from '#/engine/entity/hunt/HuntCheckNotTooStrong.js';
import { HuntModeType } from '#/engine/entity/hunt/HuntModeType.js';
import { HuntNobodyNear } from '#/engine/entity/hunt/HuntNobodyNear.js';
import { HuntVis } from '#/engine/entity/hunt/HuntVis.js';
import { NpcMode } from '#/engine/entity/NpcMode.js';
import Packet from '#/io/Packet.js';

export default class HuntType extends ConfigType {
    private static configNames: Map<string, number> = new Map();
    private static configs: HuntType[] = [];
    // lazy decode index, null when decoded eagerly
    static index: ConfigPair | null = null;

    static load(dir: string) {
        if (!fs.existsSync(`${dir}/server/hunt.dat`)) {
            return;
        }
        const dat = Packet.load(`${dir}/server/hunt.dat`);
        const index: ConfigPair | null = openConfigIndex(`${dir}/server/hunt.idx`, dat, null, null, null);
        if (index) {
            HuntType.index = index;
            HuntType.configNames = index.server.names();
            HuntType.configs = new Array(index.server.count);
        } else {
            HuntType.index = null;
            this.parse(dat);
        }
    }

    static decodeOne(id: number): HuntType {
        const config = new HuntType(id);
        config.decodeType(HuntType.index!.server.entry(id));
        return config;
    }

    static parse(dat: Packet) {
        HuntType.configNames = new Map();
        HuntType.configs = [];

        const count = dat.g2();

        for (let id = 0; id < count; id++) {
            const config = new HuntType(id);
            config.decodeType(dat);

            HuntType.configs[id] = config;

            if (config.debugname) {
                HuntType.configNames.set(config.debugname, id);
            }
        }
    }

    static get(id: number): HuntType {
        let config: HuntType | undefined = HuntType.configs[id];
        if (config === undefined && HuntType.index !== null && id >= 0 && id < HuntType.index.server.count) {
            config = HuntType.decodeOne(id);
            HuntType.configs[id] = config;
        }
        return config as HuntType;
    }

    static getId(name: string): number {
        return HuntType.configNames.get(name) ?? -1;
    }

    static getByName(name: string): HuntType | null {
        const id = this.getId(name);
        if (id === -1) {
            return null;
        }

        return this.get(id);
    }

    static get count() {
        return this.configs.length;
    }

    public checkHuntCondition(value: number, condition: string, checkValue: number): boolean {
        switch (condition) {
            case '>':
                return value > checkValue;
            case '<':
                return value < checkValue;
            case '=':
                return value === checkValue;
            case '!':
                return value !== checkValue;
            case '&':
                return (value & checkValue) === 0;
        }
        return false;
    }

    // ----
    type: HuntModeType = HuntModeType.OFF;
    checkVis: HuntVis = HuntVis.OFF;
    checkNotTooStrong: HuntCheckNotTooStrong = HuntCheckNotTooStrong.OFF;
    checkNotBusy: boolean = false;
    findKeepHunting: boolean = false;
    findNewMode: NpcMode = NpcMode.NONE;
    nobodyNear: HuntNobodyNear = HuntNobodyNear.PAUSEHUNT;
    checkNotCombat: number = -1;
    checkNotCombatSelf: number = -1;
    checkAfk: boolean = true;
    rate: number = 1;
    checkCategory: number = -1;
    checkNpc: number = -1;
    checkObj: number = -1;
    checkLoc: number = -1;
    checkInv: number = -1;
    checkObjParam: number = -1;
    checkObjCat: number = -1;
    checkInvCondition: string = '';
    checkInvVal: number = -1;
    checkVars: { varId: number; condition: string; val: number }[] = [];

    decode(code: number, dat: Packet): void {
        if (code === 1) {
            this.type = dat.g1();
        } else if (code == 2) {
            this.checkVis = dat.g1();
        } else if (code == 3) {
            this.checkNotTooStrong = dat.g1();
        } else if (code == 4) {
            this.checkNotBusy = true;
        } else if (code == 5) {
            this.findKeepHunting = true;
        } else if (code == 6) {
            this.findNewMode = dat.g1();
        } else if (code == 7) {
            this.nobodyNear = dat.g1();
        } else if (code === 8) {
            this.checkNotCombat = dat.g2();
        } else if (code === 9) {
            this.checkNotCombatSelf = dat.g2();
        } else if (code === 10) {
            this.checkAfk = false;
        } else if (code === 11) {
            this.rate = dat.g2();
        } else if (code === 12) {
            this.checkCategory = dat.g2();
        } else if (code === 13) {
            this.checkNpc = dat.g2();
        } else if (code === 14) {
            this.checkObj = dat.g2();
        } else if (code === 15) {
            this.checkLoc = dat.g2();
        } else if (code === 16) {
            this.checkInv = dat.g2();
            this.checkObj = dat.g2();
            this.checkInvCondition = dat.gjstr();
            this.checkInvVal = dat.g4s();
        } else if (code === 17) {
            this.checkInv = dat.g2();
            this.checkObjParam = dat.g2();
            this.checkInvCondition = dat.gjstr();
            this.checkInvVal = dat.g4s();
        } else if (code === 18) {
            this.checkInv = dat.g2();
            this.checkObjCat = dat.g2();
            this.checkInvCondition = dat.gjstr();
            this.checkInvVal = dat.g4s();
        } else if (code > 18 && code < 22) {
            this.checkVars.push({ varId: dat.g2(), condition: dat.gjstr(), val: dat.g4s() });
        } else if (code === 250) {
            this.debugname = dat.gjstr();
        } else {
            throw new Error(`Unrecognized hunt config code: ${code}`);
        }
    }
}
