#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const RIGHTS_MARKER = "MHTR_IMAGE_RIGHTS_v1";
const CREATOR = "Vinay Chittora";
const CREDIT = "Cane & Camera - Vinay Chittora / MHTR.in";
const COPYRIGHT = "Copyright 2026 Cane & Camera - Vinay Chittora. All rights reserved.";
const USAGE =
  "Photo by Cane & Camera - Vinay Chittora for MHTR.in. Do not copy, crop, redistribute, train models with, or reuse without written permission.";

const TARGET_DIRS = [
  "src/assets/assets/imgs/home",
  "src/assets/assets/imgs/landscape",
  "src/assets/assets/imgs/field-reports",
];

const EXCLUDED_FILE_NAMES = new Set([
  "gis-map-library.jpg",
]);

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath);
    }

    if (!/\.(jpe?g)$/i.test(entry.name) || EXCLUDED_FILE_NAMES.has(entry.name)) {
      return [];
    }

    return [fullPath];
  });
}

function createSegment(marker, payload) {
  const length = payload.length + 2;
  if (length > 0xffff) {
    throw new Error(`JPEG segment is too large: ${length} bytes`);
  }

  const segment = Buffer.alloc(length + 2);
  segment[0] = 0xff;
  segment[1] = marker;
  segment.writeUInt16BE(length, 2);
  payload.copy(segment, 4);
  return segment;
}

function createXmpSegment(relativePath) {
  const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
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
      xmp:CreatorTool="MHTR.in web image pipeline">
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
      <dc:source>${escapeXml(relativePath)}</dc:source>
      <dc:identifier>${RIGHTS_MARKER}</dc:identifier>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

  const header = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "utf8");
  return createSegment(0xe1, Buffer.concat([header, Buffer.from(xmp, "utf8")]));
}

function createCommentSegment() {
  const comment = `${RIGHTS_MARKER}: ${COPYRIGHT} ${USAGE}`;
  return createSegment(0xfe, Buffer.from(comment, "utf8"));
}

function stripExistingRightsSegments(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Not a JPEG file");
  }

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
    const payload = buffer.subarray(offset + 4, end);
    const payloadText = payload.toString("utf8");
    const isXmp = marker === 0xe1 && payloadText.startsWith("http://ns.adobe.com/xap/1.0/");
    const isRightsComment = marker === 0xfe && payloadText.includes(RIGHTS_MARKER);

    if (!isXmp && !isRightsComment) {
      chunks.push(buffer.subarray(offset, end));
    }

    offset = end;
  }

  return Buffer.concat(chunks);
}

function embedRights(filePath) {
  const original = fs.readFileSync(filePath);
  const stripped = stripExistingRightsSegments(original);
  const relativePath = path.relative(ROOT, filePath);
  const next = Buffer.concat([
    stripped.subarray(0, 2),
    createXmpSegment(relativePath),
    createCommentSegment(),
    stripped.subarray(2),
  ]);

  fs.writeFileSync(filePath, next);
}

const files = TARGET_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));

for (const file of files) {
  embedRights(file);
}

console.log(`Embedded rights metadata in ${files.length} JPEG files.`);
