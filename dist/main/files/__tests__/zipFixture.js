"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildZip = buildZip;
exports.miniXlsx = miniXlsx;
const zlib_1 = require("zlib");
/**
 * Minimal ZIP writer for building .xlsx fixtures in tests. Produces either
 * stored or deflated entries with a correctly-shaped central directory and
 * EOCD record, so the N-06 reader (and any real zip parser) can open it.
 * CRC fields are zeroed: no reader in these tests validates them.
 */
function buildZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of entries) {
        const inflateRaw = !entry.store;
        const compressed = inflateRaw ? (0, zlib_1.deflateRawSync)(entry.data) : entry.data;
        const name = Buffer.from(entry.name, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(inflateRaw ? 8 : 0, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0, 12);
        local.writeUInt32LE(0, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(entry.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        localParts.push(local, name, compressed);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(inflateRaw ? 8 : 0, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0, 14);
        central.writeUInt32LE(0, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, name);
        offset += local.length + name.length + compressed.length;
    }
    const centralBody = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBody.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, centralBody, eocd]);
}
/** Wraps shared strings + a worksheet into a readable mini-XLSX buffer. */
function miniXlsx(sharedStrings, sheetXml, store = false) {
    const sharedXml = sharedStrings.map(s => `<si><t>${s}</t></si>`).join('');
    return buildZip([
        { name: 'xl/sharedStrings.xml', data: Buffer.from(`<sst>${sharedXml}</sst>`, 'utf8'), store },
        { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8'), store },
    ]);
}
