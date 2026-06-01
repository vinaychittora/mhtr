#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const IMAGE_ROOT = path.join(ROOT, "src", "assets", "assets", "imgs");
const RIGHTS_MARKER = "MHTR_IMAGE_RIGHTS_v1";
const CREATOR = "Vinay Chittora";
const BRAND = "Cane & Camera by Vinay Chittora";
const CREDIT = `${BRAND} / MHTR.in`;
const COPYRIGHT = `Copyright 2026 ${BRAND}. All rights reserved.`;
const USAGE =
  `${BRAND} image for MHTR.in. Do not copy, crop, redistribute, train models with, or reuse without written permission.`;
const TARGET_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg"]);

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return TARGET_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [fullPath] : [];
  });
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath);
}

function rightsText(filePath) {
  return [
    RIGHTS_MARKER,
    `Creator: ${CREATOR}`,
    `Credit: ${CREDIT}`,
    COPYRIGHT,
    USAGE,
    `Source: ${relativePath(filePath)}`,
  ].join(" | ");
}

function createXmp(relativeFilePath) {
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="MHTR.in image rights">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description
      rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmpRights:Marked="True"
      photoshop:Credit="${escapeXml(CREDIT)}"
      xmp:CreatorTool="MHTR.in image rights pipeline">
      <dc:creator>
        <rdf:Seq>
          <rdf:li>${escapeXml(CREATOR)}</rdf:li>
        </rdf:Seq>
      </dc:creator>
      <dc:rights>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapeXml(COPYRIGHT)}</rdf:li>
        </rdf:Alt>
      </dc:rights>
      <xmpRights:UsageTerms>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapeXml(USAGE)}</rdf:li>
        </rdf:Alt>
      </xmpRights:UsageTerms>
      <dc:source>${escapeXml(relativeFilePath)}</dc:source>
      <dc:identifier>${RIGHTS_MARKER}</dc:identifier>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function hasRightsPayload(buffer) {
  const latin1 = buffer.toString("latin1");
  const utf8 = buffer.toString("utf8");
  return (
    latin1.includes(RIGHTS_MARKER) ||
    utf8.includes(RIGHTS_MARKER) ||
    latin1.includes("MHTR.in image rights") ||
    utf8.includes("MHTR.in image rights")
  );
}

function createJpegSegment(marker, payload) {
  const length = payload.length + 2;
  if (length > 0xffff) throw new Error(`JPEG segment is too large: ${length} bytes`);

  const segment = Buffer.alloc(length + 2);
  segment[0] = 0xff;
  segment[1] = marker;
  segment.writeUInt16BE(length, 2);
  payload.copy(segment, 4);
  return segment;
}

function createJpegXmpSegment(filePath) {
  const header = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "utf8");
  return createJpegSegment(0xe1, Buffer.concat([header, Buffer.from(createXmp(relativePath(filePath)), "utf8")]));
}

function createJpegCommentSegment(filePath) {
  return createJpegSegment(0xfe, Buffer.from(rightsText(filePath), "utf8"));
}

function stripExistingJpegRights(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("Not a JPEG file");

  const chunks = [buffer.subarray(0, 2)];
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xda || marker === 0xd9) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    const length = buffer.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    const segment = buffer.subarray(offset, end);
    const payload = buffer.subarray(offset + 4, end);

    if (!hasRightsPayload(payload)) chunks.push(segment);
    offset = end;
  }

  return Buffer.concat(chunks);
}

function embedJpegRights(filePath) {
  const original = fs.readFileSync(filePath);
  const stripped = stripExistingJpegRights(original);
  const next = Buffer.concat([
    stripped.subarray(0, 2),
    createJpegXmpSegment(filePath),
    createJpegCommentSegment(filePath),
    stripped.subarray(2),
  ]);
  fs.writeFileSync(filePath, next);
}

let crcTable;

