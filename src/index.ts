#!/usr/bin/env node

import { constants } from './constants';
import path from 'path';
import { Cache, Mappings } from './interface';
import yargs from 'yargs';
import * as nbsViewer from 'nbs-viewer';
import * as fs from 'fs/promises';
import { hasInstrumentToBlockMapping, hasInstrumentToGlassMapping, hasWorldMapping, isValidMinecraftNote } from './guard';
import { positionToString } from './util';
import mkdirp from 'mkdirp';

const { argv } = yargs(process.argv.slice(2))
    .options({
        'file': {
            alias: 'f',
            demandOption: true,
            describe: 'Loads an NBS file',
            type: 'string',
        },
        'mapping': {
            alias: 'm',
            demandOption: true,
            describe: 'File to load mappings from',
            type: 'string',
        },
        'namespace': {
            alias: 'n',
            default: 'music',
            demandOption: false,
            describe: 'Minecraft datapack namespace to execute commands from',
            type: 'string',
        },
        'output': {
            alias: 'o',
            demandOption: false,
            default: 'output',
            describe: 'Output folder location',
            type: 'string',
        },
        'trackLength': {
            alias: 't',
            demandOption: false,
            default: 50,
            describe: 'Length of the animated track',
            type: 'number',
        },
        'world': {
            alias: 'w',
            choices: [
                'end',
                'nether',
                'world',
            ],
            demandOption: false,
            default: 'world',
            describe: 'World to execute commands in',
        }
    })
    .usage('Usage: $0 -f [fileName.nbs] -m [mappings.json]')
    .help();

async function readMappings (path: string): Promise<Mappings> {
    const file = await fs.readFile(path, { encoding: 'utf-8' });

    return JSON.parse(file);
}

function createCache (layerCount: number) {
    const layerCache = new Map<number, Cache>();

    // Populate layer cache.
    for (let i = 0; i < layerCount; i++) {
        layerCache.set(i, {
            lastInstrument: -1,
            lastKey: -1,
        });
    }

    return layerCache;
}

async function createTrackFile (mappings: Mappings, trackLength: number, trackFileName: string, worldCmd: string) {
    const trackFile = await fs.open(trackFileName, 'w');

    await trackFile.write(Buffer.from(constants.fileHeader));

    try {
        const { track: { start: { x: startX, y: startY, z: startZ }, end: { x: endX, z: endZ } } } = mappings;

        for (let y = (startY + 1); y < (startY + trackLength); y++) {
            const toWrite = Buffer.from(`${worldCmd} clone ${startX} ${y} ${startZ} ${endX} ${y} ${endZ} ${startX} ${y - 1} ${startZ} replace normal\n`);

            await trackFile.write(toWrite, 0, toWrite.length);
        }

        const trackFencepost = Buffer.from(`${worldCmd} fill ${startX} ${startY + trackLength - 1} ${endZ} ${endX} ${startY + trackLength} ${endZ} minecraft:air\n`);

        await trackFile.write(trackFencepost, 0, trackFencepost.length);
    } finally {
        await trackFile.close();
    }
}

async function createPlayFile (songLength: number, playFileName: string, tickDirName: string, fps: number, trackLength: number, worldCmd: string, namespace: string) {
    const playFile = await fs.open(playFileName, 'w');

    await playFile.write(Buffer.from(constants.fileHeader));

    try {
        for (let i = 0; i < (fps * songLength + trackLength + 1); i++) {
            let toWrite: Buffer;

            // Fencepost here - first command should not be a schedule and should not cause the track to move.
            if (i > 0) {
                toWrite = Buffer.from(`${worldCmd} schedule function ${namespace}:${constants.fileNames.tickDir}/tick_${i} ${i}t append\n`, 'utf8');

                // Now do the individual tick file.
                const tickFileName = path.join(tickDirName, `tick_${i}.mcfunction`);
                const tickFile = await fs.open(tickFileName, 'w');

                await tickFile.write(Buffer.from(constants.fileHeader));

                try {
                    const trackWrite = Buffer.from(`${worldCmd} function ${namespace}:${constants.fileNames.track.dir}/${constants.fileNames.track.name}\n`);
                    await tickFile.write(trackWrite, 0, trackWrite.length);
                } finally {
                    await tickFile.close();
                }
            } else {
                toWrite = Buffer.from(`${worldCmd} function ${namespace}:${constants.fileNames.tickDir}/tick_${i}\n`, 'utf8');
            }

            await playFile.write(toWrite, 0, toWrite.length);
        }
    } finally {
        await playFile.close();
    }
}

