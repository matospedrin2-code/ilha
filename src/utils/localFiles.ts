import { IndexedFile } from "../types/orbi";

const MAX_INDEXED_FILES = 4000;

export async function indexDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  rootName = dirHandle.name
): Promise<IndexedFile[]> {
  const results: IndexedFile[] = [];

  async function walk(
    handle: FileSystemDirectoryHandle,
    currentPath: string
  ): Promise<void> {
    if (results.length >= MAX_INDEXED_FILES) return;
    for await (const entry of handle.values()) {
      if (results.length >= MAX_INDEXED_FILES) break;
      const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      if (entry.kind === "file") {
        try {
          const fileHandle = entry as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          results.push({
            id: `${rootName}:${entryPath}`,
            name: entry.name,
            path: entryPath,
            folder: rootName,
            size: file.size,
            type: file.type || inferMimeFromName(entry.name),
            lastModified: file.lastModified,
            handle: fileHandle,
          });
        } catch {
          // Skip unreadable system/locked files quietly
        }
      } else if (entry.kind === "directory") {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === "$RECYCLE.BIN"
        ) {
          continue;
        }
        await walk(entry as FileSystemDirectoryHandle, entryPath);
      }
    }
  }

  await walk(dirHandle, rootName);
  return results;
}

export function indexFileList(fileList: FileList): {
  folderName: string;
  files: IndexedFile[];
} {
  const arr = Array.from(fileList).slice(0, MAX_INDEXED_FILES);
  const firstPath = arr[0]?.webkitRelativePath || "";
  const rootFolder = firstPath.split("/")[0] || "Pasta Selecionada";

  const files: IndexedFile[] = arr
    .filter((f) => !f.webkitRelativePath.includes("/node_modules/") && !f.webkitRelativePath.includes("/.git/"))
    .map((f) => {
      const rel = f.webkitRelativePath || `${rootFolder}/${f.name}`;
      return {
        id: `${rootFolder}:${rel}`,
        name: f.name,
        path: rel,
        folder: rootFolder,
        size: f.size,
        type: f.type || inferMimeFromName(f.name),
        lastModified: f.lastModified,
        file: f,
      };
    });

  return { folderName: rootFolder, files };
}

export function searchIndexedFiles(
  files: IndexedFile[],
  query: string,
  folderHint?: string
): IndexedFile[] {
  const cleanQuery = query.trim().toLowerCase();
  const cleanFolder = folderHint?.trim().toLowerCase();

  const tokens = cleanQuery
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const scored = files
    .map((item) => {
      const nameLower = item.name.toLowerCase();
      const pathLower = item.path.toLowerCase();
      const folderLower = item.folder.toLowerCase();

      if (cleanFolder && !pathLower.includes(cleanFolder) && !folderLower.includes(cleanFolder)) {
        return { item, score: 0 };
      }

      let score = 0;
      if (cleanQuery && nameLower === cleanQuery) score += 100;
      else if (cleanQuery && nameLower.includes(cleanQuery)) score += 60;
      else if (cleanQuery && pathLower.includes(cleanQuery)) score += 35;

      for (const tok of tokens) {
        if (nameLower.includes(tok)) score += 20;
        else if (pathLower.includes(tok)) score += 10;
      }

      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 6).map((s) => s.item);
}

export async function readIndexedFile(indexed: IndexedFile): Promise<File> {
  if (indexed.file) return indexed.file;
  if (indexed.handle) return await indexed.handle.getFile();
  throw new Error("Não foi possível acessar o arquivo selecionado.");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function inferMimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["txt", "md", "ts", "tsx", "js", "jsx", "py", "pyw", "json", "css", "html", "csv", "log", "bat", "ini"].includes(ext)) {
    return "text/plain";
  }
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) {
    return `image/${ext === "jpg" ? "jpeg" : ext}`;
  }
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}
