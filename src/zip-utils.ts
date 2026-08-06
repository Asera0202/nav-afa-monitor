import { inflateRawSync } from "node:zlib";

export function unzipSingleEntry(buffer: Buffer): Buffer {
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65536); i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Nem található ZIP End Of Central Directory rekord");

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  const CD_SIG = 0x02014b50;
  if (buffer.readUInt32LE(cdOffset) !== CD_SIG) {
    throw new Error("Nem található Central Directory File Header a várt helyen");
  }
  const method = buffer.readUInt16LE(cdOffset + 10);
  const compSize = buffer.readUInt32LE(cdOffset + 20);
  const localHeaderOffset = buffer.readUInt32LE(cdOffset + 42);

  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("Nem található Local File Header a Central Directory által jelzett helyen");
  }
  const localFnameLen = buffer.readUInt16LE(localHeaderOffset + 26);
  const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + localFnameLen + localExtraLen;
  const compData = buffer.subarray(dataStart, dataStart + compSize);

  if (method === 0) {
    return Buffer.from(compData);
  } else if (method === 8) {
    return inflateRawSync(compData);
  } else {
    throw new Error(`Nem támogatott ZIP tömörítési módszer: ${method}`);
  }
}
