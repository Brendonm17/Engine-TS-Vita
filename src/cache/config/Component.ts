import fs from 'fs';

import Packet from '#/io/Packet.js';
import Jagfile from '#/io/Jagfile.js';

export default class Component {
    static TYPE_LAYER: number = 0;
    static TYPE_UNUSED: number = 1;
    static TYPE_INVENTORY: number = 2;
    static TYPE_RECT: number = 3;
    static TYPE_TEXT: number = 4;
    static TYPE_SPRITE: number = 5;
    static TYPE_MODEL: number = 6;
    static TYPE_INVENTORY_TEXT: number = 7;

    static NO_BUTTON: number = 0;
    static BUTTON: number = 1;
    static TARGET_BUTTON: number = 2;
    static CLOSE_BUTTON: number = 3;
    static TOGGLE_BUTTON: number = 4;
    static SELECT_BUTTON: number = 5;
    static PAUSE_BUTTON: number = 6;

    private static componentNames: Map<string, number> = new Map();
    private static components: Component[] = [];

    // lazy decode, offsets cached in interface.cidx
    private static dataOffsets: Int32Array = new Int32Array(0); // -1 = no component
    private static rootLayers: Int32Array = new Int32Array(0);
    private static extraOffsets: Int32Array = new Int32Array(0); // offset in interface.dat, -1 = none
    private static lazyData: Packet | null = null;
    private static lazyExtra: Packet | null = null;

    private static readonly INDEX_MAGIC: number = 0x43494458; // 'CIDX'
    private static readonly INDEX_VERSION: number = 1;

    static load(dir: string): void {
        if (!fs.existsSync(`${dir}/client/interface`)) {
            return;
        }

        const client = new Jagfile(Packet.load(`${dir}/client/interface`));
        if (!client.has('data')) {
            return;
        }

        const data: Packet = client.read('data')!;
        const server: Packet = Packet.load(`${dir}/server/interface.dat`);
        const indexPath: string = `${dir}/server/interface.cidx`;
        if (Component.loadIndex(indexPath, data, server)) {
            return;
        }

        this.decode(data);
        this.decodeExtra(server);
        Component.saveIndex(indexPath, data, server);
    }

    private static loadIndex(path: string, data: Packet, server: Packet): boolean {
        let index: Packet;
        try {
            if (!fs.existsSync(path)) {
                return false;
            }
            index = Packet.load(path);
        } catch (_) {
            return false;
        }
        if (index.length < 17 || index.g4() !== Component.INDEX_MAGIC || index.g1() !== Component.INDEX_VERSION) {
            return false;
        }
        const count: number = index.g4();
        if (index.g4() !== data.length || index.g4() !== server.length || index.available !== count * 12) {
            return false;
        }
        const dataOffsets: Int32Array = new Int32Array(count);
        const rootLayers: Int32Array = new Int32Array(count);
        const extraOffsets: Int32Array = new Int32Array(count);
        for (let id: number = 0; id < count; id++) {
            dataOffsets[id] = index.g4s();
            rootLayers[id] = index.g4s();
            extraOffsets[id] = index.g4s();
        }
        Component.componentNames = new Map();
        Component.components = new Array(count);
        Component.dataOffsets = dataOffsets;
        Component.rootLayers = rootLayers;
        Component.extraOffsets = extraOffsets;
        Component.lazyData = data;
        Component.lazyExtra = server;
        return true;
    }

    private static saveIndex(path: string, data: Packet, server: Packet): void {
        const count: number = Component.dataOffsets.length;
        const out: Packet = new Packet(new Uint8Array(17 + count * 12));
        out.p4(Component.INDEX_MAGIC);
        out.p1(Component.INDEX_VERSION);
        out.p4(count);
        out.p4(data.length);
        out.p4(server.length);
        for (let id: number = 0; id < count; id++) {
            out.p4(Component.dataOffsets[id]);
            out.p4(Component.rootLayers[id]);
            out.p4(id < Component.extraOffsets.length ? Component.extraOffsets[id] : -1);
        }
        try {
            fs.writeFileSync(path, out.data);
        } catch (_) {
            // read-only data dir
        }
    }

