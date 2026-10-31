// no-op metrics
const noop = {
    inc() {}, dec() {}, set() {}, observe() {}, reset() {},
    get() { return 0; }, remove() {},
    startTimer() { return function () {}; },
    labels() { return noop; }
};

export const trackPlayerCount = noop;
export const trackNpcCount = noop;
export const trackCycleTime = noop;
export const trackCycleWorldTime = noop;
export const trackCycleClientInTime = noop;
export const trackCycleClientOutTime = noop;
export const trackCycleNpcTime = noop;
export const trackCyclePlayerTime = noop;
export const trackCycleZoneTime = noop;
export const trackCycleLoginTime = noop;
export const trackCycleLogoutTime = noop;
export const trackCycleBandwidthInBytes = noop;
export const trackCycleBandwidthOutBytes = noop;
export const trackSessionEventsPublished = noop;
export const trackLoginAttempts = noop;
export const trackLoginTime = noop;
export default noop;
