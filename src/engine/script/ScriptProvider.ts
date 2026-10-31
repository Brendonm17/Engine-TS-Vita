import { TargetOp } from '#/engine/entity/PathingEntity.js';
import ScriptFile from '#/engine/script/ScriptFile.js';
import ServerTriggerType from '#/engine/script/ServerTriggerType.js';
import Packet from '#/io/Packet.js';
import { printFatalError, printWarning } from '#/util/Logger.js';

// maintains a list of scripts (id <-> name)
export default class ScriptProvider {
    /**
     * The expected version of the script compiler that the runtime should be loading scripts from.
     */
    public static readonly COMPILER_VERSION = 26;

    /**
     * Loaded scripts, by id. Decoded on first access.
     */
    private static scripts: (ScriptFile | undefined)[] = [];

    /**
     * Mapping of unique trigger + type/category/global key to script id.
     */
    private static scriptLookup = new Map<number, number>();

    /**
     * Mapping of script names to its id.
     */
    private static scriptNames = new Map<string, number>();

    // script.dat and each script's offset and size
    private static dat: Uint8Array = new Uint8Array(0);
    private static offsets: Int32Array = new Int32Array(0);
    private static sizes: Int32Array = new Int32Array(0);

    /**
     * Loads all scripts from `dir`.
     *
     * @param dir The directory that holds the script.{dat,idx} files.
     * @returns The number of scripts loaded.
     */
    static load(dir: string): number {
        const dat = Packet.load(`${dir}/server/script.dat`);
        const idx = Packet.load(`${dir}/server/script.idx`);
        return this.parse(dat, idx);
    }

    static parse(dat: Packet, idx: Packet): number {
        if (!dat.data.length || !idx.data.length) {
            printFatalError('No server cache found. Please build the cache first.');
        }

        const entries = dat.g4s();
        idx.pos += 4;

        const version = dat.g4s();
        if (version !== ScriptProvider.COMPILER_VERSION) {
            printFatalError('\nFatal: Scripts were compiled with an incompatible RuneScript compiler. Please update it, try `npm run build` and then restart the server.');
        }

        const data: Uint8Array = dat.data;
        const offsets = new Int32Array(entries);
        const sizes = new Int32Array(entries);
        const scriptNames = new Map<string, number>();
        const scriptLookup = new Map<number, number>();

        let pos: number = dat.pos;
        let loaded = 0;
        for (let id = 0; id < entries; id++) {
            const size = idx.g4s();
            if (size === 0) {
                continue;
            }

            // read only the name and lookup key
            const nameEnd = data.indexOf(0, pos);
            const pathEnd = nameEnd === -1 ? -1 : data.indexOf(0, nameEnd + 1);
            if (nameEnd === -1 || pathEnd === -1 || pathEnd + 5 > pos + size) {
                printWarning(`Warning: Failed to load script ${id}, something may have been partially written`);
                return -1;
            }
            const name: string = String.fromCharCode.apply(null, data.subarray(pos, nameEnd) as unknown as number[]);
            const k = pathEnd + 1;
            const lookupKey = (data[k] << 24) | (data[k + 1] << 16) | (data[k + 2] << 8) | data[k + 3];

            offsets[id] = pos;
            sizes[id] = size;
            scriptNames.set(name, id);
            // add the script to lookup table if the value isn't -1
            if (lookupKey !== -1) {
                scriptLookup.set(lookupKey, id);
            }

            pos += size;
            loaded++;
        }

        ScriptProvider.dat = data;
        ScriptProvider.offsets = offsets;
        ScriptProvider.sizes = sizes;
        ScriptProvider.scripts = new Array<ScriptFile | undefined>(entries);
        ScriptProvider.scriptNames = scriptNames;
        ScriptProvider.scriptLookup = scriptLookup;
        return loaded;
    }

    /**
     * Finds a script by `id`.
     * @param id The script id to find.
     * @returns The script.
     */
    static get(id: number): ScriptFile | undefined {
        const scripts = ScriptProvider.scripts;
        let script = scripts[id];
        if (script === undefined && id >= 0 && id < ScriptProvider.sizes.length && ScriptProvider.sizes[id] > 0) {
            const offset = ScriptProvider.offsets[id];
            try {
                script = ScriptFile.decode(id, new Packet(ScriptProvider.dat.subarray(offset, offset + ScriptProvider.sizes[id])));
            } catch (err) {
                console.error(err);
                printWarning(`Warning: Failed to load script ${id}, something may have been partially written`);
                return undefined;
            }
            scripts[id] = script;
        }
        return script;
    }

    /**
     * Finds a script by `name`.
     * @param name The script name to find.
     * @returns The script.
     */
    static getByName(name: string): ScriptFile | undefined {
        const id = ScriptProvider.scriptNames.get(name);
        if (id === undefined) {
            return undefined;
        }
        return ScriptProvider.get(id);
    }

    private static getByKey(key: number): ScriptFile | undefined {
        const id = ScriptProvider.scriptLookup.get(key);
        if (id === undefined) {
            return undefined;
        }
        return ScriptProvider.get(id);
    }

    /**
     * Used to look up a script by the `type` and `category`.
     *
     * This function will attempt to search for a script given the specific `type`,
     * if one is not found it attempts one for `category`, and if still not found
     * it will attempt for the global script.
     *
     * @param trigger The script trigger to find.
     * @param type The script subject type id.
     * @param category The script subject category id.
     */
    static getByTrigger(trigger: TargetOp, type: number = -1, category: number = -1): ScriptFile | undefined {
        let script = ScriptProvider.getByKey(trigger | (0x2 << 8) | (type << 10));
        if (script) {
            return script;
        }
        script = ScriptProvider.getByKey(trigger | (0x1 << 8) | (category << 10));
        if (script) {
            return script;
        }
        return ScriptProvider.getByKey(trigger);
    }

    /**
     * Used to look up a script by a specific combo. Does not attempt any other combinations.
     *
     * If `type` is not `-1`, only the `type` specific script will be looked up. Likewise
     * for `category`. If both `type` and `category` are `-1`, then only the global script
     * will be looked up.
     *
     * @param trigger The script trigger to find.
     * @param type The script subject type id.
     * @param category The script subject category id.
     */
    static getByTriggerSpecific(trigger: ServerTriggerType, type: number = -1, category: number = -1): ScriptFile | undefined {
        if (type !== -1) {
            return ScriptProvider.getByKey(trigger | (0x2 << 8) | (type << 10));
        } else if (category !== -1) {
            return ScriptProvider.getByKey(trigger | (0x1 << 8) | (category << 10));
        }
        return ScriptProvider.getByKey(trigger);
    }
}
