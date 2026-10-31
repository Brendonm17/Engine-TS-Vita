import fs from 'fs';

import { CollisionFlag, CollisionType, LocAngle, LocLayer } from '@2004scape/rsmod-pathfinder';
import * as rsmod from '@2004scape/rsmod-pathfinder';

import LocType from '#/cache/config/LocType.js';
import NpcType from '#/cache/config/NpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import { CoordGrid } from '#/engine/CoordGrid.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
import Loc from '#/engine/entity/Loc.js';
import Npc from '#/engine/entity/Npc.js';
import Obj from '#/engine/entity/Obj.js';
import type { SquareDelta } from '#/engine/MapDelta.js';
import World from '#/engine/World.js';
import Zone from '#/engine/zone/Zone.js';
import ZoneGrid from '#/engine/zone/ZoneGrid.js';
import ZoneMap from '#/engine/zone/ZoneMap.js';
import Packet from '#/io/Packet.js';
import Environment from '#/util/Environment.js';
import { printDebug, printError, printFatalError, printWarning } from '#/util/Logger.js';

export default class GameMap {
    private static readonly OPEN: number = 0x0;
    private static readonly BLOCK_MAP_SQUARE: number = 0x1;
    private static readonly LINK_BELOW: number = 0x2;
    private static readonly REMOVE_ROOFS: number = 0x4;
    private static readonly VISIBLE_BELOW: number = 0x8;
    private static readonly NOT_LOW_DETAIL: number = 0x10;

    private static readonly Y: number = 4;
    private static readonly X: number = 64;
    private static readonly Z: number = 64;

    private static readonly MAPSQUARE: number = GameMap.X * GameMap.Y * GameMap.Z;

    private static readonly MAPS_DIR: string = 'data/pack/server/maps/';

    private readonly members: boolean;
    private readonly zonemap: ZoneMap;
    private readonly multimap: Set<number>;
    private readonly freemap: Set<number>;

    // map streaming (SP_MAP_RADIUS > 0): only squares near players stay loaded
    private readonly available: Set<number> = new Set(); // packed mx << 8 | mz
    private readonly loaded: Set<number> = new Set();
    private readonly broken: Set<number> = new Set(); // failed loads, never retried
    private streamRadius: number = 0;
    // soft cap on loaded squares (SP_MAX_SQUARES)
    private maxSquares: number = 96;
    // per-tick load budget in ms (SP_STREAM_BUDGET_MS)
    private loadBudgetMs: number = 25;
    private capWarned: boolean = false;
    // changed state of unloaded squares, replayed on reload
    private readonly hibernated: Map<number, SquareDelta> = new Map();
    // native loc loader
    private static readonly LOCS_OUT_HEADER: number = 4 * 8 * 8; // placements per (level, zx, zz)
    private locTypesSent: boolean = false;
    private locsOut: Int32Array = new Int32Array(GameMap.LOCS_OUT_HEADER + 2 * 8192);
    // squares this close to a player ignore the budget and cap
    private static readonly URGENT_TILES: number = 8;

    constructor(members: boolean) {
        this.members = members;
        this.zonemap = new ZoneMap();
        this.multimap = new Set();
        this.freemap = new Set();
    }

    get streaming(): boolean {
        return this.streamRadius > 0;
    }

    private static packSquare(mx: number, mz: number): number {
        return ((mx & 0xff) << 8) | (mz & 0xff);
    }

    init(): void {
        if (!fs.existsSync(`${Environment.BUILD_SRC_DIR}/maps`)) {
            return;
        }

        printDebug('Loading game map');

        if (fs.existsSync(`${Environment.BUILD_SRC_DIR}/maps/multiway.csv`)) {
            this.loadCsvMapBytes(this.multimap, fs.readFileSync(`${Environment.BUILD_SRC_DIR}/maps/multiway.csv`));
        }

        if (fs.existsSync(`${Environment.BUILD_SRC_DIR}/maps/free2play.csv`)) {
            this.loadCsvMapBytes(this.freemap, fs.readFileSync(`${Environment.BUILD_SRC_DIR}/maps/free2play.csv`));
        }

        // one directory listing instead of probing each file
        const names: string[] = fs.readdirSync(GameMap.MAPS_DIR);
        const have: Set<string> = new Set(names);
        for (let index: number = 0; index < names.length; index++) {
            const name: string = names[index];
            if (name[0] !== 'm') {
                continue;
            }
            const [mx, mz] = name.substring(1).split('_').map(Number);
            for (const prefix of ['n', 'o', 'l']) {
                if (!have.has(`${prefix}${mx}_${mz}`)) {
                    printFatalError(`Map data incomplete: missing ${GameMap.MAPS_DIR}${prefix}${mx}_${mz}`);
                }
            }
            this.available.add(GameMap.packSquare(mx, mz));
        }

        const mapRadius: number = parseInt(process.env.SP_MAP_RADIUS ?? '0', 10) || 0;
        if (mapRadius > 0) {
            const cx: number = parseInt(process.env.SP_MAP_CX ?? '48', 10);
            const cz: number = parseInt(process.env.SP_MAP_CZ ?? '48', 10);
            this.streamRadius = parseInt(process.env.SP_STREAM_RADIUS ?? String(mapRadius), 10) || mapRadius;
            this.maxSquares = parseInt(process.env.SP_MAX_SQUARES ?? '0', 10) || this.maxSquares;
            this.loadBudgetMs = parseInt(process.env.SP_STREAM_BUDGET_MS ?? '0', 10) || this.loadBudgetMs;

            let count: number = 0;
            for (const packed of this.available) {
                const mx: number = packed >> 8;
                const mz: number = packed & 0xff;
                if (Math.abs(mx - cx) <= mapRadius && Math.abs(mz - cz) <= mapRadius) {
                    this.loadSquare(mx, mz);
                    count++;
                }
            }
            printDebug(`SP_MAP_RADIUS=${mapRadius}: loaded ${count}/${this.available.size} map squares around (${cx},${cz}); streaming radius ${this.streamRadius}`);
        } else {
            for (const packed of this.available) {
                this.loadSquare(packed >> 8, packed & 0xff);
            }
        }

        printDebug(`${World.getTotalNpcs()}/${Environment.NODE_MAX_NPCS} static NPCs added`);
    }

