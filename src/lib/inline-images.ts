/**
 * Pasted screenshots arrive in a description as inline `data:` images. Azure
 * DevOps strips a `data:` src when it saves the HTML, leaving `<img alt=…>`
 * with no picture, so the screenshot was lost in ZapDesk and DevOps alike.
 * Each one is uploaded as a DevOps attachment first and its src pointed at
 * that, the way DevOps's own editor stores a pasted image.
 */

/** What this needs from the DevOps service: just the attachment upload. */
export interface AttachmentUploader {
  uploadAttachment(
    projectName: string,
    fileName: string,
    fileContent: ArrayBuffer,
    contentType: string
  ): Promise<{ id: string; url: string }>;
}

/** The most inline images one description may carry. */
export const MAX_INLINE_IMAGES = 20;
/** The largest inline image accepted, decoded. Matches the attachment limit. */
export const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

/** A description whose inline images could not be stored; said to the caller as a 400 or 502. */
export class InlineImageError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 502
  ) {
    super(message);
    this.name = 'InlineImageError';
  }
}

const EXTENSIONS: Record<string, string> = {
  png: 'png',
  jpeg: 'jpg',
  jpg: 'jpg',
  gif: 'gif',
  webp: 'webp',
};

/** An <img> tag. A `>` inside a quoted attribute (`alt="a > b"`) does not end it. */
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
/**
 * One attribute of a tag: a name, then an optional value, quoted or bare. A
 * quoted value is consumed whole, so text inside one (an alt that mentions
 * `src='data:…'`) is never read as an attribute of its own (#697 review).
 */
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
/** A src value that is an inline image of a kind we store. */
const INLINE_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]*)$/i;

/** An inline image found in the HTML: where its src value sits, and what it holds. */
interface InlineImage {
  /** The src value's position in the HTML, quotes excluded. */
  start: number;
  end: number;
  kind: string;
  base64: string;
  alt: string;
}

/** Every <img> whose own src attribute is an inline image, in document order. */
function findInlineImages(html: string): InlineImage[] {
  const found: InlineImage[] = [];
  for (const tag of html.matchAll(IMG_TAG)) {
    // Attributes start after "<img" and end before ">".
    const offset = (tag.index ?? 0) + 4;
    const inner = tag[0].slice(4, -1);
    let src: { value: string; start: number; end: number } | null = null;
    let alt = '';
    for (const attr of inner.matchAll(ATTRIBUTE)) {
      const name = attr[1].toLowerCase();
      const quoted = attr[2] !== undefined || attr[3] !== undefined;
      const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
      if (name === 'alt') alt = value;
      // The first src wins, as it does in a browser.
      if (name === 'src' && !src) {
        const end = offset + (attr.index ?? 0) + attr[0].length - (quoted ? 1 : 0);
        src = { value, start: end - value.length, end };
      }
    }
    const data = src?.value.match(INLINE_DATA);
    if (src && data) {
      found.push({ start: src.start, end: src.end, kind: data[1], base64: data[2], alt });
    }
  }
  return found;
}

/** A file name for the upload: the image's alt text when it looks like one, else a numbered one. */
function fileNameFor(alt: string, kind: string, index: number): string {
  const ext = EXTENSIONS[kind.toLowerCase()];
  const base = alt
    .trim()
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .slice(0, 80);
  return `${base || 'pasted-image'}-${index + 1}.${ext}`;
}

/**
 * The description with every inline image uploaded to `project` and its src
 * replaced by the attachment URL. Unchanged when there are none. Throws
 * InlineImageError rather than saving a description that would lose a picture.
 */
export async function uploadInlineImages(
  html: string,
  project: string,
  uploader: AttachmentUploader
): Promise<string> {
  const images = findInlineImages(html);
  if (images.length === 0) return html;
  if (images.length > MAX_INLINE_IMAGES) {
    throw new InlineImageError(
      `At most ${MAX_INLINE_IMAGES} pasted images per description; attach the rest as files`,
      400
    );
  }

  // Every image is checked before any is uploaded, so a refused request
  // leaves no attachment behind (#697 review).
  const decoded = images.map((image, index) => {
    const bytes = Buffer.from(image.base64.replace(/\s+/g, ''), 'base64');
    if (bytes.length === 0) {
      throw new InlineImageError(`Pasted image ${index + 1} is empty`, 400);
    }
    if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
      throw new InlineImageError(
        `Pasted image ${index + 1} is larger than ${MAX_INLINE_IMAGE_BYTES / 1024 / 1024} MB`,
        400
      );
    }
    return bytes;
  });

  const urls = await Promise.all(
    images.map(async (image, index) => {
      const bytes = decoded[index];
      const kind = image.kind.toLowerCase();
      const fileName = fileNameFor(image.alt, kind, index);
      try {
        const { url } = await uploader.uploadAttachment(
          project,
          fileName,
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          `image/${kind === 'jpg' ? 'jpeg' : kind}`
        );
        return url;
      } catch (error) {
        console.error(`[Inline images] Upload of ${fileName} failed:`, error);
        throw new InlineImageError(
          `Could not store pasted image ${index + 1} in Azure DevOps; nothing was saved`,
          502
        );
      }
    })
  );

  // Rebuilt from the positions found above, so each URL replaces exactly the
  // src value it was uploaded from.
  let result = '';
  let cursor = 0;
  images.forEach((image, index) => {
    result += html.slice(cursor, image.start) + urls[index];
    cursor = image.end;
  });
  return result + html.slice(cursor);
}