    private static recordOffset(table: Int32Array, id: number, value: number): Int32Array {
        if (id >= table.length) {
            const grown: Int32Array = new Int32Array(Math.max(id + 1, table.length * 2, 1024)).fill(-1);
            grown.set(table);
            table = grown;
        }
        table[id] = value;
        return table;
    }

    static decode(dat: Packet) {
        this.componentNames = new Map();
        this.components = [];
        this.dataOffsets = new Int32Array(0);
        this.rootLayers = new Int32Array(0);
        this.extraOffsets = new Int32Array(0);
        this.lazyData = null;
        this.lazyExtra = null;

        dat.g2(); // count

        let rootLayer = -1;
        while (dat.available > 0) {
            let offset = dat.pos;
            let id = dat.g2();
            if (id === 65535) {
                rootLayer = dat.g2();
                offset = dat.pos;
                id = dat.g2();
            }
            Component.dataOffsets = Component.recordOffset(Component.dataOffsets, id, offset);
            Component.rootLayers = Component.recordOffset(Component.rootLayers, id, rootLayer);

            Component.components[id] = Component.decodeOne(dat, id, rootLayer);
        }
        // trim to max id + 1
        let count: number = Component.dataOffsets.length;
        while (count > 0 && Component.dataOffsets[count - 1] < 0) {
            count--;
        }
        Component.dataOffsets = Component.dataOffsets.slice(0, count);
        Component.rootLayers = Component.rootLayers.slice(0, count);
        Component.extraOffsets = new Int32Array(count).fill(-1);
    }

