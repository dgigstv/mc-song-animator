import { constants } from './constants';

export function hasInstrumentToBlockMapping (instr: number): instr is keyof (typeof constants.instrumentToBlock) {
    return constants.instrumentToBlock[(instr as keyof (typeof constants.instrumentToBlock))] !== undefined;
}

export function hasInstrumentToGlassMapping (instr: number): instr is keyof (typeof constants.instrumentToGlass) {
    return constants.instrumentToGlass[(instr as keyof (typeof constants.instrumentToGlass))] !== undefined;
}

export function hasWorldMapping (world: string): world is keyof (typeof constants.worlds) {
    return constants.worlds[(world as keyof (typeof constants.worlds))] !== undefined;
}

export function isValidMinecraftNote (note: number) {
    return note >= 0 && note <= 24;
}
