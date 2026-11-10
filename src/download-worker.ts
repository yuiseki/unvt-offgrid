/// <reference lib="webworker" />
/**
 * Dedicated worker that streams a region archive into OPFS.
 *
 * It writes through a sync access handle, which writes in place. The async
 * `createWritable()` stream writes to a swap file that is only committed on
 * close: a few hundred MB would need twice the space, and a tab killed
 * halfway would lose everything. With in-place writes the `.part` file keeps
 * what has arrived, and the next attempt resumes with a Range request.
 * Sync access handles exist only in dedicated workers.
 */
import { OPFS_DIR, PART_SUFFIX, opfsName } from "./regions";

export type DownloadRequest = { type: "start"; url: string; bytes: number };
export type DownloadEvent =
  | { type: "progress"; received: number; total: number }
  | { type: "done" }
  | { type: "error"; message: string };

const post = (e: DownloadEvent) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(e);

// Flush to disk this often so a crash loses at most this much.
const FLUSH_EVERY = 8 * 1024 * 1024;

self.onmessage = (ev: MessageEvent<DownloadRequest>) => {
  if (ev.data?.type !== "start") return;
  run(ev.data.url, ev.data.bytes).then(
    () => post({ type: "done" }),
    (e: unknown) => post({ type: "error", message: e instanceof Error ? e.message : String(e) }),
  );
};

async function run(url: string, bytes: number): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
  const name = opfsName(url);
  const part = await dir.getFileHandle(name + PART_SUFFIX, { create: true });
  const access = await part.createSyncAccessHandle();
  try {
    let offset = access.getSize();
    if (offset > bytes) {
      access.truncate(0);
      offset = 0;
    }
    post({ type: "progress", received: offset, total: bytes });
    if (offset < bytes) offset = await fetchInto(access, url, offset, bytes);
    if (offset !== bytes) throw new Error(`サイズが合いません: ${offset} / ${bytes} バイト`);
    const head = new Uint8Array(8);
    access.read(head, { at: 0 });
    if (new TextDecoder().decode(head.subarray(0, 7)) !== "PMTiles" || head[7] !== 3) {
      access.truncate(0);
      throw new Error("PMTiles v3 のファイルではありません");
    }
    access.flush();
  } finally {
    access.close();
  }
  // Only a complete, checked file gets the final name, which is what the
  // service worker looks for.
  const movable = part as FileSystemFileHandle & { move?: (name: string) => Promise<void> };
  if (typeof movable.move !== "function") throw new Error("このブラウザは OPFS のファイル名の変更に対応していません");
  try {
    await dir.removeEntry(name);
  } catch {
    // not there yet
  }
  await movable.move(name);
}

async function fetchInto(
  access: FileSystemSyncAccessHandle,
  url: string,
  offset: number,
  bytes: number,
): Promise<number> {
  const headers: HeadersInit = offset > 0 ? { Range: `bytes=${offset}-` } : {};
  const res = await fetch(url, { headers, cache: "no-store" });
  if (offset > 0 && res.status === 200) {
    // The server (or a cache in front of it) ignored the Range: start over.
    access.truncate(0);
    offset = 0;
  } else if (offset > 0 && res.status === 206) {
    const cr = res.headers.get("Content-Range") ?? "";
    if (!cr.startsWith(`bytes ${offset}-`)) throw new Error(`再開位置が合いません: ${cr}`);
  } else if (!res.ok) {
    throw new Error(`ダウンロードに失敗しました: HTTP ${res.status}`);
  }
  if (!res.body) throw new Error("応答に本文がありません");
  const reader = res.body.getReader();
  let sinceFlush = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > bytes) throw new Error("予定より大きなファイルが届きました");
    access.write(value, { at: offset });
    offset += value.byteLength;
    sinceFlush += value.byteLength;
    if (sinceFlush >= FLUSH_EVERY) {
      access.flush();
      sinceFlush = 0;
    }
    const now = Date.now();
    if (now - lastPost > 200) {
      post({ type: "progress", received: offset, total: bytes });
      lastPost = now;
    }
  }
  access.flush();
  post({ type: "progress", received: offset, total: bytes });
  return offset;
}
