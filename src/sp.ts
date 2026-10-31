// Single-player entry point for the embedded QuickJS server.
// The host drives it through the __sp_* hooks below.

// bare imports keep the module evaluation order
import '#/cache/config/Component.js';
import '#/cache/config/EnumType.js';
import '#/cache/config/HuntType.js';
import '#/cache/config/IdkType.js';
import '#/cache/config/LocType.js';
import '#/cache/config/NpcType.js';
import '#/cache/config/ObjType.js';
import '#/cache/config/ParamType.js';
import '#/cache/config/SeqType.js';
import '#/cache/config/SpotanimType.js';
import '#/cache/config/StructType.js';
import '#/engine/script/ScriptProvider.js';
import World from '#/engine/World.js';
import OnDemand from '#/engine/OnDemand.js';
import '#/io/Packet.js';
import ClientSocket from '#/server/ClientSocket.js';
import NullClientSocket from '#/server/NullClientSocket.js';
import LoopbackClientSocket from '#/server/loopback/LoopbackClientSocket.js';
import Environment from '#/util/Environment.js';

const g: any = globalThis as any;

let gameClient: LoopbackClientSocket | null = null;
let demandClient: LoopbackClientSocket | null = null;

(async () => {
    try {
        await World.start();
        g.__sp_worldReady = true;
        if (g.__host && g.__host.print) {
            g.__host.print('[sp] world ready');
        }
    } catch (err) {
        const e: any = err;
        const msg = e && e.stack ? e.stack : String(e);
        g.__sp_bootError = String(msg);
        if (g.__host && g.__host.print) {
            g.__host.print('[sp] World.start FAILED: ' + (e && e.constructor ? e.constructor.name : '') + ': ' + (e && e.message ? e.message : String(e)));
            g.__host.print('[sp] stack: ' + msg);
        }
    }
})();

// ---- host power events ----

// flush every player's save before suspend
g.__sp_saveNow = function (): number {
    (World as any).savePlayers();
    return World.getTotalPlayers();
};

// after resume, run the next tick now instead of catching up
g.__sp_resumeClock = function (): void {
    World.nextTick = Date.now();
};

// ---- loopback transport ----

function connect(gen: number, onDemand: boolean): LoopbackClientSocket {
    // nothing is sent first, the client opens the handshake
    return new LoopbackClientSocket(gen >>> 0, onDemand);
}

g.__sp_clientConnect = function (gen: number): void {
    gameClient = connect(gen, false);
    if (g.__host) g.__host.print('[sp] loopback connect');
};

g.__sp_demandConnect = function (gen: number): void {
    demandClient = new LoopbackClientSocket(gen >>> 0, true);
    if (g.__host) g.__host.print('[sp] on-demand loopback connect');
};

function feed(client: ClientSocket | null, bytes: Uint8Array): void {
    if (!client) {
        return;
    }
    try {
        if (client.state === -1 || client.remaining <= 0) {
            client.terminate();
            return;
        }
        client.buffer(bytes as any);
        // same routing as TcpServer
        if (client.state === 0) {
            World.onClientData(client);
        } else {
            OnDemand.onClientData(client);
        }
    } catch (e: any) {
        if (g.__host) g.__host.print('[sp] onClientData threw: ' + (e && e.message ? e.message : String(e)));
        client.terminate();
    }
}

g.__sp_onClientData = function (bytes: Uint8Array): void {
    feed(gameClient, bytes);
};

g.__sp_onDemandData = function (bytes: Uint8Array): void {
    feed(demandClient, bytes);
};

function disconnect(client: LoopbackClientSocket | null): void {
    if (!client) {
        return;
    }
    client.state = -1;
    OnDemand.onClientClosed(client);
    if (client.player) {
        // the world drops the player next cycle
        client.player.client = client;
    }
}

g.__sp_clientDisconnect = function (): void {
    disconnect(gameClient);
    gameClient = null;
};

g.__sp_demandDisconnect = function (): void {
    disconnect(demandClient);
    demandClient = null;
};

// ---- network guests (LAN / ad-hoc hosting) ----
// host calls __sp_net*, replies go through __host.netSend / __host.netClose

// guest cap is enforced by the host's login shim instead
(Environment as any).node.maxConnected = 2000;

class NetClientSocket extends ClientSocket {
    readonly peerId: number;
    // address as reported by the host
    readonly peerAddress: string;
    // set once the peer is closed on either side
    closed = false;

    constructor(peerId: number, peerAddress: string) {
        super();
        this.peerId = peerId;
        this.peerAddress = peerAddress;
        this.remoteAddress = engineAddress(peerAddress);
    }

    send(src: Uint8Array): void {
        // not gated on state, a refused guest still gets the reply code
        if (this.closed) {
            return;
        }
        this.totalBytesWritten += src.length;
        g.__host.netSend(this.peerId, src);
    }

    close(): void {
        // graceful: queued bytes are flushed first
        this.shut(true);
    }

