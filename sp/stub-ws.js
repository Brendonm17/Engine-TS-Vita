// ws is unused in single-player, construction throws
export class WebSocket {
    constructor() {
        throw new Error('ws is disabled in single-player');
    }
}
export class WebSocketServer {
    constructor() {
        throw new Error('ws is disabled in single-player');
    }
}
export default { WebSocket, WebSocketServer };
