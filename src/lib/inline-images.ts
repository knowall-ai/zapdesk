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
/** Its src attribute, when it is an inline image of a kind we store. */
const INLINE_SRC =
  /(\bsrc\s*=\s*)(["'])data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]*)\2/i;
const ALT = /\balt\s*=\s*(["'])([^"']*)\1/i;

/** A file name for the upload: the image's alt text when it looks like one, else a numbered one. */
function fileNameFor(tag: string, kind: string, index: number): string {
  const ext = EXTENSIONS[kind.toLowerCase()];
  const alt = tag.match(ALT)?.[2]?.trim() ?? '';
  const base = alt
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
  const matches = [...html.matchAll(IMG_TAG)]
    .map((tag) => ({ tag: tag[0], src: tag[0].match(INLINE_SRC) }))
    .filter((m): m is { tag: string; src: RegExpMatchArray } => m.src !== null);
  if (matches.length === 0) return html;
  if (matches.length > MAX_INLINE_IMAGES) {
    throw new InlineImageError(
      `At most ${MAX_INLINE_IMAGES} pasted images per description; attach the rest as files`,
      400
    );
  }

  const urls = await Promise.all(
    matches.map(async ({ tag, src }, index) => {
      const [, , , kind, base64] = src;
      const bytes = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
      if (bytes.length === 0) {
        throw new InlineImageError(`Pasted image ${index + 1} is empty`, 400);
      }
      if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
        throw new InlineImageError(
          `Pasted image ${index + 1} is larger than ${MAX_INLINE_IMAGE_BYTES / 1024 / 1024} MB`,
          400
        );
      }
      const fileName = fileNameFor(tag, kind, index);
      try {
        const { url } = await uploader.uploadAttachment(
          project,
          fileName,
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          `image/${kind.toLowerCase() === 'jpg' ? 'jpeg' : kind.toLowerCase()}`
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

  let index = 0;
  return html.replace(IMG_TAG, (tag) => {
    if (!INLINE_SRC.test(tag)) return tag;
    const url = urls[index++];
    return tag.replace(
      INLINE_SRC,
      (_src, prefix: string, quote: string) => `${prefix}${quote}${url}${quote}`
    );
  });
}
