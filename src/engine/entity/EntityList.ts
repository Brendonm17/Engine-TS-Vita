import Entity from '#/engine/entity/Entity.js';
import Npc from '#/engine/entity/Npc.js';

// inspired by https://github.com/rsmod/rsmod/blob/master/game/src/main/kotlin/org/rsmod/game/model/mob/list/MobList.kt
abstract class EntityList<T extends Entity> extends Array<T | undefined> {
    // constructor
    private readonly free: Set<number>;
    protected readonly indexPadding: number;
    protected readonly ids: Int32Array;
    // one bit per id in use
    protected readonly used: Uint32Array;

    // runtime
    protected lastUsedIndex: number = 0;

    protected constructor(size: number, indexPadding: number) {
        super(size);
        this.ids = new Int32Array(size).fill(-1);
        this.used = new Uint32Array((size + 31) >>> 5);
        this.free = new Set<number>(Array.from({ length: size }, (_, index) => index));
        this.indexPadding = indexPadding;
    }

    next(_: boolean = false, start: number = this.lastUsedIndex + 1): number {
        const length: number = this.ids.length;
        for (let index: number = start; index < length; index++) {
            if (this.ids[index] === -1) {
                return index;
            }
        }
        for (let index: number = this.indexPadding; index < start; index++) {
            if (this.ids[index] === -1) {
                return index;
            }
        }
        throw new Error('[EntityList] no space for new entities');
    }

    // ids in ascending order, skipping empty words
    *[Symbol.iterator](): ArrayIterator<T> {
        const ids: Int32Array = this.ids;
        const used: Uint32Array = this.used;
        const length: number = ids.length;
        for (let word: number = 0; word < used.length; word++) {
            if (used[word] === 0) {
                continue;
            }
            const end: number = Math.min((word + 1) << 5, length);
            for (let id: number = word << 5; id < end; id++) {
                const index: number = ids[id];
                if (index === -1) {
                    continue;
                }
                const entity: T | undefined = this[index];
                if (typeof entity === 'undefined') {
                    continue;
                }
                yield entity;
            }
        }
    }

    get count(): number {
        return Math.max(this.length - this.free.size, 0);
    }

    get(id: number): T | undefined {
        const index: number = this.ids[id];
        return index !== -1 ? this[index] : undefined;
    }

    set(id: number, entity: T): void {
        if (!this.free.size) {
            throw new Error('[EntityList] cannot find available entities slot.');
        }
        const index = this.free.values().next().value!;
        this.free.delete(index);
        this.ids[id] = index;
        this.used[id >>> 5] |= 1 << (id & 31);
        this[index] = entity;
        this.lastUsedIndex = id;
    }

    remove(id: number): void {
        const index: number = this.ids[id];
        if (index !== -1) {
            this.ids[id] = -1;
            this.used[id >>> 5] &= ~(1 << (id & 31));
            this.free.add(index);
            delete this[index];
        }
    }

    reset(): void {
        this.length = 0;
        this.ids.fill(-1);
        this.used.fill(0);
        this.free.clear();
        for (let i: number = 0; i < this.ids.length; i++) {
            this.free.add(i);
        }
    }
}

export class NpcList extends EntityList<Npc> {
    constructor(size: number) {
        super(size, 0);
    }
}