function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      return value >>> 0;
    });
  }

  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function createPngTextChunks(filePath) {
  const text = rightsText(filePath);
  const textChunk = createPngChunk("tEXt", Buffer.from(`MHTR Rights\0${text}`, "latin1"));
  const xmpText = Buffer.from(createXmp(relativePath(filePath)), "utf8");
  const iTxtData = Buffer.concat([
    Buffer.from("XML:com.adobe.xmp\0", "latin1"),
    Buffer.from([0, 0]),
    Buffer.from("\0\0", "latin1"),
    xmpText,
  ]);
  return [textChunk, createPngChunk("iTXt", iTxtData)];
}

function stripExistingPngRights(buffer) {
  const signature = buffer.subarray(0, 8);
  if (signature.toString("hex") !== "89504e470d0a1a0a") throw new Error("Not a PNG file");

  const chunks = [signature];
  let offset = 8;
  let inserted = false;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const chunk = buffer.subarray(offset, offset + 12 + length);
    const isMetadata = type === "tEXt" || type === "iTXt" || type === "zTXt";

    if (!(isMetadata && hasRightsPayload(data))) chunks.push(chunk);

    if (type === "IHDR" && !inserted) {
      chunks.push(...createPngTextChunks(stripExistingPngRights.currentFilePath));
      inserted = true;
    }

    offset += 12 + length;
  }

  return Buffer.concat(chunks);
}

function embedPngRights(filePath) {
  const original = fs.readFileSync(filePath);
  stripExistingPngRights.currentFilePath = filePath;
  fs.writeFileSync(filePath, stripExistingPngRights(original));
}

function createWebpChunk(type, data) {
  const paddedLength = data.length + (data.length % 2);
  const chunk = Buffer.alloc(8 + paddedLength);
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function embedWebpRights(filePath) {
  const original = fs.readFileSync(filePath);
  if (original.subarray(0, 4).toString("ascii") !== "RIFF" || original.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error("Not a WebP file");
  }

  const chunks = [original.subarray(12, 12)];
  let offset = 12;
  while (offset + 8 <= original.length) {
    const type = original.subarray(offset, offset + 4).toString("ascii");
    const length = original.readUInt32LE(offset + 4);
    const paddedLength = length + (length % 2);
    const chunk = original.subarray(offset, offset + 8 + paddedLength);
    const data = original.subarray(offset + 8, offset + 8 + length);
    if (!(type === "XMP " && hasRightsPayload(data))) chunks.push(chunk);
    offset += 8 + paddedLength;
  }

  chunks.push(createWebpChunk("XMP ", Buffer.from(createXmp(relativePath(filePath)), "utf8")));
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, 4, "ascii");
  fs.writeFileSync(filePath, Buffer.concat([header, body]));
}

function embedSvgRights(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  const withoutOldMetadata = original.replace(
    /\n?\s*<metadata id="mhtr-image-rights">[\s\S]*?<\/metadata>\s*/g,
    "\n",
  );
  const metadata = `
  <metadata id="mhtr-image-rights">
    ${escapeXml(rightsText(filePath))}
  </metadata>`;

  if (!withoutOldMetadata.includes("<svg")) throw new Error("Not an SVG file");
  const next = withoutOldMetadata.replace(/(<svg\b[^>]*>)/, `$1${metadata}`);
  fs.writeFileSync(filePath, next);
}

function embedRights(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") embedJpegRights(filePath);
  else if (ext === ".png") embedPngRights(filePath);
  else if (ext === ".webp") embedWebpRights(filePath);
  else if (ext === ".svg") embedSvgRights(filePath);
}

const files = walk(IMAGE_ROOT);
const counts = {};

for (const file of files) {
  embedRights(file);
  const ext = path.extname(file).toLowerCase();
  counts[ext] = (counts[ext] || 0) + 1;
}

console.log(`Embedded rights metadata in ${files.length} image files.`);
console.table(counts);