    // load the square containing (x, z) now, false if it has no map data
    ensureResident(x: number, z: number): boolean {
        if (!this.streaming) {
            return true;
        }
        const mx: number = x >> 6;
        const mz: number = z >> 6;
        if (mx < 0 || mz < 0 || mx > 255 || mz > 255) {
            return false;
        }
        const packed: number = GameMap.packSquare(mx, mz);
        if (this.loaded.has(packed)) {
            return true;
        }
        return this.loadSquare(mx, mz);
    }

    loadSquare(mx: number, mz: number): boolean {
        const packed: number = GameMap.packSquare(mx, mz);
        if (this.loaded.has(packed)) {
            return true;
        }
        if (!this.available.has(packed) || this.broken.has(packed)) {
            return false;
        }
        this.loaded.add(packed);
        try {
            this.loadSquareData(mx, mz);
            const delta: SquareDelta | undefined = this.hibernated.get(packed);
            if (delta !== undefined) {
                this.hibernated.delete(packed);
                this.applyDelta(delta);
            }
        } catch (err) {
            // roll back a partial load, never retry
            printError(`map: failed to load m${mx}_${mz}: ${err instanceof Error ? err.message : String(err)}`);
            try {
                this.unloadSquare(mx, mz);
            } catch (_) {
                this.loaded.delete(packed);
            }
            this.broken.add(packed);
            return false;
        }
        return true;
    }

    private loadSquareData(mx: number, mz: number): void {
        const path: string = GameMap.MAPS_DIR;
        const mapsquareX: number = mx << 6;
        const mapsquareZ: number = mz << 6;

        this.loadNpcs(Packet.load(`${path}n${mx}_${mz}`), mapsquareX, mapsquareZ);
        this.loadObjs(Packet.load(`${path}o${mx}_${mz}`), mapsquareX, mapsquareZ);
        // collision
        const lands: Uint8Array = new Uint8Array(GameMap.MAPSQUARE); // 4 * 64 * 64 size is guaranteed for lands
        const host = (globalThis as any).__host;
        if (this.members && host && typeof host.mapLoadGround === 'function') {
            host.mapLoadGround(Packet.load(`${path}m${mx}_${mz}`).data, lands, mapsquareX, mapsquareZ);
        } else {
            this.loadGround(lands, Packet.load(`${path}m${mx}_${mz}`), mapsquareX, mapsquareZ);
        }
        if (this.members && host && typeof host.mapLoadLocs === 'function') {
            this.loadLocationsNative(host, lands, Packet.load(`${path}l${mx}_${mz}`).data, mapsquareX, mapsquareZ);
        } else {
            this.loadLocations(lands, Packet.load(`${path}l${mx}_${mz}`), mapsquareX, mapsquareZ);
        }
    }

    // drop a loaded square: its static npcs, loc/obj events, zones and collision
    unloadSquare(mx: number, mz: number): void {
        const packed: number = GameMap.packSquare(mx, mz);
        if (!this.loaded.has(packed)) {
            return;
        }
        this.loaded.delete(packed);

        // destroyed as one batch
        const doomed: Npc[] = [];
        for (const npc of World.npcs) {
            if (npc.startX >> 6 === mx && npc.startZ >> 6 === mz) {
                doomed.push(npc);
            }
        }
        World.destroyNpcs(doomed);

        for (const event of World.locObjTracker.all()) {
            const entity = event.entity;
            if (entity.x >> 6 === mx && entity.z >> 6 === mz) {
                entity.eventTracker = null;
                event.unlink();
            }
        }

        const x0: number = mx << 6;
        const z0: number = mz << 6;
        for (let level: number = 0; level < GameMap.Y; level++) {
            for (let zx: number = 0; zx < 8; zx++) {
                for (let zz: number = 0; zz < 8; zz++) {
                    const x: number = x0 + (zx << 3);
                    const z: number = z0 + (zz << 3);
                    const zone: Zone | undefined = this.zonemap.zoneIfExists(x, z, level);
                    if (zone) {
                        World.zonesTracking.delete(zone);
                        this.zonemap.remove(zone.index);
                    }
                    rsmod.deallocateIfPresent(x, z, level);
                }
            }
        }
    }

