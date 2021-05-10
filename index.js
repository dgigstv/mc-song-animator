#!/usr/bin/env node

const constants = require('./constants');
const fs = require('fs').promises;
const nbsViewer = require('nbs-viewer');
const { argv } = require('yargs/yargs')(process.argv.slice(2))
    .usage('Usage: $0 -f [fileName.nbs] -m [mappings.json]')
    .alias('f', 'file')
    .describe('file', 'Loads an NBS file')
    .alias('m', 'mapping')
    .describe('mapping', 'File to load mappings from')
    .demandOption(['file', 'mapping'])
    .help();

const trackLength = 50;

(async function main() {
    const mappings = require(argv.mapping);
    let file = await fs.open('output.mcfunction', 'w');
    let trackFile = await fs.open('track.mcfunction', 'w');

    try {
        const nbs = await nbsViewer.read(argv.file);

        for (let i = 54; i <= (52 + trackLength); i++) {
            const toWrite = Buffer.from(`execute in minecraft:the_end run clone 46 ${i} 181 62 ${i} 181 46 ${i - 1} 181 replace normal\n`);

            await trackFile.write(toWrite, 0, toWrite.length);
        }

        const trackFencepost = Buffer.from(`execute in minecraft:the_end run fill 46 ${52 + trackLength} 181 62 ${52 + trackLength} 181 minecraft:air\n`);
        await trackFile.write(trackFencepost, 0, trackFencepost.length);

        for (let i = 0; i < (1 * nbs.header.songLength + trackLength + 1); i++) {
            let toWrite = void 0;

            // Fencepost here - first command should not be a schedule
            if (i > 0) {
                toWrite = Buffer.from(`execute in minecraft:the_end run schedule function custom:track/move_track ${i}t append\n`, 'utf8');
            } else {
                toWrite = Buffer.from(`execute in minecraft:the_end run function custom:track/move_track\n`, 'utf8');
            }

            const { bytesWritten } = await file.write(toWrite, 0, toWrite.length);

            if (bytesWritten !== toWrite.length) {
                throw new Error();
            }
        }

        const tickOffset = trackLength;
        const layerCache = new Map();

        // Populate layer cache.
        for (let i = 0; i < nbs.header.layerCount; i++) {
            layerCache.set(i, {
                lastInstrument: -1,
                lastKey: -1,
            });
        }

        for await (const tick of nbs.ticks) {
            let animationToWrite = '';
            let musicToWrite = '';

            for (const layer of tick.layers) {
                const cache = layerCache.get(layer.layer);
                const slot = `slot${layer.layer}Position`;

                if (layer.key !== cache.lastKey) {
                    const mcKeyConversion = layer.key - 33;
                    
                    if (mcKeyConversion < 0 || mcKeyConversion > 24) {
                        throw new Error('Key is out of range.');
                    }

                    musicToWrite += `execute in minecraft:the_end run setblock ${mappings.noteblocks[slot]} minecraft:note_block[note=${mcKeyConversion}] replace\n`;
                    cache.lastKey = layer.key;
                }

                if (layer.instrument !== cache.lastInstrument) {
                    const newInstrumentBlock = constants.instrumentToBlock[layer.instrument];

                    if (!newInstrumentBlock) {
                        throw new Error('Unknown instrument');
                    }

                    musicToWrite += `execute in minecraft:the_end run setblock ${mappings.instruments[slot]} ${newInstrumentBlock} replace\n`;
                    musicToWrite += `execute in minecraft:the_end run setblock ${mappings.colors[slot]} ${constants.instrumentToGlass[layer.instrument]} replace\n`;
                    cache.lastInstrument = layer.instrument;
                }

                animationToWrite += `execute in minecraft:the_end run setblock ${mappings.spawn[slot]} ${constants.instrumentToGlass[layer.instrument]} replace\n`;
                musicToWrite += `execute in minecraft:the_end run particle ${mappings.particles.type} ${mappings.particles[slot]} ${mappings.particles.delta} ${mappings.particles.speed} ${mappings.particles.amount}\n`
                musicToWrite += `execute in minecraft:the_end run setblock ${mappings.redstone[slot]} minecraft:redstone_block destroy\n`;
            }

            await fs.writeFile(`music/tick_${tick.tick}.mcfunction`, musicToWrite);
            await fs.writeFile(`animation/tick_${tick.tick}.mcfunction`, animationToWrite);

            let scheduleToWrite = `execute in minecraft:the_end run schedule function custom:music/tick_${tick.tick} ${1 * tick.tick + tickOffset}t append\n`;
            scheduleToWrite += `execute in minecraft:the_end run schedule function custom:animation/tick_${tick.tick} ${1 * tick.tick}t append\n`;
            const scheduleWriter = Buffer.from(scheduleToWrite, 'utf8');

            await file.write(scheduleWriter, 0, scheduleWriter.length);
        }
    } finally {
        await file.close();
        await trackFile.close();
    }
})()
    .then(() => console.log('Done!'));
