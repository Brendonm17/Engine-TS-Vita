// no database in single-player, any use throws
export const db = new Proxy({}, {
    get() {
        throw new Error('DB disabled in single-player');
    }
});
export function toDbDate(date) {
    return date;
}
