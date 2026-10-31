// zlib shim over fflate
import { gzipSync as fflateGzip, gunzipSync as fflateGunzip } from 'fflate';

export function gzipSync(data) {
    return fflateGzip(data instanceof Uint8Array ? data : new Uint8Array(data));
}

export function gunzipSync(data) {
    return fflateGunzip(data instanceof Uint8Array ? data : new Uint8Array(data));
}

export default { gzipSync, gunzipSync };
