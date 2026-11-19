const encoder = new TextEncoder();
const frameMarkers = new Set([0xc0, 0xc1, 0xc2]);

function jpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Expected a JPEG page.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let position = 2; position + 4 < bytes.length;) {
    if (bytes[position++] !== 0xff) break;
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (marker === 0xda || marker === 0xd9 || position + 2 > bytes.length) break;
    const length = view.getUint16(position);
    if (length < 2 || position + length > bytes.length) break;
    if (frameMarkers.has(marker) && length >= 8 && bytes[position + 2] === 8) {
      const height = view.getUint16(position + 3);
      const width = view.getUint16(position + 5);
      const components = bytes[position + 7];
      if (height && width && [1, 3].includes(components)) return { width, height, components };
    }
    position += length;
  }
  throw new Error('Unsupported JPEG page.');
}

export function makePdf(images) {
  const chunks = [];
  const offsets = [0];
  const pageImages = [];
  let size = 0;
  function append(value) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    size += bytes.byteLength;
  }
  function object(value, stream) {
    const id = offsets.length;
    offsets.push(size);
    append(id + ' 0 obj\n' + value);
    let streamOffset;
    if (stream) {
      append('\nstream\n');
      streamOffset = size;
      append(stream);
      append('\nendstream');
    }
    append('\nendobj\n');
    return streamOffset;
  }
  append('%PDF-1.4\n');
  append(new Uint8Array([37, 226, 227, 207, 211, 10]));
  object('<< /Type /Catalog /Pages 2 0 R >>');
  const pageRefs = images.map((_, index) => (3 + 3 * index) + ' 0 R').join(' ');
  object('<< /Type /Pages /Count ' + images.length + ' /Kids [' + pageRefs + '] >>');
  for (const image of images) {
    const { width, height, components } = jpegSize(image);
    const pageWidth = height > width ? 612 : 792;
    const pageHeight = height > width && height / width > 1.5 ? 1008 : height > width ? 792 : 612;
    const scale = Math.min(pageWidth / width, pageHeight / height);
    const w = width * scale;
    const h = height * scale;
    const pageId = offsets.length;
    object('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageWidth + ' ' + pageHeight +
      '] /Resources << /XObject << /PageImage ' + (pageId + 1) +
      ' 0 R >> >> /Contents ' + (pageId + 2) + ' 0 R >>');
    const color = components === 1 ? '/DeviceGray' : '/DeviceRGB';
    const imageOffset = object('<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height +
      ' /ColorSpace ' + color + ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + image.length + ' >>', image);
    pageImages.push([imageOffset, image.length]);
    const command = encoder.encode('q\n' + [w, 0, 0, h, (pageWidth - w) / 2, (pageHeight - h) / 2]
      .map(value => value.toFixed(4)).join(' ') + ' cm\n/PageImage Do\nQ\n');
    object('<< /Length ' + command.length + ' >>', command);
  }
  const xref = size;
  append('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) {
    append(String(offset).padStart(10, '0') + ' 00000 n \n');
  }
  append('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return { pdf: new Blob(chunks, { type: 'application/pdf' }), pageImages };
}
