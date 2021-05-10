export interface Cache {
    lastInstrument: number;
    lastKey: number;
}

export interface Mappings {
    colors: {
        slots: {
            [key: number]: Position;
        };
    };
    instruments: {
        slots: {
            [key: number]: Position;
        };
    };
    noteblocks: {
        slots: {
            [key: number]: Position;
        };
    };
    particles: {
        amount: number;
        delta: string;
        speed: number;
        slots: {
            [key: number]: Position;
        };
        type: string;
    };
    redstone: {
        slots: {
            [key: number]: Position;
        };
    };
    spawn: {
        slots: {
            [key: number]: Position;
        };
    };
    track: {
        end: Position;
        start: Position;
    };
}

export interface Position {
    x: number;
    y: number;
    z: number;
}
