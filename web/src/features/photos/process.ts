import {
  fitWithin,
  JPEG_QUALITY,
  MAX_EDGE,
  stampLines,
  THUMB_EDGE,
  type PhotoRecord,
  type PhotoSource,
  type StampInfo,
} from "./model";

export interface Prepared {
  record: Omit<
    PhotoRecord,
    "status" | "progress" | "attempts" | "nextAttemptAt" | "createdAt"
  >;
  blob: Blob;
  thumb: Blob;
}

type Surface = OffscreenCanvas | HTMLCanvasElement;
const surface = (w: number, h: number): Surface =>
  typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });
const toBlob = (c: Surface, quality: number): Promise<Blob> =>
  "convertToBlob" in c
    ? c.convertToBlob({ type: "image/jpeg", quality })
    : new Promise((res, rej) =>
        c.toBlob(
          (b) => (b ? res(b) : rej(new Error("Could not make the picture"))),
          "image/jpeg",
          quality,
        ),
      );

async function decode(
  input: Blob,
): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      // 'from-image' applies the phone's rotation flag, so a portrait picture is not drawn sideways
      const b = await createImageBitmap(input, {
        imageOrientation: "from-image",
      });
      return {
        source: b,
        width: b.width,
        height: b.height,
        close: () => b.close(),
      };
    } catch {
      /* fall through to the slower path */
    }
  }
  const url = URL.createObjectURL(input);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(
      "This picture could not be read. If it came from the library, take it with the camera instead.",
    );
  }
}

async function sha256(b: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await b.arrayBuffer());
  return [...new Uint8Array(buf)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function drawStamp(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  w: number,
  h: number,
  info: StampInfo,
) {
  const [a, b] = stampLines(info);
  const font = Math.max(12, Math.round(Math.min(w, h) * 0.03));
  const pad = Math.round(font * 0.6);
  const bar = font * 2 + pad * 2.2;
  ctx.fillStyle = "rgba(13,27,46,0.78)";
  ctx.fillRect(0, h - bar, w, bar);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  ctx.fillText(a, pad, h - bar + pad, w - pad * 2);
  ctx.font = `${font}px system-ui, sans-serif`;
  ctx.fillStyle = "#e2c46b";
  ctx.fillText(b, pad, h - bar + pad + font * 1.25, w - pad * 2);
}

/**
 * Turn what the camera or library gave us into what we keep and send: upright, at most 1600 px on the long side, a JPEG of a few
 * hundred KB, a small thumbnail, a fingerprint, and (if asked) the burned-in stamp. Everything happens on the device.
 */
export async function preparePhoto(
  input: Blob,
  o: { source: PhotoSource; stamp?: StampInfo; name?: string },
): Promise<Prepared> {
  const t0 = performance.now();
  const d = await decode(input);
  try {
    const { width, height } = fitWithin(d.width, d.height, MAX_EDGE);
    const c = surface(width, height);
    const ctx = c.getContext("2d") as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D;
    ctx.drawImage(d.source, 0, 0, width, height);
    if (o.stamp) drawStamp(ctx, width, height, o.stamp);
    const blob = await toBlob(c, JPEG_QUALITY);
    const t = fitWithin(width, height, THUMB_EDGE);
    const tc = surface(t.width, t.height);
    (tc.getContext("2d") as CanvasRenderingContext2D).drawImage(
      c as CanvasImageSource,
      0,
      0,
      t.width,
      t.height,
    );
    const thumb = await toBlob(tc, 0.7);
    const hash = await sha256(blob);
    const originalSha256 = await sha256(input); // the file we started from: the same picture sent twice has the same one even after stamping
    const lastModified =
      input instanceof File && input.lastModified
        ? input.lastModified
        : Date.now();
    return {
      blob,
      thumb,
      record: {
        id: crypto.randomUUID(),
        name: o.name ?? (input instanceof File ? input.name : "photo.jpg"),
        width,
        height,
        size: blob.size,
        originalSize: input.size,
        sha256: hash,
        originalSha256,
        source: o.source,
        takenAt: new Date(
          o.source === "library" ? lastModified : Date.now(),
        ).toISOString(),
        stamped: !!o.stamp,
        prepMs: Math.round(performance.now() - t0),
      },
    };
  } finally {
    d.close();
  }
}
