export type OrbiMood =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "authorizing"
  | "happy"
  | "error";

export type GeminiMaleVoice = "Charon" | "Fenrir" | "Puck";

export interface IndexedFile {
  id: string;
  name: string;
  path: string;
  folder: string;
  size: number;
  type: string;
  lastModified: number;
  handle?: FileSystemFileHandle;
  file?: File;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface OpenedTabInfo {
  url: string;
  title: string;
  platform?: string;
  blocked?: boolean;
  embedUrl?: string;
  spotifyUri?: string;
  autoplay?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: string;
  sources?: GroundingSource[];
  openedTab?: OpenedTabInfo;
  attachedScreen?: boolean;
  audioBase64?: string;
}

export interface PendingFileAuth {
  file: IndexedFile;
  matches: IndexedFile[];
  status: "asking" | "waiting";
  requestedAt: string;
}