    // squares held by a non-pristine home npc or a visiting npc
    private npcPinnedSquares(): Set<number> {
        const pinned: Set<number> = new Set();
        for (const npc of World.npcs) {
            const home: number = GameMap.packSquare(npc.startX >> 6, npc.startZ >> 6);
            if (!npc.isPristine()) {
                pinned.add(home);
            }
            if (npc.isActive) {
                const at: number = GameMap.packSquare(npc.x >> 6, npc.z >> 6);
                if (at !== home) {
                    pinned.add(at);
                }
            }
        }
        return pinned;
    }

    // all zones match their on-disk state
    private zonesPristine(mx: number, mz: number): boolean {
        const x0: number = mx << 6;
        const z0: number = mz << 6;
        for (let level: number = 0; level < GameMap.Y; level++) {
            for (let zx: number = 0; zx < 8; zx++) {
                for (let zz: number = 0; zz < 8; zz++) {
                    const zone: Zone | undefined = this.zonemap.zoneIfExists(x0 + (zx << 3), z0 + (zz << 3), level);
                    if (zone && zone.hasDynamicState()) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    // state that differs from disk, null if something is still in progress
    captureDelta(mx: number, mz: number): SquareDelta | null {
        const delta: SquareDelta = { mx, mz, tick: World.currentTick, locs: [], objs: [], npcs: [] };
        for (const npc of World.npcs) {
            if (npc.startX >> 6 === mx && npc.startZ >> 6 === mz) {
                if (npc.isPristine()) {
                    continue;
                }
                if (!npc.isIdle() || npc.spawnIndex < 0) {
                    return null;
                }
                delta.npcs.push({ spawnIndex: npc.spawnIndex, vars: Int32Array.from(npc.vars), varsString: npc.varsString.slice() });
            } else if (npc.isActive && npc.x >> 6 === mx && npc.z >> 6 === mz) {
                return null; // visitor
            }
        }
        const x0: number = mx << 6;
        const z0: number = mz << 6;
        for (let level: number = 0; level < GameMap.Y; level++) {
            for (let zx: number = 0; zx < 8; zx++) {
                for (let zz: number = 0; zz < 8; zz++) {
                    const zone: Zone | undefined = this.zonemap.zoneIfExists(x0 + (zx << 3), z0 + (zz << 3), level);
                    if (zone && !zone.hibernate(delta.locs, delta.objs)) {
                        return null;
                    }
                }
            }
        }
        return delta;
    }

    // replay a hibernated square's state, minus the elapsed ticks
    private applyDelta(delta: SquareDelta): void {
        const elapsed: number = World.currentTick - delta.tick;
        const left = (remaining: number): number => (remaining < 0 ? -1 : remaining - elapsed);

        for (const h of delta.locs) {
            const remaining: number = left(h.remaining);
            if (h.remaining >= 0 && remaining <= 0) {
                continue; // expired meanwhile
            }
            if (h.dynamic) {
                const type: LocType = LocType.get(h.type);
                World.addLoc(new Loc(h.level, h.x, h.z, type.width, type.length, EntityLifeCycle.DESPAWN, h.type, h.shape, h.angle), remaining);
                continue;
            }
            const loc: Loc | null = this.getZone(h.x, h.z, h.level).getLoc(h.x, h.z, h.base);
            if (!loc) {
                printError(`map stream: hibernated loc ${h.base} at ${h.x},${h.z},${h.level} not found on reload`);
                continue;
            }
            if (!h.active) {
                World.removeLoc(loc, remaining);
            } else {
                World.changeLoc(loc, h.type, h.shape, h.angle, remaining);
            }
        }

        for (const h of delta.objs) {
            const remaining: number = left(h.remaining);
            if (h.remaining >= 0 && remaining <= 0) {
                continue;
            }
            if (!h.dynamic) {
                const obj: Obj | null = this.getZone(h.x, h.z, h.level).getObj(h.x, h.z, h.type, Obj.NO_RECEIVER);
                if (!obj) {
                    printError(`map stream: hibernated obj ${h.type} at ${h.x},${h.z},${h.level} not found on reload`);
                    continue;
                }
                World.removeObj(obj, remaining);
                obj.setLifeCycle(remaining); // exact ticks
                continue;
            }
            const obj: Obj = new Obj(h.level, h.x, h.z, EntityLifeCycle.DESPAWN, h.type, h.count);
            World.addObj(obj, h.receiver64, remaining);
            if (h.receiver64 !== Obj.NO_RECEIVER && h.reveal > -1) {
                const reveal: number = h.reveal - elapsed;
                if (reveal > 0) {
                    obj.reveal = reveal;
                } else {
                    World.revealObj(obj); // became public meanwhile
                }
            }
        }

        if (delta.npcs.length > 0) {
            for (const npc of World.npcs) {
                if (npc.spawnIndex < 0 || npc.startX >> 6 !== delta.mx || npc.startZ >> 6 !== delta.mz) {
                    continue;
                }
                for (const h of delta.npcs) {
                    if (h.spawnIndex === npc.spawnIndex) {
                        npc.restoreVars(h.vars, h.varsString);
                    }
                }
            }
        }
    }

    // per tick: load squares near players nearest first, unload far ones
    streamTick(players: Iterable<{ x: number; z: number }>): void {
        if (!this.streaming) {
            return;
        }
        const r: number = this.streamRadius;
        const near: Set<number> = new Set(); // within r + 1 of a player
        const nearTight: Set<number> = new Set(); // within r of a player
        const wanted: Map<number, number> = new Map(); // packed -> tiles to the nearest player
        let anyone: boolean = false;

        for (const player of players) {
            anyone = true;
            const px: number = player.x >> 6;
            const pz: number = player.z >> 6;
            for (let dx: number = -(r + 1); dx <= r + 1; dx++) {
                for (let dz: number = -(r + 1); dz <= r + 1; dz++) {
                    const mx: number = px + dx;
                    const mz: number = pz + dz;
                    if (mx < 0 || mz < 0 || mx > 255 || mz > 255) {
                        continue;
                    }
                    const packed: number = GameMap.packSquare(mx, mz);
                    near.add(packed);
                    if (Math.max(Math.abs(dx), Math.abs(dz)) > r) {
                        continue;
                    }
                    nearTight.add(packed);
                    if (this.loaded.has(packed) || !this.available.has(packed) || this.broken.has(packed)) {
                        continue;
                    }
                    // tiles to the square's nearest edge
                    const x0: number = mx << 6;
                    const z0: number = mz << 6;
                    const ddx: number = player.x < x0 ? x0 - player.x : player.x > x0 + 63 ? player.x - (x0 + 63) : 0;
                    const ddz: number = player.z < z0 ? z0 - player.z : player.z > z0 + 63 ? player.z - (z0 + 63) : 0;
                    const dist: number = Math.max(ddx, ddz);
                    const prev: number | undefined = wanted.get(packed);
                    if (prev === undefined || dist < prev) {
                        wanted.set(packed, dist);
                    }
                }
            }
        }
        if (!anyone) {
            return;
        }

        if (wanted.size > 0) {
            const order: [number, number][] = [...wanted.entries()].sort((a, b) => a[1] - b[1]);
            const start: number = Date.now();
            let loads: number = 0;
            for (const [packed, dist] of order) {
                if (dist > GameMap.URGENT_TILES) {
                    if (loads > 0 && Date.now() - start >= this.loadBudgetMs) {
                        break;
                    }
                    if (this.loaded.size >= this.maxSquares) {
                        if (!this.capWarned) {
                            this.capWarned = true;
                            printWarning(`map stream: ${this.loaded.size} squares resident, at the SP_MAX_SQUARES cap (${this.maxSquares}): only squares players are about to enter will load`);
                        }
                        break;
                    }
                }
                const mx: number = packed >> 8;
                const mz: number = packed & 0xff;
                this.loadSquare(mx, mz);
                loads++;
            }
        }

        const overCap: boolean = this.loaded.size > this.maxSquares;
        const keep: Set<number> = overCap ? nearTight : near;
        const limit: number = overCap ? 4 : 1;
        let unloads: number = 0;
        let npcPinned: Set<number> | null = null;
        for (const packed of [...this.loaded]) {
            if (keep.has(packed)) {
                continue;
            }
            const mx: number = packed >> 8;
            const mz: number = packed & 0xff;
            if (npcPinned === null) {
                npcPinned = this.npcPinnedSquares();
            }
            if (npcPinned.has(packed) || !this.zonesPristine(mx, mz)) {
                // changed square: hibernate it, or keep it until it settles
                const delta: SquareDelta | null = this.captureDelta(mx, mz);
                if (delta === null) {
                    continue;
                }
                this.hibernated.set(packed, delta);
            }
            try {
                this.unloadSquare(mx, mz);
            } catch (err) {
                printError(`map stream: failed to unload m${mx}_${mz}: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (++unloads >= limit) {
                break;
            }
        }
    }

    isMulti(coord: number): boolean {
        const pos: CoordGrid = CoordGrid.unpackCoord(coord);
        return this.multimap.has(ZoneMap.zoneIndex(pos.x, pos.z, pos.level));
    }

    isFreeToPlay(x: number, z: number): boolean {
        return this.freemap.has(ZoneMap.zoneIndex(x, z, 0)); // level does not matter here.
    }

    getZone(x: number, z: number, level: number): Zone {
        return this.zonemap.zone(x, z, level);
    }

    getZoneIndex(zoneIndex: number): Zone {
        return this.zonemap.zoneByIndex(zoneIndex);
    }

    getZoneGrid(level: number): ZoneGrid {
        return this.zonemap.grid(level);
    }

    getTotalZones(): number {
        return this.zonemap.zoneCount();
    }

    getTotalLocs(): number {
        return this.zonemap.locCount();
    }

    getTotalObjs(): number {
        return this.zonemap.objCount();
    }

    private loadNpcs(packet: Packet, mapsquareX: number, mapsquareZ: number): void {
        let spawnIndex: number = 0; // file order
        while (packet.available > 0) {
            const { x, z, level } = this.unpackCoord(packet.g2());
            const absoluteX: number = mapsquareX + x;
            const absoluteZ: number = mapsquareZ + z;
            const count: number = packet.g1();
            for (let index: number = 0; index < count; index++) {
                const id: number = packet.g2();
                if (!this.members && !this.isFreeToPlay(absoluteX, absoluteZ)) {
                    continue;
                }
                const npcType: NpcType = NpcType.get(id);
                if (!npcType) {
                    printFatalError(`Invalid npc type ${id} in map m${mapsquareX >> 6}_${mapsquareZ >> 6}.jm2`);
                    continue;
                }
                if ((npcType.members && this.members) || !npcType.members) {
                    const size: number = npcType.size;
                    const npc: Npc = new Npc(level, absoluteX, absoluteZ, size, size, EntityLifeCycle.RESPAWN, World.getNextNid(), npcType.id, npcType.moverestrict, npcType.blockwalk);
                    npc.spawnIndex = spawnIndex++;
                    World.addNpc(npc, -1);
                }
            }
        }
    }

    private loadObjs(packet: Packet, mapsquareX: number, mapsquareZ: number): void {
        while (packet.available > 0) {
            const { x, z, level } = this.unpackCoord(packet.g2());
            const absoluteX: number = mapsquareX + x;
            const absoluteZ: number = mapsquareZ + z;
            const count: number = packet.g1();
            for (let index: number = 0; index < count; index++) {
                const id: number = packet.g2();
                const count: number = packet.g1();
                if (!this.members && !this.isFreeToPlay(absoluteX, absoluteZ)) {
                    continue;
                }
                const objType: ObjType = ObjType.get(id);
                if ((objType.members && this.members) || !objType.members) {
                    const obj: Obj = new Obj(level, absoluteX, absoluteZ, EntityLifeCycle.RESPAWN, objType.id, count);
                    this.getZone(obj.x, obj.z, obj.level).addStaticObj(obj);
                }
            }
        }
    }

    private loadGround(lands: Uint8Array, packet: Packet, mapsquareX: number, mapsquareZ: number): void {
        for (let level: number = 0; level < GameMap.Y; level++) {
            for (let x: number = 0; x < GameMap.X; x++) {
                for (let z: number = 0; z < GameMap.Z; z++) {
                    while (true) {
                        const opcode: number = packet.g1();
                        if (opcode === 0) {
                            break;
                        } else if (opcode === 1) {
                            packet.pos++;
                            break;
                        }

                        if (opcode <= 49) {
                            packet.pos++;
                        } else if (opcode <= 81) {
                            lands[this.packCoord(x, z, level)] = opcode - 49;
                        }
                    }
                }
            }
        }
        for (let level: number = 0; level < GameMap.Y; level++) {
            for (let x: number = 0; x < GameMap.X; x++) {
                const absoluteX: number = x + mapsquareX;

                for (let z: number = 0; z < GameMap.Z; z++) {
                    const absoluteZ: number = z + mapsquareZ;

                    if (!this.members && !this.isFreeToPlay(absoluteX, absoluteZ) && !this.bordersFreeToPlay(absoluteX, absoluteZ)) {
                        continue;
                    }

                    if (x % 7 === 0 && z % 7 === 0) {
                        // allocate per zone
                        rsmod.allocateIfAbsent(absoluteX, absoluteZ, level);
                    }

                    const land: number = lands[this.packCoord(x, z, level)];

                    if ((land & GameMap.REMOVE_ROOFS) !== GameMap.OPEN) {
                        changeRoofCollision(absoluteX, absoluteZ, level, true);
                    }

                    if ((land & GameMap.BLOCK_MAP_SQUARE) !== GameMap.BLOCK_MAP_SQUARE) {
                        continue;
                    }

                    const bridged: boolean = (level === 1 ? land & GameMap.LINK_BELOW : lands[this.packCoord(x, z, 1)] & GameMap.LINK_BELOW) === GameMap.LINK_BELOW;
                    const actualLevel: number = bridged ? level - 1 : level;
                    if (actualLevel < 0) {
                        continue;
                    }

                    changeLandCollision(absoluteX, absoluteZ, actualLevel, true);
                }
            }
        }
    }

    private loadLocations(lands: Uint8Array, packet: Packet, mapsquareX: number, mapsquareZ: number): void {
        let locId: number = -1;
        let locIdOffset: number = packet.gsmarts();
        while (locIdOffset !== 0) {
            locId += locIdOffset;

            let coord: number = 0;
            let coordOffset: number = packet.gsmarts();

            while (coordOffset !== 0) {
                const { x, z, level } = this.unpackCoord((coord += coordOffset - 1));

                const info: number = packet.g1();
                coordOffset = packet.gsmarts();

                const absoluteX: number = x + mapsquareX;
                const absoluteZ: number = z + mapsquareZ;

                if (!this.members && !this.isFreeToPlay(absoluteX, absoluteZ) && !this.bordersFreeToPlay(absoluteX, absoluteZ)) {
                    continue;
                }

                const bridged: boolean = (level === 1 ? lands[coord] & GameMap.LINK_BELOW : lands[this.packCoord(x, z, 1)] & GameMap.LINK_BELOW) === GameMap.LINK_BELOW;
                const actualLevel: number = bridged ? level - 1 : level;
                if (actualLevel < 0) {
                    continue;
                }

                const type: LocType = LocType.get(locId);
                if (!type) {
                    printFatalError(`Invalid loc type ${locId} in map m${mapsquareX >> 6}_${mapsquareZ >> 6}.jm2`);
                    continue;
                }

                const width: number = type.width;
                const length: number = type.length;
                const shape: number = info >> 2;
                const angle: number = info & 0x3;

                if (type.blockwalk) {
                    changeLocCollision(shape, angle, type.blockrange, length, width, type.active, absoluteX, absoluteZ, actualLevel, true);
                }

                this.getZone(absoluteX, absoluteZ, actualLevel).addStaticLoc(new Loc(actualLevel, absoluteX, absoluteZ, width, length, EntityLifeCycle.RESPAWN, locId, shape, angle));
            }
            locIdOffset = packet.gsmarts();
        }
    }

    // native loadLocations, placements come back packed per zone
    private loadLocationsNative(host: any, lands: Uint8Array, locFile: Uint8Array, mapsquareX: number, mapsquareZ: number): void {
        if (!this.locTypesSent && LocType.index !== null && LocType.index.client !== null && typeof host.mapSetLocTypesDat === 'function') {
            // host parses the client loc config itself
            const client = LocType.index.client;
            if (host.mapSetLocTypesDat(client.data, client.offsets) === true) {
                this.locTypesSent = true;
            }
        }
        if (!this.locTypesSent) {
            const count: number = LocType.count;
            const blockwalk: Uint8Array = new Uint8Array(count);
            const blockrange: Uint8Array = new Uint8Array(count);
            const active: Int8Array = new Int8Array(count);
            const width: Uint8Array = new Uint8Array(count);
            const length: Uint8Array = new Uint8Array(count);
            for (let id: number = 0; id < count; id++) {
                const type: LocType | undefined = LocType.get(id);
                if (!type) {
                    blockwalk[id] = 0xff; // invalid type
                    continue;
                }
                blockwalk[id] = type.blockwalk ? 1 : 0;
                blockrange[id] = type.blockrange ? 1 : 0;
                active[id] = type.active;
                width[id] = type.width;
                length[id] = type.length;
            }
            host.mapSetLocTypes(count, blockwalk, blockrange, active, width, length);
            this.locTypesSent = true;
        }
        let out: Int32Array = this.locsOut;
        let result: number = host.mapLoadLocs(locFile, lands, mapsquareX, mapsquareZ, out);
        if (result < -2) {
            // buffer too small, -result is the needed length
            this.locsOut = out = new Int32Array(-result);
            result = host.mapLoadLocs(locFile, lands, mapsquareX, mapsquareZ, out);
        }
        if (result === -2) {
            printFatalError(`Invalid loc type in map m${mapsquareX >> 6}_${mapsquareZ >> 6}.jm2`);
        }
        if (result < 0) {
            throw new Error(`mapLoadLocs failed (${result}) for m${mapsquareX >> 6}_${mapsquareZ >> 6}`);
        }
        let offset: number = GameMap.LOCS_OUT_HEADER;
        for (let level: number = 0; level < GameMap.Y; level++) {
            for (let zx: number = 0; zx < 8; zx++) {
                for (let zz: number = 0; zz < 8; zz++) {
                    const count: number = out[(level * 8 + zx) * 8 + zz];
                    if (count > 0) {
                        // copy, the buffer is reused
                        this.getZone(mapsquareX + (zx << 3), mapsquareZ + (zz << 3), level).addStaticLocsPacked(out.slice(offset, offset + count * 2));
                        offset += count * 2;
                    }
                }
            }
        }
    }

    // csv map parser over raw bytes
    loadCsvMapBytes(map: Set<number>, file: Uint8Array): void {
        const data: Uint8Array = file instanceof Uint8Array ? file : new Uint8Array(file);
        const n: number = data.length;
        let i: number = 0;
        while (i < n) {
            let ch: number = data[i];
            if (ch === 10 || ch === 13) {
                i++;
                continue;
            }
            if (ch === 47) {
                // comment line
                while (i < n && data[i] !== 10) {
                    i++;
                }
                continue;
            }
            let f0: number = 0, f1: number = 0, f2: number = 0, f3: number = 0, value: number = 0, field: number = 0;
            let ok: boolean = true;
            const lineStart: number = i;
            while (i < n) {
                ch = data[i++];
                if (ch >= 48 && ch <= 57) {
                    value = value * 10 + (ch - 48);
                } else if (ch === 95) {
                    if (field === 0) f0 = value;
                    else if (field === 1) f1 = value;
                    else if (field === 2) f2 = value;
                    else if (field === 3) f3 = value;
                    field++;
                    value = 0;
                } else if (ch === 10 || ch === 13) {
                    break;
                } else {
                    ok = false;
                }
            }
            if (!ok || field !== 4) {
                printWarning('CSV map line is malformed: ' + String.fromCharCode.apply(null, data.subarray(lineStart, i) as unknown as number[]));
                continue;
            }
            // f0 = level, f1 = mx, f2 = mz, f3 = lx, value = lz
            if ((f3 & 7) !== 0 || (value & 7) !== 0) {
                printWarning('CSV map line is not aligned to a zone: ' + String.fromCharCode.apply(null, data.subarray(lineStart, i) as unknown as number[]));
            }
            map.add(ZoneMap.zoneIndex((f1 << 6) + f3, (f2 << 6) + value, f0));
        }
    }

    loadCsvMap(map: Set<number>, csv: string[]): void {
        // easiest solution for the time being
        for (let index: number = 0; index < csv.length; index++) {
            const line: string = csv[index];
            if (line.startsWith('//') || !line.length) {
                continue;
            }
            const [y, mx, mz, lx, lz] = line.split('_').map(Number);
            if (lx % 8 !== 0 || lz % 8 !== 0) {
                printWarning('CSV map line is not aligned to a zone: ' + line);
            }
            map.add(ZoneMap.zoneIndex((mx << 6) + lx, (mz << 6) + lz, y));
        }
    }

    private packCoord(x: number, z: number, level: number): number {
        return (z & 0x3f) | ((x & 0x3f) << 6) | ((level & 0x3) << 12);
    }

    private unpackCoord(packed: number): CoordGrid {
        const z: number = packed & 0x3f;
        const x: number = (packed >> 6) & 0x3f;
        const level: number = (packed >> 12) & 0x3;
        return { x, z, level };
    }

    private bordersFreeToPlay(x: number, z: number): boolean {
        return this.isFreeToPlay(x + 1, z) || this.isFreeToPlay(x - 1, z) || this.isFreeToPlay(x, z + 1) || this.isFreeToPlay(x, z - 1);
    }
}

// ---- rsmod wasm exports.

/**
 * Change collision at a specified Position for lands/floors.
 * @param x The x pos.
 * @param z The z pos.
 * @param level The level pos.
 * @param add True if adding this collision. False if removing.
 */
export function changeLandCollision(x: number, z: number, level: number, add: boolean): void {
    rsmod.changeFloor(x, z, level, add);
}

/**
 * Change collision at a specified Position for locs.
 * @param shape The shape of the loc to change.
 * @param angle The angle of the loc to change.
 * @param blockrange If this loc blocks range.
 * @param length The length of this loc.
 * @param width The width of this loc.
 * @param active If this loc is active.
 * @param x The x pos.
 * @param z The z pos.
 * @param level The level pos.
 * @param add True if adding this collision. False if removing.
 */
export function changeLocCollision(shape: number, angle: number, blockrange: boolean, length: number, width: number, active: number, x: number, z: number, level: number, add: boolean): void {
    const locLayer: LocLayer = rsmod.locShapeLayer(shape);
    if (locLayer === LocLayer.WALL) {
        rsmod.changeWall(x, z, level, angle, shape, blockrange, false, add);
    } else if (locLayer === LocLayer.GROUND) {
        if (angle === LocAngle.NORTH || angle === LocAngle.SOUTH) {
            rsmod.changeLoc(x, z, level, length, width, blockrange, false, add);
        } else {
            rsmod.changeLoc(x, z, level, width, length, blockrange, false, add);
        }
    } else if (locLayer === LocLayer.GROUND_DECOR) {
        if (active === 1) {
            rsmod.changeFloor(x, z, level, add);
        }
    }
}

/**
 * Change collision at a specified Position for npcs.
 * @param size The size square of this npc. (1x1, 2x2, etc).
 * @param x The x pos.
 * @param z The z pos.
 * @param level The level pos.
 * @param add True if adding this collision. False if removing.
 */
export function changeNpcCollision(size: number, x: number, z: number, level: number, add: boolean): void {
    rsmod.changeNpc(x, z, level, size, add);
}

/**
 * Change collision at a specified Position for players.
 * @param size The size square of this npc. (1x1, 2x2, etc).
 * @param x The x pos.
 * @param z The z pos.
 * @param level The level pos.
 * @param add True if adding this collision. False if removing.
 */
export function changePlayerCollision(size: number, x: number, z: number, level: number, add: boolean): void {
    rsmod.changePlayer(x, z, level, size, add);
}

/**
 * Change collision at a specified Position for roofs.
 * @param x The x pos.
 * @param z The z pos.
 * @param level The level pos.
 * @param add True if adding this collision. False if removing.
 */
export function changeRoofCollision(x: number, z: number, level: number, add: boolean): void {
    rsmod.changeRoof(x, z, level, add);
}

export function findPath(level: number, srcX: number, srcZ: number, destX: number, destZ: number): Uint32Array {
    return rsmod.findPath(level, srcX, srcZ, destX, destZ, 1, 1, 1, 0, -1, true, 0, 25, CollisionType.NORMAL);
}

export function findPathToEntity(level: number, srcX: number, srcZ: number, destX: number, destZ: number, srcSize: number, destWidth: number, destHeight: number): Uint32Array {
    return rsmod.findPath(level, srcX, srcZ, destX, destZ, srcSize, destWidth, destHeight, 0, -2, true, 0, 25, CollisionType.NORMAL);
}

export function findPathToLoc(level: number, srcX: number, srcZ: number, destX: number, destZ: number, srcSize: number, destWidth: number, destHeight: number, angle: number, shape: number, blockAccessFlags: number): Uint32Array {
    return rsmod.findPath(level, srcX, srcZ, destX, destZ, srcSize, destWidth, destHeight, angle, shape, true, blockAccessFlags, 25, CollisionType.NORMAL);
}

export function findNaivePath(level: number, srcX: number, srcZ: number, destX: number, destZ: number, srcWidth: number, srcHeight: number, destWidth: number, destHeight: number, extraFlag: number, collision: CollisionType): Uint32Array {
    return rsmod.findNaivePath(level, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag, collision);
}

export function reachedEntity(level: number, srcX: number, srcZ: number, destX: number, destZ: number, destWidth: number, destHeight: number, srcSize: number): boolean {
    return rsmod.reached(level, srcX, srcZ, destX, destZ, destWidth, destHeight, srcSize, 0, -2, 0);
}

export function reachedLoc(level: number, srcX: number, srcZ: number, destX: number, destZ: number, destWidth: number, destHeight: number, srcSize: number, angle: number, shape: number, blockAccessFlags: number): boolean {
    return rsmod.reached(level, srcX, srcZ, destX, destZ, destWidth, destHeight, srcSize, angle, shape, blockAccessFlags);
}

export function reachedObj(level: number, srcX: number, srcZ: number, destX: number, destZ: number, destWidth: number, destHeight: number, srcSize: number): boolean {
    return rsmod.reached(level, srcX, srcZ, destX, destZ, destWidth, destHeight, srcSize, 0, -1, 0);
}

export function canTravel(level: number, x: number, z: number, offsetX: number, offsetZ: number, size: number, extraFlag: number, collision: CollisionType): boolean {
    if (!Environment.NODE_MEMBERS && !World.gameMap.isFreeToPlay(x + offsetX, z + offsetZ)) {
        return false;
    }
    return rsmod.canTravel(level, x, z, offsetX, offsetZ, size, extraFlag, collision);
}

export function isMapBlocked(x: number, z: number, level: number): boolean {
    return isFlagged(x, z, level, CollisionFlag.WALK_BLOCKED);
}

export function isIndoors(x: number, z: number, level: number): boolean {
    return isFlagged(x, z, level, CollisionFlag.ROOF);
}

export function isFlagged(x: number, z: number, level: number, masks: number): boolean {
    return rsmod.isFlagged(x, z, level, masks);
}

export function isLineOfWalk(level: number, srcX: number, srcZ: number, destX: number, destZ: number): boolean {
    return rsmod.hasLineOfWalk(level, srcX, srcZ, destX, destZ, 1, 1, 1, 1, 0);
}

export function isLineOfSight(level: number, srcX: number, srcZ: number, destX: number, destZ: number): boolean {
    return rsmod.hasLineOfSight(level, srcX, srcZ, destX, destZ, 1, 1, 1, 1, 0);
}

export function isApproached(level: number, srcX: number, srcZ: number, destX: number, destZ: number, srcWidth: number, srcHeight: number, destWidth: number, destHeight: number): boolean {
    return rsmod.hasLineOfSight(level, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, CollisionFlag.PLAYER);
}

export function layerForLocShape(shape: number): LocLayer {
    return rsmod.locShapeLayer(shape);
}

export function isZoneAllocated(level: number, x: number, z: number): boolean {
    return rsmod.isZoneAllocated(x, z, level);
}
