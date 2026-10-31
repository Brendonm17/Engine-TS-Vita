import path from 'path';

import { ScriptOpcode } from '#/engine/script/ScriptOpcode.js';
import Packet from '#/io/Packet.js';

export interface ScriptInfo {
    scriptName: string;
    sourceFilePath: string;
    lookupKey: number;
    parameterTypes: number[];
    pcs: number[];
    lines: number[];
}

export type SwitchTable = {
    [key: number]: number | undefined;
};

function isLargeOperand(opcode: number): boolean {
    if (opcode > 100) {
        return false;
    }

    switch (opcode) {
        case ScriptOpcode.RETURN:
        case ScriptOpcode.POP_INT_DISCARD:
        case ScriptOpcode.POP_STRING_DISCARD:
        case ScriptOpcode.GOSUB:
        case ScriptOpcode.JUMP:
            return false;
    }

    return true;
}

// compiled bytecode representation
export default class ScriptFile {
    info: ScriptInfo = {
        scriptName: '<unknown>',
        sourceFilePath: '<unknown>',
        lookupKey: -1,
        parameterTypes: [],
        pcs: [],
        lines: []
    };

    readonly id: number;
    intLocalCount = 0;
    stringLocalCount = 0;
    intArgCount = 0;
    stringArgCount = 0;
    switchTables: SwitchTable[] = [];
    opcodes: number[] = [];
    intOperands: number[] = [];
    stringOperands: string[] = [];

    // encoded body, decoded on first run by ensureDecoded()
    private raw: Packet | null = null;
    private bodyPos = 0;
    private trailerPos = 0;

    // decodes the same binary format as clientscript2
    static decode(id: number, stream: Packet): ScriptFile {
        const length: number = stream.data.length;
        if (length < 16) {
            throw new Error('Invalid script file (minimum length)');
        }

        stream.pos = length - 2;

        const trailerLen = stream.g2();
        const trailerPos = length - trailerLen - 12 - 2;

        if (trailerPos < 0 || trailerPos >= length) {
            throw new Error('Invalid script file (bad trailer pos)');
        }

        const script = new ScriptFile(id);

        stream.pos = trailerPos;
        const _instructions = stream.g4s(); // we don't need to preallocate anything in JS, but still need to read it
        script.intLocalCount = stream.g2();
        script.stringLocalCount = stream.g2();
        script.intArgCount = stream.g2();
        script.stringArgCount = stream.g2();

        stream.pos = 0;
        script.info.scriptName = stream.gjstr(0);
        script.info.sourceFilePath = stream.gjstr(0);
        script.info.lookupKey = stream.g4s();
        const parameterTypeCount = stream.g1();
        for (let i = 0; i < parameterTypeCount; i++) {
            script.info.parameterTypes.push(stream.g1());
        }

        script.raw = stream;
        script.bodyPos = stream.pos;
        script.trailerPos = trailerPos;
        return script;
    }

    // decode the instructions and tables if not done yet
    ensureDecoded(): void {
        const stream = this.raw;
        if (!stream) {
            return;
        }
        this.raw = null;
        const trailerPos = this.trailerPos;

        stream.pos = trailerPos + 12;
        const switches = stream.g1();
        for (let i = 0; i < switches; i++) {
            const count = stream.g2();
            const table: SwitchTable = [];

            for (let j = 0; j < count; j++) {
                const key = stream.g4s();
                const offset = stream.g4s();
                table[key] = offset;
            }

            this.switchTables[i] = table;
        }

        stream.pos = this.bodyPos;
        const lineNumberTableLength = stream.g2();
        for (let i = 0; i < lineNumberTableLength; i++) {
            this.info.pcs.push(stream.g4s());
            this.info.lines.push(stream.g4s());
        }

        let instr = 0;
        while (trailerPos > stream.pos) {
            const opcode = stream.g2();

            if (opcode === ScriptOpcode.PUSH_CONSTANT_STRING) {
                this.stringOperands[instr] = stream.gjstr(0);
            } else if (isLargeOperand(opcode)) {
                this.intOperands[instr] = stream.g4s();
            } else {
                this.intOperands[instr] = stream.g1();
            }

            this.opcodes[instr++] = opcode;
        }
    }

    constructor(id: number) {
        this.id = id;
    }

    get name() {
        return this.info.scriptName;
    }

    get fileName() {
        return path.basename(this.info.sourceFilePath);
    }

    lineNumber(pc: number) {
        this.ensureDecoded();
        for (let i = 0; i < this.info.pcs.length; i++) {
            if (this.info.pcs[i] > pc) {
                return this.info.lines[i - 1];
            }
        }

        return this.info.lines[this.info.lines.length - 1];
    }
}
