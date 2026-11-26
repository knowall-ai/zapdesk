import { describe, it, expect, vi } from 'vitest';
import {
  InlineImageError,
  MAX_INLINE_IMAGES,
  MAX_INLINE_IMAGE_BYTES,
  uploadInlineImages,
} from './inline-images';

// A pasted screenshot reached DevOps as an inline data: image, which DevOps
// strips on save: the ticket kept only `<img alt=image.png>`.

const PNG = Buffer.from('fake png bytes').toString('base64');
const ATTACHMENT = 'https://dev.azure.com/Contoso/_apis/wit/attachments/abc-123?fileName=x.png';

const uploader = () => ({
  uploadAttachment: vi.fn(async () => ({ id: 'abc-123', url: ATTACHMENT })),
});

describe('uploadInlineImages', () => {
  it('uploads a pasted image and points the img at the attachment', async () => {
    const devops = uploader();
    const html = `<p>See below</p><img src="data:image/png;base64,${PNG}" alt="image.png" />`;

    const stored = await uploadInlineImages(html, 'Contoso', devops);

    expect(stored).toBe(`<p>See below</p><img src="${ATTACHMENT}" alt="image.png" />`);
    expect(devops.uploadAttachment).toHaveBeenCalledTimes(1);
    const [project, fileName, bytes, type] = devops.uploadAttachment.mock.calls[0] as unknown as [
      string,
      string,
      ArrayBuffer,
      string,
    ];
    expect(project).toBe('Contoso');
    expect(fileName).toBe('image-1.png');
    expect(Buffer.from(bytes).toString()).toBe('fake png bytes');
    expect(type).toBe('image/png');
  });

  it('replaces each image with its own upload, in order', async () => {
    let n = 0;
    const devops = { uploadAttachment: vi.fn(async () => ({ id: `${++n}`, url: `u${n}` })) };
    const html = `<img src="data:image/png;base64,${PNG}"><img src='data:image/jpeg;base64,${PNG}'>`;

    const stored = await uploadInlineImages(html, 'Contoso', devops);

    expect(stored).toBe(`<img src="u1"><img src='u2'>`);
    expect(devops.uploadAttachment.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      'pasted-image-1.png',
      'pasted-image-2.jpg',
    ]);
  });

  it('leaves a description without inline images untouched, and uploads nothing', async () => {
    const devops = uploader();
    const html = `<p>Hi</p><img src="${ATTACHMENT}">`;
    expect(await uploadInlineImages(html, 'Contoso', devops)).toBe(html);
    expect(devops.uploadAttachment).not.toHaveBeenCalled();
  });

  it('refuses to save rather than lose a picture when the upload fails', async () => {
    const devops = {
      uploadAttachment: vi.fn(async () => {
        throw new Error('DevOps down');
      }),
    };
    const html = `<img src="data:image/png;base64,${PNG}">`;
    const error = await uploadInlineImages(html, 'Contoso', devops).catch((e) => e);
    expect(error).toBeInstanceOf(InlineImageError);
    expect(error.status).toBe(502);
  });

  it('refuses an image over the size limit before uploading', async () => {
    const devops = uploader();
    const big = Buffer.alloc(MAX_INLINE_IMAGE_BYTES + 1).toString('base64');
    const error = await uploadInlineImages(
      `<img src="data:image/png;base64,${big}">`,
      'Contoso',
      devops
    ).catch((e) => e);
    expect(error).toBeInstanceOf(InlineImageError);
    expect(error.status).toBe(400);
    expect(devops.uploadAttachment).not.toHaveBeenCalled();
  });

  it('refuses more images than the limit', async () => {
    const devops = uploader();
    const html = `<img src="data:image/png;base64,${PNG}">`.repeat(MAX_INLINE_IMAGES + 1);
    const error = await uploadInlineImages(html, 'Contoso', devops).catch((e) => e);
    expect(error).toBeInstanceOf(InlineImageError);
    expect(devops.uploadAttachment).not.toHaveBeenCalled();
  });
});
