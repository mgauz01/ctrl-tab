const THUMB_PREFIX = "thumb:";
const ORDER_KEY = "thumb:order";
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
    await touchLru(expectedTabId);
  } catch {
    // Restricted or inactive tab — skip
  }
}

async function resizeDataUrl(dataUrl: string, maxWidth: number): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width <= maxWidth) {
    bitmap.close();
    return dataUrl;
  }
  const scale = maxWidth / bitmap.width;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return dataUrl;
  }
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

export async function getThumbnails(
  tabIds: number[]
): Promise<Map<number, string>> {
  if (tabIds.length === 0) return new Map();
  const keys = tabIds.map((id) => `${THUMB_PREFIX}${id}`);
  const data = await chrome.storage.session.get(keys);
  const out = new Map<number, string>();
  for (const id of tabIds) {
    const url = data[`${THUMB_PREFIX}${id}`];
    if (typeof url === "string") out.set(id, url);
  }
  return out;
}

export async function removeThumbnail(tabId: number): Promise<void> {
  const data = await chrome.storage.session.get(ORDER_KEY);
  const order = ((data[ORDER_KEY] as number[] | undefined) ?? []).filter(
    (id) => id !== tabId
  );
  await chrome.storage.session.remove(`${THUMB_PREFIX}${tabId}`);
  await chrome.storage.session.set({ [ORDER_KEY]: order });
}

async function touchLru(tabId: number): Promise<void> {
  const data = await chrome.storage.session.get(ORDER_KEY);
  let order = ((data[ORDER_KEY] as number[] | undefined) ?? []).filter(
    (id) => id !== tabId
  );
  order.unshift(tabId);
  if (order.length > MAX_THUMBS) {
    const drop = order.slice(MAX_THUMBS);
    order = order.slice(0, MAX_THUMBS);
    await chrome.storage.session.remove(
      drop.map((id) => `${THUMB_PREFIX}${id}`)
    );
  }
  await chrome.storage.session.set({ [ORDER_KEY]: order });
}