    // decode one component, positioned after its id
    static decodeOne(dat: Packet, id: number, rootLayer: number): Component {
        {
            const com = new Component();
            com.id = id;
            com.rootLayer = rootLayer;

            com.comType = dat.g1();
            com.buttonType = dat.g1();
            com.clientCode = dat.g2();
            com.width = dat.g2();
            com.height = dat.g2();
            com.trans = dat.g1();

            com.overLayer = dat.g1();
            if (com.overLayer == 0) {
                com.overLayer = -1;
            } else {
                com.overLayer = ((com.overLayer - 1) << 8) + dat.g1();
            }

            const comparatorCount = dat.g1();
            if (comparatorCount > 0) {
                com.scriptComparator = new Uint8Array(comparatorCount).fill(0);
                com.scriptOperand = new Uint16Array(comparatorCount).fill(0);

                for (let i = 0; i < comparatorCount; i++) {
                    com.scriptComparator[i] = dat.g1();
                    com.scriptOperand[i] = dat.g2();
                }
            }

            const scriptCount = dat.g1();
            if (scriptCount > 0) {
                com.scripts = new Array(scriptCount).fill(null);

                for (let i = 0; i < scriptCount; i++) {
                    const opcodeCount = dat.g2();

                    com.scripts[i] = new Uint16Array(opcodeCount).fill(0);
                    for (let j = 0; j < opcodeCount; j++) {
                        com.scripts[i][j] = dat.g2();
                    }
                }
            }

            switch (com.comType) {
                case Component.TYPE_LAYER: {
                    com.scroll = dat.g2();
                    com.hide = dat.gbool();

                    const childCount = dat.g2();
                    com.childId = new Uint16Array(childCount).fill(0);
                    com.childX = new Uint16Array(childCount).fill(0);
                    com.childY = new Uint16Array(childCount).fill(0);

                    for (let i = 0; i < childCount; i++) {
                        com.childId[i] = dat.g2();
                        com.childX[i] = dat.g2s();
                        com.childY[i] = dat.g2s();
                    }
                    break;
                }
                case Component.TYPE_UNUSED:
                    // The client has this impl for 10 bytes.
                    // Seems unused though.
                    dat.pos += 10;
                    break;
                case Component.TYPE_INVENTORY: {
                    com.draggable = dat.gbool();
                    com.operable = dat.gbool();
                    com.usable = dat.gbool();
                    com.swappable = dat.gbool();
                    com.marginX = dat.g1();
                    com.marginY = dat.g1();

                    com.inventorySlotOffsetX = new Uint16Array(20).fill(0);
                    com.inventorySlotOffsetY = new Uint16Array(20).fill(0);
                    com.inventorySlotGraphic = new Array(20).fill(null);

                    for (let i = 0; i < 20; i++) {
                        if (dat.gbool()) {
                            com.inventorySlotOffsetX[i] = dat.g2s();
                            com.inventorySlotOffsetY[i] = dat.g2s();
                            com.inventorySlotGraphic[i] = dat.gjstr();
                        }
                    }

                    com.iop = new Array(5).fill(null);
                    for (let i = 0; i < 5; i++) {
                        com.iop[i] = dat.gjstr();
                    }

                    com.actionVerb = dat.gjstr();
                    com.action = dat.gjstr();
                    com.actionTarget = dat.g2();
                    break;
                }
                case Component.TYPE_RECT:
                    com.fill = dat.gbool();
                    com.colour = dat.g4s();
                    com.activeColour = dat.g4s();
                    com.overColour = dat.g4s();
                    com.activeOverColour = dat.g4s();
                    break;
                case Component.TYPE_TEXT:
                    com.center = dat.gbool();
                    com.font = dat.g1();
                    com.shadowed = dat.gbool();
                    com.text = dat.gjstr();
                    com.activeText = dat.gjstr();
                    com.colour = dat.g4s();
                    com.activeColour = dat.g4s();
                    com.overColour = dat.g4s();
                    com.activeOverColour = dat.g4s();
                    break;
                case Component.TYPE_SPRITE:
                    com.graphic = dat.gjstr();
                    com.activeGraphic = dat.gjstr();
                    break;
                case Component.TYPE_MODEL: {
                    com.model = dat.g1();
                    if (com.model != 0) {
                        com.model = ((com.model - 1) << 8) + dat.g1();
                    }

                    com.activeModel = dat.g1();
                    if (com.activeModel != 0) {
                        com.activeModel = ((com.activeModel - 1) << 8) + dat.g1();
                    }

                    com.anim = dat.g1();
                    if (com.anim == 0) {
                        com.anim = -1;
                    } else {
                        com.anim = ((com.anim - 1) << 8) + dat.g1();
                    }

                    com.activeAnim = dat.g1();
                    if (com.activeAnim == 0) {
                        com.activeAnim = -1;
                    } else {
                        com.activeAnim = ((com.activeAnim - 1) << 8) + dat.g1();
                    }

                    com.zoom = dat.g2();
                    com.xan = dat.g2();
                    com.yan = dat.g2();
                    break;
                }
                case Component.TYPE_INVENTORY_TEXT: {
                    com.center = dat.gbool();
                    com.font = dat.g1();
                    com.shadowed = dat.gbool();
                    com.colour = dat.g4s();
                    com.marginX = dat.g2s();
                    com.marginY = dat.g2s();
                    com.operable = dat.gbool();
                    com.iop = new Array(5).fill(null);
                    for (let i = 0; i < 5; i++) {
                        com.iop[i] = dat.gjstr();
                    }
                    break;
                }
            }

            switch (com.buttonType) {
                case Component.NO_BUTTON:
                    break;
                case Component.TARGET_BUTTON:
                    com.actionVerb = dat.gjstr();
                    com.action = dat.gjstr();
                    com.actionTarget = dat.g2();
                    break;
                case Component.BUTTON:
                case Component.TOGGLE_BUTTON:
                case Component.SELECT_BUTTON:
                case Component.PAUSE_BUTTON:
                    com.option = dat.gjstr();
                    break;
            }

            return com;
        }
    }