(async function main () {
    const { namespace, output, trackLength, world } = argv;
    const outputDirName = path.join(process.cwd(), output);
    const playFileName = path.join(outputDirName, constants.fileNames.main);
    const trackDirName = path.join(outputDirName, constants.fileNames.track.dir);
    const trackFileName = path.join(trackDirName, constants.fileNames.track.fileName);
    const tickDirName = path.join(outputDirName, constants.fileNames.tickDir);

    if (!hasWorldMapping(world)) {
        throw new Error(`Invalid world: ${world}`);
    }

    // Create the output folders
    await mkdirp(trackDirName);
    await mkdirp(tickDirName);

    const worldCmd = `execute in ${constants.worlds[world]} run`;
    const mappings = await readMappings(argv.mapping);
    const nbs = await nbsViewer.read(argv.file);
    const fps = constants.nbs.maxFramesPerSecond / nbs.header.songTempo; // really frames per Minecraft tick

    if (constants.nbs.maxFramesPerSecond % nbs.header.songTempo !== 0) {
        throw new Error('Tempo does not divide evently into max number of frames per second.');
    }

    await createTrackFile(mappings, trackLength, trackFileName, worldCmd);
    await createPlayFile(nbs.header.songLength, playFileName, tickDirName, fps, trackLength, worldCmd, namespace);

    const layerCache = createCache(nbs.header.layerCount);

    for await (const tick of nbs.ticks) {
        let animationToWrite = '';
        let musicToWrite = '';
        const animationTick = fps * tick.tick;
        const musicTick = fps * tick.tick + trackLength;
        const animationFile = await fs.open(path.join(tickDirName, `tick_${animationTick}.mcfunction`), 'a');
        const musicFile = await fs.open(path.join(tickDirName, `tick_${musicTick}.mcfunction`), 'a');

        await animationFile.write(Buffer.from(constants.fileHeader));
        await musicFile.write(Buffer.from(constants.fileHeader));

        try {
            for (const layer of tick.layers) {
                const slot = layer.layer;
                const cache = layerCache.get(slot);

                if (!cache) {
                    throw new Error(`Invalid cache key: ${slot}`);
                }

                if (layer.key !== cache.lastKey) {
                    const mcKeyConversion = layer.key - constants.nbs.octaveStart;
                    
                    if (!isValidMinecraftNote(mcKeyConversion)) {
                        throw new Error('Key is out of range.');
                    }

                    const pos = positionToString(mappings.noteblocks.slots[slot]);

                    musicToWrite += `${worldCmd} setblock ${pos} minecraft:note_block[note=${mcKeyConversion}] replace\n`;
                    cache.lastKey = layer.key;
                }

                if (layer.instrument !== cache.lastInstrument) {
                    if (!hasInstrumentToBlockMapping(layer.instrument) || !hasInstrumentToGlassMapping(layer.instrument)) {
                        throw new Error(`Invalid instrument type: ${layer.instrument}`);
                    }

                    const newInstrumentBlock = constants.instrumentToBlock[layer.instrument];

                    if (!newInstrumentBlock) {
                        throw new Error('Unknown instrument');
                    }

                    const instrPos = positionToString(mappings.instruments.slots[slot]);
                    const colorGlassPos = positionToString(mappings.colors.slots[slot]); // change laser color

                    musicToWrite += `${worldCmd} setblock ${instrPos} ${newInstrumentBlock} replace\n`;
                    musicToWrite += `${worldCmd} setblock ${colorGlassPos} ${constants.instrumentToGlass[layer.instrument]} replace\n`;
                    cache.lastInstrument = layer.instrument;
                }

                if (hasInstrumentToGlassMapping(layer.instrument)) {
                    const spawnPos = positionToString(mappings.spawn.slots[slot]);

                    animationToWrite += `${worldCmd} setblock ${spawnPos} ${constants.instrumentToGlass[layer.instrument]} replace\n`;
                } else {
                    console.warn(`No instrument to glass mapping: ${layer.instrument}`);
                }

                const particlePos = positionToString(mappings.particles.slots[slot]);
                const redstonePos = positionToString(mappings.redstone.slots[slot]);

                musicToWrite += `${worldCmd} particle ${mappings.particles.type} ${particlePos} ${mappings.particles.delta} ${mappings.particles.speed} ${mappings.particles.amount}\n`
                musicToWrite += `${worldCmd} setblock ${redstonePos} minecraft:redstone_block destroy\n`;
            }

            const musicWriter = Buffer.from(musicToWrite, 'utf-8');
            const animationWriter = Buffer.from(animationToWrite, 'utf-8');

            await musicFile.write(musicWriter, 0, musicWriter.length);
            await animationFile.write(animationWriter, 0, animationWriter.length);
        } finally {
            await animationFile.close();
            await musicFile.close();
        }
    }
})()
    .then(() => console.log('Done!'));