    terminate(): void {
        this.shut(false);
    }

    private shut(graceful: boolean): void {
        this.state = -1;
        if (this.closed) {
            return;
        }
        this.closed = true;
        g.__host.netClose(this.peerId, graceful);
    }
}

// peer address as an IPv4 string the engine accepts, MACs map to 169.254.x.y
function engineAddress(addr: string): string {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/.exec(addr);
    if (m && +m[1] <= 255 && +m[2] <= 255 && +m[3] <= 255 && +m[4] <= 255) {
        return m[1] === '127' ? '127.0.0.2' : `${+m[1]}.${+m[2]}.${+m[3]}.${+m[4]}`;
    }
    let h = 0;
    for (let i = 0; i < addr.length; i++) {
        h = (Math.imul(h, 31) + addr.charCodeAt(i)) >>> 0;
    }
    return `169.254.${(h >>> 8) & 255}.${h & 255}`;
}

function hostingEnabled(): boolean {
    const v = String(g.process?.env?.SP_HOSTING ?? '').toLowerCase();
    return v !== '' && v !== '0' && v !== 'off' && v !== 'offline' && v !== 'false' && v !== 'none';
}

function print(msg: string): void {
    if (g.__host && g.__host.print) g.__host.print(msg);
}

const netClients: Map<number, NetClientSocket> = new Map();
// uuids of open guest sockets
const netUuids: Set<string> = new Set();
// guests that disconnected while logged in and are still in the world
const droppedGuests: Set<any> = new Set();

g.__sp_netConnect = function (id: number, addr: string): void {
    id = id >>> 0;
    if (!hostingEnabled()) {
        g.__host.netClose(id, false);
        return;
    }
    const stale = netClients.get(id);
    if (stale) {
        // id reused without a close
        netDrop(stale);
    }
    const client = new NetClientSocket(id, String(addr));
    netClients.set(id, client);
    netUuids.add(client.uuid);
    print('[sp] guest ' + id + ' connected from ' + client.peerAddress);
};

g.__sp_netData = function (id: number, bytes: Uint8Array): void {
    feed(netClients.get(id >>> 0) ?? null, bytes);
};

g.__sp_netClose = function (id: number): void {
    const client = netClients.get(id >>> 0);
    if (client) {
        netDrop(client);
    }
};

function netDrop(client: NetClientSocket): void {
    netClients.delete(client.peerId);
    netUuids.delete(client.uuid);
    // the host already closed this peer
    client.closed = true;
    client.state = -1;
    OnDemand.onClientClosed(client);
    const p: any = client.player;
    if (p) {
        // also check the live player in case of a reconnect
        const live: any = World.getPlayerByUsername(p.username);
        for (const q of [p, live]) {
            if (q && q.client === client) {
                q.client = new NullClientSocket();
                droppedGuests.add(q);
            }
        }
    }
    print('[sp] guest ' + client.peerId + ' disconnected');
}

// usernames of guests holding a slot
function guestNames(): Set<string> {
    const names: Set<string> = new Set();
    for (const client of netClients.values()) {
        if (client.player && !client.closed) {
            names.add(client.player.username);
        }
    }
    for (const p of droppedGuests) {
        if (World.getPlayerByUsername(p.username) === p) {
            names.add(p.username);
        } else {
            droppedGuests.delete(p);
        }
    }
    return names;
}

// ---- helpers for the host's login shim ----

// true if the login came from a guest connection
g.__sp_netIsRemote = function (uuid: string): boolean {
    return netUuids.has(String(uuid));
};

g.__sp_playerOnline = function (username: string): boolean {
    return World.getPlayerByUsername(String(username)) !== undefined;
};

// guests holding a slot, not counting `exclude`
g.__sp_netGuestCount = function (exclude?: string): number {
    const names = guestNames();
    if (exclude) {
        names.delete(String(exclude));
    }
    return names.size;
};

// refuse a pending login with a raw handshake code (7 = world full)
g.__sp_loginReject = function (uuid: string, code: number): boolean {
    const client = World.loginRequests.get(String(uuid));
    if (!client) {
        return false;
    }
    World.loginRequests.delete(String(uuid));
    client.send(Uint8Array.from([code & 0xff]));
    client.close();
    return true;
};

// log out every guest, returns how many were asked to leave
g.__sp_netKickAll = function (): number {
    let kicked = 0;
    const seen: Set<any> = new Set();
    for (const client of [...netClients.values()]) {
        const p: any = client.player ? World.getPlayerByUsername(client.player.username) : undefined;
        if (p && p.client === client) {
            seen.add(p);
        } else {
            client.close();
        }
    }
    for (const p of droppedGuests) {
        if (World.getPlayerByUsername(p.username) === p) {
            seen.add(p);
        }
    }
    for (const p of seen) {
        p.loggingOut = true;
        kicked++;
    }
    return kicked;
};