    // custom
    static decodeExtra(dat: Packet) {
        dat.g2(); // count

        while (dat.available > 0) {
            const offset = dat.pos;
            const id = dat.g2();
            const debugname = dat.gjstr();
            const overlay = dat.gbool();

            Component.components[id].comName = debugname;
            Component.components[id].overlay = overlay;
            Component.extraOffsets = Component.recordOffset(Component.extraOffsets, id, offset);

            Component.componentNames.set(debugname, id);
        }
    }

    static get(id: number): Component {
        let com: Component | undefined = Component.components[id];
        if (com === undefined && Component.lazyData !== null && id >= 0 && id < Component.dataOffsets.length && Component.dataOffsets[id] >= 0) {
            const dat: Packet = Component.lazyData;
            dat.pos = Component.dataOffsets[id];
            dat.g2(); // id
            com = Component.decodeOne(dat, id, Component.rootLayers[id]);
            const extra: number = Component.extraOffsets[id];
            if (extra >= 0 && Component.lazyExtra !== null) {
                const server: Packet = Component.lazyExtra;
                server.pos = extra;
                server.g2(); // id
                com.comName = server.gjstr();
                com.overlay = server.gbool();
            }
            Component.components[id] = com;
        }
        return com as Component;
    }

    static getId(name: string): number {
        if (Component.componentNames.size === 0 && Component.lazyExtra !== null) {
            // scan names on first use
            const server: Packet = Component.lazyExtra;
            server.pos = 2;
            while (server.available > 0) {
                const id = server.g2();
                const debugname = server.gjstr();
                server.gbool();
                Component.componentNames.set(debugname, id);
            }
        }
        return Component.componentNames.get(name) ?? -1;
    }

    static getByName(name: string): Component | null {
        const id = this.getId(name);
        if (id === -1) {
            return null;
        }

        return this.get(id);
    }

    // ----
    id: number = -1;
    rootLayer: number = -1;
    comName: string | null = null;
    overlay: boolean = false;
    comType: number = -1;
    buttonType: number = -1;
    clientCode: number = 0;
    width: number = 0;
    height: number = 0;
    trans: number = 0;
    overLayer: number = -1;
    scriptComparator: Uint8Array | null = null;
    scriptOperand: Uint16Array | null = null;
    scripts: Array<Uint16Array> | null = null;
    scroll: number = 0;
    hide = false;
    draggable = false; // INV_BUTTOND
    operable = false; // OPHELD/INV_BUTTON
    usable = false; // OPHELDT/OPHELDU
    swappable = false; // INV_BUTTOND
    marginX: number = 0;
    marginY: number = 0;
    inventorySlotOffsetX: Uint16Array | null = null;
    inventorySlotOffsetY: Uint16Array | null = null;
    inventorySlotGraphic: Array<string> | null = null;
    iop: Array<string | null> | null = null; // INV_BUTTON
    fill = false;
    center = false;
    font: number = 0;
    shadowed = false;
    text: string | null = null;
    activeText: string | null = null;
    colour: number = 0;
    activeColour: number = 0;
    overColour: number = 0;
    activeOverColour: number = 0;
    graphic: string | null = null;
    activeGraphic: string | null = null;
    model: number = -1;
    activeModel: number = -1;
    anim: number = -1;
    activeAnim: number = -1;
    zoom: number = 0;
    xan: number = 0;
    yan: number = 0;
    actionVerb: string | null = null;
    action: string | null = null;
    actionTarget: number = -1;
    option: string | null = null;
    childId: Uint16Array | null = null;
    childX: Uint16Array | null = null;
    childY: Uint16Array | null = null;
}

export const enum ComActionTarget {
    OBJ = 1,
    NPC = 2,
    LOC = 4,
    PLAYER = 8,
    HELD = 16
}
