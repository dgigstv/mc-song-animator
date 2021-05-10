import { Position } from './interface';

export function positionToString (pos: Position) {
    return `${pos.x} ${pos.y} ${pos.z}`;
}
