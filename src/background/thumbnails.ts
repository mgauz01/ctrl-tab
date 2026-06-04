const THUMB_PREFIX = "thumb:";
const MAX_THUMBS = 10;
const THUMB_WIDTH = 320;

export async function captureTabThumbnail(
  windowId: number,
  expectedTabId: number
): Promise<void> {
  try {
    const [active] = await chrome.tabs.query({ active: true, windowId });
    if (active?.id !== expectedTabId) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 65,
    });
    const resized = await resizeDataUrl(dataUrl, THUMB_WIDTH);
    await chrome.storage.session.set({
      [`${THUMB_PREFIX}${expectedTabId}`]: resized,
    });
    await pruneThumbnails();
  } catch {
    // Restricted or inactive tab — skip
  }
}

async function resizeDataUrl(dataUrl: string, maxWidth: number): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.65 });
  return blobToDataUrl(out);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function getThumbnail(tabId: number): Promise<string | undefined> {
  const key = `${THUMB_PREFIX}${tabId}`;
  const data = await chrome.storage.session.get(key);
  const url = data[key];
  return typeof url === "string" ? url : undefined;
}

export async function removeThumbnail(tabId: number): Promise<void> {
  await chrome.storage.session.remove(`${THUMB_PREFIX}${tabId}`);
}

async function pruneThumbnails(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(THUMB_PREFIX));
  if (keys.length <= MAX_THUMBS) return;
  const extra = keys.slice(0, keys.length - MAX_THUMBS);
  await chrome.storage.session.remove(extra);
}
