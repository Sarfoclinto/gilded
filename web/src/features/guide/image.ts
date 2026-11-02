/** The longest side a picture is kept at, and the JPEG quality: sharp enough to read a screenshot, small enough to load on a phone. */
export const MAX_SIDE = 1600;
export const QUALITY = 0.85;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Size to scale (w, h) to so the longest side is at most max. Never scales up. */
export function fitWithin(
  w: number,
  h: number,
  max = MAX_SIDE,
): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return {
    w: Math.max(1, Math.round(w * k)),
    h: Math.max(1, Math.round(h * k)),
  };
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("The picture could not be read."));
    r.readAsDataURL(file);
  });

/** Turns a chosen picture into a small data URL that is saved inside the article. */
export async function pictureToDataUrl(file: File): Promise<string> {
  if (!ALLOWED.includes(file.type))
    throw new Error("Choose a PNG, JPEG, WebP or GIF picture.");
  // An animated GIF would lose its animation when redrawn, so a small one is kept as it is.
  if (file.type === "image/gif" && file.size <= 1_500_000)
    return readAsDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const { w, h } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The picture could not be prepared.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", QUALITY);
  if (url.length > 2_400_000)
    throw new Error(
      "This picture is too large even after shrinking. Try a smaller one.",
    );
  return url;
}

/** Roughly how many kilobytes a data URL takes, for showing the writer. */
export const dataUrlKb = (url: string) =>
  Math.round((url.length * 3) / 4 / 1024);
