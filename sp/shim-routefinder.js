// pathfinder routed to the host's C port (__host.rsmod_*)
import { CollisionFlag, CollisionType, LocAngle, LocLayer, LocShape, locShapeLayer } from '#/engine/routefinder/flags.js';

export { CollisionFlag, CollisionType, LocAngle, LocLayer, LocShape, locShapeLayer };

const H = globalThis.__host;

const routefinder = {
    findPath(y, srcX, srcZ, destX, destZ, srcSize, destWidth, destHeight, angle, shape, moveNear, blockAccessFlags, maxWaypoints, collision) {
        return H.rsmod_findPath(y, srcX, srcZ, destX, destZ, srcSize, destWidth, destHeight, angle, shape, moveNear, blockAccessFlags, maxWaypoints, collision);
    },
    findNaivePath(y, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag, collision) {
        return H.rsmod_findNaivePath(y, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag, collision);
    },
    changeFloor(x, z, y, add) {
        H.rsmod_changeFloor(x, z, y, add);
    },
    changeLoc(x, z, y, width, length, blockrange, add) {
        H.rsmod_changeLoc(x, z, y, width, length, blockrange, false, add);
    },
    changeNpc(x, z, y, size, add) {
        H.rsmod_changeSquare(x, z, y, size, CollisionFlag.NPC_OCC, add);
    },
    changeBlock(x, z, y, size, add) {
        H.rsmod_changeSquare(x, z, y, size, CollisionFlag.BLOCK_NPC_AND_PLAYERS, add);
    },
    changePlayerOcc(x, z, y, size, add) {
        H.rsmod_changeSquare(x, z, y, size, CollisionFlag.PLAYER_OCC, add);
    },
    changeRoof(x, z, y, add) {
        H.rsmod_changeRoof(x, z, y, add);
    },
    changeWall(x, z, y, angle, shape, blockrange, add) {
        H.rsmod_changeWall(x, z, y, angle, shape, blockrange, false, add);
    },
    allocateIfAbsent(x, z, y) {
        H.rsmod_allocateIfAbsent(x, z, y);
    },
    deallocateIfPresent(x, z, y) {
        H.rsmod_deallocateIfPresent(x, z, y);
    },
    isZoneAllocated(x, z, y) {
        return H.rsmod_isZoneAllocated(x, z, y);
    },
    isFlagged(x, z, y, masks) {
        return H.rsmod_isFlagged(x, z, y, masks);
    },
    canTravel(y, x, z, offsetX, offsetZ, size, extraFlag, collision) {
        return H.rsmod_canTravel(y, x, z, offsetX, offsetZ, size, extraFlag, collision);
    },
    hasLineOfSight(y, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag) {
        return H.rsmod_hasLineOfSight(y, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag);
    },
    hasLineOfWalk(y, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag) {
        return H.rsmod_hasLineOfWalk(y, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag);
    },
    lineOfSight(y, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag) {
        return H.rsmod_lineOfSight(y, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag);
    },
    lineOfWalk(y, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag) {
        return H.rsmod_lineOfWalk(y, srcX, srcZ, destX, destZ, srcWidth, srcHeight, destWidth, destHeight, extraFlag);
    },
    reached(y, srcX, srcZ, destX, destZ, destWidth, destHeight, srcSize, angle, shape, blockAccessFlags) {
        return H.rsmod_reached(y, srcX, srcZ, destX, destZ, destWidth, destHeight, srcSize, angle, shape, blockAccessFlags);
    },
    locShapeLayer(shape) {
        return locShapeLayer(shape);
    },
    __set(x, z, y, mask) {
        H.rsmod_set(x, z, y, mask);
    }
};

export default routefinder;

export const findPath = routefinder.findPath;
export const findNaivePath = routefinder.findNaivePath;
export const changeFloor = routefinder.changeFloor;
export const changeLoc = routefinder.changeLoc;
export const changeNpc = routefinder.changeNpc;
export const changeBlock = routefinder.changeBlock;
export const changePlayerOcc = routefinder.changePlayerOcc;
export const changeRoof = routefinder.changeRoof;
export const changeWall = routefinder.changeWall;
export const allocateIfAbsent = routefinder.allocateIfAbsent;
export const deallocateIfPresent = routefinder.deallocateIfPresent;
export const isZoneAllocated = routefinder.isZoneAllocated;
export const isFlagged = routefinder.isFlagged;
export const canTravel = routefinder.canTravel;
export const hasLineOfSight = routefinder.hasLineOfSight;
export const hasLineOfWalk = routefinder.hasLineOfWalk;
export const lineOfSight = routefinder.lineOfSight;
export const lineOfWalk = routefinder.lineOfWalk;
export const reached = routefinder.reached;
export const __set = routefinder.__set;
