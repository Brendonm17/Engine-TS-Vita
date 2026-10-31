import ClientSocket from '#/server/ClientSocket.js';

// in-process client socket for the embedded single-player server
export default class LoopbackClientSocket extends ClientSocket {
    // connection generation, the host drops stale sends
    readonly gen: number;

    constructor(gen: number) {
        super();
        this.remoteAddress = '127.0.0.1';
        this.gen = gen;
    }

    send(src: Uint8Array): void {
        if (this.state === -1) {
            return;
        }
        this.totalBytesWritten += src.length;
        (globalThis as any).__host.spSendToClient(src, this.gen);
    }

    close(): void {
        this.state = -1;
    }

    terminate(): void {
        this.state = -1;
    }
}
