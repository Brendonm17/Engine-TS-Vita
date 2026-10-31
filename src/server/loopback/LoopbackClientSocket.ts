import ClientSocket from '#/server/ClientSocket.js';

// in-process client socket for the embedded single-player server
export default class LoopbackClientSocket extends ClientSocket {
    // connection generation, the host drops stale sends
    readonly gen: number;

    // true for the on-demand connection
    readonly onDemand: boolean;

    constructor(gen: number, onDemand = false) {
        super();
        this.remoteAddress = '127.0.0.1';
        this.gen = gen;
        this.onDemand = onDemand;
    }

    send(src: Uint8Array): void {
        if (this.state === -1) {
            return;
        }
        this.totalBytesWritten += src.length;
        const host = (globalThis as any).__host;
        if (this.onDemand) {
            host.spSendToDemand(src, this.gen);
        } else {
            host.spSendToClient(src, this.gen);
        }
    }

    close(): void {
        this.state = -1;
    }

    terminate(): void {
        this.state = -1;
    }
}
