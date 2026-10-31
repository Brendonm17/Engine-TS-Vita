// state of an unloaded map square that differs from disk

export interface HibernatedLoc {
    x: number;
    z: number;
    level: number;
    base: number; // on-disk type
    dynamic: boolean; // script-added
    active: boolean; // static only, false = removed
    type: number;
    shape: number;
    angle: number;
    remaining: number; // ticks left, -1 = permanent
}

export interface HibernatedObj {
    x: number;
    z: number;
    level: number;
    dynamic: boolean; // dropped or script-added
    type: number;
    count: number;
    receiver64: bigint; // dynamic only
    reveal: number; // dynamic only, -1 = public
    remaining: number; // ticks left, -1 = permanent
}

export interface HibernatedNpc {
    spawnIndex: number; // index in the square's npc file
    vars: Int32Array;
    varsString: (string | undefined)[];
}

export interface SquareDelta {
    mx: number; // map square
    mz: number;
    tick: number; // capture tick
    locs: HibernatedLoc[];
    objs: HibernatedObj[];
    npcs: HibernatedNpc[];
}
