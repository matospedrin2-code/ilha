import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  FileSearch,
  FolderOpen,
  Globe,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Play,
  Radio,
  Send,
  Smartphone,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { DynamicIsland } from "./components/DynamicIsland";
import { FilePreviewModal } from "./components/FilePreviewModal";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { PWAInstallButton } from "./components/PWAInstallButton";
import { useHyperOSIsland } from "./hooks/useHyperOSIsland";
import { useOrbiVoice } from "./hooks/useOrbiVoice";
import {
  ChatMessage,
  GeminiMaleVoice,
  GroundingSource,
  IndexedFile,
  OpenedTabInfo,
  OrbiMood,
  PendingFileAuth,
} from "./types/orbi";
import {
  formatBytes,
  indexDirectoryHandle,
  indexFileList,
  searchIndexedFiles,
} from "./utils/localFiles";
import { postJson } from "./utils/safeFetch";
import { downloadWindowsScriptSafely } from "./utils/windowsScript";

const MALE_VOICE_OPTIONS: {
  id: GeminiMaleVoice;
  label: string;
  desc: string;
}[] = [
  { id: "Charon", label: "Charon", desc: "Masculina · Profunda e calma" },
  { id: "Fenrir", label: "Fenrir", desc: "Masculina · Firme e direta" },
  { id: "Puck", label: "Puck", desc: "Masculina · Jovem e ágil" },
];

export default function App() {
  const [mood, setMood] = useState<OrbiMood>("idle");
  const [liteMode, setLiteMode] = useState(false);
  const [islandExpanded, setIslandExpanded] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [voice, setVoice] = useState<GeminiMaleVoice>("Charon");

  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastReply, setLastReply] = useState("");
  const [lastSources, setLastSources] = useState<GroundingSource[]>([]);
  const [activeTabAction, setActiveTabAction] = useState<OpenedTabInfo | null>(
    null
  );
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [lastClickedLabel, setLastClickedLabel] = useState<string | null>(null);

  // Local folder indexing & authorization queue
  const [authorizedFolders, setAuthorizedFolders] = useState<
    { name: string; count: number }[]
  >([]);
  const [indexedFiles, setIndexedFiles] = useState<IndexedFile[]>([]);
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [pendingFileAuth, setPendingFileAuth] =
    useState<PendingFileAuth | null>(null);
  const [waitingFiles, setWaitingFiles] = useState<IndexedFile[]>([]);
  const [previewFile, setPreviewFile] = useState<IndexedFile | null>(null);
  const [copiedPhoneLink, setCopiedPhoneLink] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // Real screen capture state
  const [screenActive, setScreenActive] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  // Track clicks anywhere in UI so Orbi knows what the user clicked
  useEffect(() => {
    const onGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest("button, a, input");
      if (btn) {
        const text =
          btn.getAttribute("aria-label") ||
          btn.textContent?.trim() ||
          btn.getAttribute("placeholder") ||
          btn.tagName.toLowerCase();
        if (text && text.length < 40 && !text.includes("Orbi Dynamic")) {
          setLastClickedLabel(text);
        }
      }
    };
    window.addEventListener("click", onGlobalClick, { passive: true });
    return () => window.removeEventListener("click", onGlobalClick);
  }, []);

  const captureScreenFrame = useCallback(async (): Promise<string | null> => {
    const video = screenVideoRef.current;
    if (!video || !screenStreamRef.current || video.readyState < 2) {
      return null;
    }
    const maxW = liteMode ? 960 : 1280;
    const scale = Math.min(1, maxW / (video.videoWidth || maxW));
    const w = Math.max(320, Math.round((video.videoWidth || 1280) * scale));
    const h = Math.max(180, Math.round((video.videoHeight || 720) * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", liteMode ? 0.6 : 0.78);
  }, [liteMode]);

  const stopScreenCapture = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
    }
    setScreenActive(false);
  }, []);

  const startScreenCapture = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 2, max: 5 } },
        audio: false,
      });
      screenStreamRef.current = stream;
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        await screenVideoRef.current.play();
      }
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopScreenCapture();
      });
      setScreenActive(true);
      setErrorBanner(null);
      return true;
    } catch {
      setErrorBanner(
        "Captura de tela cancelada ou bloqueada. Autorize o compartilhamento para o Orbi ler sua tela."
      );
      return false;
    }
  }, [stopScreenCapture]);

  const sendMessageRef = useRef<(text: string, forceScreen?: boolean) => Promise<void>>(
    async () => {}
  );

  const {
    isListening,
    liveTranscript,
    setLiveTranscript,
    audioLevel,
    startListening,
    stopListening,
    speakWithGemini,
    playWavBase64,
    stopSpeaking,
  } = useOrbiVoice({
    voice,
    onTranscriptFinal: (spokenText) => {
      void sendMessageRef.current(spokenText);
    },
    onListeningChange: (listening) => {
      setMood((prev) =>
        listening ? "listening" : prev === "listening" ? "idle" : prev
      );
    },
    onSpeakingChange: (speaking) => {
      setMood((prev) =>
        speaking ? "speaking" : prev === "speaking" ? "idle" : prev
      );
    },
    onError: (msg) => {
      setErrorBanner(msg);
      setMood((prev) => (prev === "speaking" ? "idle" : prev));
    },
  });

  const handleIslandClickRef = useRef<() => void>(() => {});

  const {
    isHyperOSActive,
    isPausedInIsland,
    statusMessage: hyperOSStatusMsg,
    toggleHyperOSIsland,
    showBackgroundCapsuleAlert,
  } = useHyperOSIsland({
    mood,
    lastReply,
    activeTabTitle: activeTabAction?.title ?? null,
    onTriggerVoice: () => handleIslandClickRef.current(),
    onStopSpeaking: stopSpeaking,
  });

  const handleFileDecision = useCallback(
    async (decision: "open" | "wait" | "cancel", targetFile?: IndexedFile) => {
      const fileToHandle = targetFile || pendingFileAuth?.file;
      if (!fileToHandle) return;

      if (decision === "open") {
        setPendingFileAuth(null);
        setWaitingFiles((prev) => prev.filter((f) => f.id !== fileToHandle.id));
        setPreviewFile(fileToHandle);
        setMood("happy");
        const msg = `Abrindo ${fileToHandle.name} agora.`;
        setLastReply(msg);
        if (autoSpeak) void speakWithGemini(msg);
        window.setTimeout(() => setMood("idle"), 1600);
      } else if (decision === "wait") {
        setPendingFileAuth(null);
        setWaitingFiles((prev) =>
          prev.some((f) => f.id === fileToHandle.id)
            ? prev
            : [fileToHandle, ...prev]
        );
        const msg = `Deixei ${fileToHandle.name} em espera. Quando quiser abrir, é só avisar.`;
        setLastReply(msg);
        setMood("idle");
        if (autoSpeak) void speakWithGemini(msg);
      } else {
        setPendingFileAuth(null);
        const msg = `Certo, não vou abrir ${fileToHandle.name}.`;
        setLastReply(msg);
        setMood("idle");
        if (autoSpeak) void speakWithGemini(msg);
      }
    },
    [autoSpeak, pendingFileAuth, speakWithGemini]
  );

  const openTabSafe = useCallback(
    (actionArgs: Record<string, unknown>): OpenedTabInfo => {
      const rawUrl = String(actionArgs.url || "https://www.google.com");
      const title = String(actionArgs.title || rawUrl);
      const platform = actionArgs.platform
        ? String(actionArgs.platform)
        : undefined;
      const embedUrl = actionArgs.embedUrl
        ? String(actionArgs.embedUrl)
        : undefined;
      const spotifyUri = actionArgs.spotifyUri
        ? String(actionArgs.spotifyUri)
        : undefined;
      const autoplay = Boolean(actionArgs.autoplay);

      const safeUrl =
        rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
          ? rawUrl
          : `https://${rawUrl}`;

      let blocked = false;
      try {
        const win = window.open(safeUrl, "_blank", "noopener,noreferrer");
        if (!win) {
          blocked = true;
        }
      } catch {
        blocked = true;
      }

      return {
        url: safeUrl,
        title,
        platform,
        blocked,
        embedUrl,
        spotifyUri,
        autoplay,
      };
    },
    []
  );

  const sendMessageToOrbi = useCallback(
    async (rawText: string, forceScreen = false) => {
      const text = rawText.trim();
      if (!text) return;

      setErrorBanner(null);
      setInputText("");
      setLiveTranscript("");
      setIslandExpanded(true);
      setMood("thinking");

      const nowStr = new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        text,
        timestamp: nowStr,
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        let screenB64: string | null = null;
        if (screenActive && (forceScreen || /tela|screen|vendo|leia|lê|isso aqui|erro/i.test(text))) {
          screenB64 = await captureScreenFrame();
        }

        const historyPayload = messages.slice(-6).map((m) => ({
          role: m.role,
          text: m.text,
        }));

        const data = await postJson<{
          reply?: string;
          groundingSources?: GroundingSource[];
          actions?: Array<{ name: string; args: Record<string, unknown> }>;
        }>("/api/orbi/chat", {
          message: text,
          history: historyPayload,
          screenImageBase64: screenB64,
          indexedFolderNames: authorizedFolders.map((f) => f.name),
          pendingAuthFile: pendingFileAuth
            ? {
                name: pendingFileAuth.file.name,
                path: pendingFileAuth.file.path,
                folder: pendingFileAuth.file.folder,
              }
            : null,
        });

        let finalReply: string = data.reply || "";
        const sources: GroundingSource[] = data.groundingSources || [];
        let openedTabInfo: OpenedTabInfo | undefined;

        const actions: Array<{ name: string; args: Record<string, unknown> }> =
          data.actions || [];

        for (const action of actions) {
          if (action.name === "open_web_tab") {
            openedTabInfo = openTabSafe(action.args);
            setActiveTabAction(openedTabInfo);
            if (openedTabInfo.blocked && !openedTabInfo.embedUrl) {
              finalReply = `${finalReply ? `${finalReply} ` : ""}Deixei o link pronto na ilha caso o navegador tenha bloqueado a abertura automática.`;
            }
          } else if (action.name === "request_screen_capture") {
            if (!screenB64) {
              const ok = await startScreenCapture();
              if (ok) {
                const captured = await captureScreenFrame();
                if (captured) {
                  const followData = await postJson<{ reply?: string }>(
                    "/api/orbi/chat",
                    {
                      message: text,
                      history: historyPayload,
                      screenImageBase64: captured,
                      indexedFolderNames: authorizedFolders.map((f) => f.name),
                    }
                  );
                  if (followData.reply) {
                    finalReply = followData.reply;
                    screenB64 = captured;
                  }
                }
              } else {
                finalReply =
                  "Para ler o que está na sua tela, autorize o compartilhamento da tela quando a janela do navegador abrir.";
              }
            }
          } else if (action.name === "search_local_files") {
            const query = String(action.args.query || "");
            const folderHint = action.args.folderHint
              ? String(action.args.folderHint)
              : undefined;

            if (indexedFiles.length === 0) {
              finalReply =
                "Nenhuma pasta do computador foi autorizada ainda. Clique em 'Autorizar Pasta' na seção de Pastas Locais para eu procurar seus arquivos silenciosamente.";
            } else {
              const matches = searchIndexedFiles(
                indexedFiles,
                query,
                folderHint
              );

              if (matches.length > 0) {
                const top = matches[0];
                setPendingFileAuth({
                  file: top,
                  matches,
                  status: "asking",
                  requestedAt: nowStr,
                });
                setMood("authorizing");
                finalReply =
                  matches.length === 1
                    ? `Encontrei o arquivo ${top.name} na pasta ${top.folder}. Deseja que eu abra agora ou prefere que eu aguarde?`
                    : `Encontrei ${matches.length} arquivos, começando por ${top.name} na pasta ${top.folder}. Deseja que eu abra agora ou prefere que eu aguarde?`;
              } else {
                finalReply = folderHint
                  ? `Procurei silenciosamente por "${query}" na pasta ${folderHint}, mas não encontrei nenhum arquivo correspondente.`
                  : `Procurei silenciosamente por "${query}" nas pastas autorizadas, mas não encontrei nenhum arquivo correspondente.`;
              }
            }
          } else if (action.name === "handle_pending_file_authorization") {
            const decision = String(action.args.decision || "cancel") as
              | "open"
              | "wait"
              | "cancel";
            await handleFileDecision(decision);
            const aiMsg: ChatMessage = {
              id: `m-${Date.now()}`,
              role: "model",
              text: finalReply,
              timestamp: nowStr,
            };
            setMessages((prev) => [...prev, aiMsg]);
            return;
          }
        }

        const msgId = `m-${Date.now()}`;
        setLastReply(finalReply);
        setLastSources(sources);
        if (finalReply) {
          void showBackgroundCapsuleAlert("Orbi Dynamic", finalReply);
        }

        const modelMsg: ChatMessage = {
          id: msgId,
          role: "model",
          text: finalReply,
          timestamp: nowStr,
          sources: sources.length > 0 ? sources : undefined,
          openedTab: openedTabInfo,
          attachedScreen: Boolean(screenB64),
        };
        setMessages((prev) => [...prev, modelMsg]);

        if (autoSpeak && finalReply) {
          const generatedAudio = await speakWithGemini(finalReply);
          if (generatedAudio) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId ? { ...m, audioBase64: generatedAudio } : m
              )
            );
          }
        } else {
          setMood(pendingFileAuth ? "authorizing" : "idle");
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Falha ao se comunicar com o Orbi Dynamic.";
        setErrorBanner(msg);
        setLastReply(msg);
        setMood("error");
        window.setTimeout(() => setMood("idle"), 2800);
      }
    },
    [
      authorizedFolders,
      autoSpeak,
      captureScreenFrame,
      handleFileDecision,
      indexedFiles,
      messages,
      openTabSafe,
      pendingFileAuth,
      screenActive,
      setLiveTranscript,
      showBackgroundCapsuleAlert,
      speakWithGemini,
      startScreenCapture,
    ]
  );

  useEffect(() => {
    sendMessageRef.current = sendMessageToOrbi;
  }, [sendMessageToOrbi]);

  const handleIslandClick = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      setIslandExpanded(true);
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  useEffect(() => {
    handleIslandClickRef.current = handleIslandClick;
  }, [handleIslandClick]);

  const handleAuthorizeFolder = async () => {
    setErrorBanner(null);
    const picker = (
      window as unknown as {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;

    if (picker) {
      try {
        const dirHandle = await picker();
        const files = await indexDirectoryHandle(dirHandle);
        setIndexedFiles((prev) => {
          const filtered = prev.filter((f) => f.folder !== dirHandle.name);
          return [...filtered, ...files];
        });
        setAuthorizedFolders((prev) => {
          const rest = prev.filter((f) => f.name !== dirHandle.name);
          return [...rest, { name: dirHandle.name, count: files.length }];
        });
        return;
      } catch (err) {
        // If user cancelled, don't force fallback; if iframe blocks showDirectoryPicker, fallback to input
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
      }
    }

    folderInputRef.current?.click();
  };

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const { folderName, files } = indexFileList(fileList);
    setIndexedFiles((prev) => {
      const filtered = prev.filter((f) => f.folder !== folderName);
      return [...filtered, ...files];
    });
    setAuthorizedFolders((prev) => {
      const rest = prev.filter((f) => f.name !== folderName);
      return [...rest, { name: folderName, count: files.length }];
    });
    e.target.value = "";
  };

  const filteredLocalFiles = localSearchQuery.trim()
    ? searchIndexedFiles(indexedFiles, localSearchQuery)
    : indexedFiles.slice(0, 8);

  return (
    <div className="min-h-screen bg-[#080A0F] text-slate-100 flex flex-col">
      {/* Hidden video element for lightweight on-demand screen capture */}
      <video ref={screenVideoRef} className="hidden" muted playsInline />

      {/* Hidden folder input fallback for restricted iframes */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is supported in Chromium/Edge/Firefox on Windows
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={handleFolderInputChange}
      />

      {/* Pinned Top Center Orbi Dynamic Island (Attachment 1 + Attachment 2) */}
      <DynamicIsland
        mood={mood}
        liteMode={liteMode}
        isExpanded={islandExpanded}
        onToggleExpand={setIslandExpanded}
        onIslandClick={handleIslandClick}
        onStopSpeaking={stopSpeaking}
        liveTranscript={liveTranscript}
        lastReply={lastReply}
        lastSources={lastSources}
        pendingFileAuth={pendingFileAuth}
        onFileDecision={(d) => void handleFileDecision(d)}
        activeTabAction={activeTabAction}
        onDismissTabAction={() => setActiveTabAction(null)}
        audioLevel={audioLevel}
        lastClickedLabel={lastClickedLabel}
      />

      {/* Clean 3-Zone Top Navigation Bar */}
      <header className="w-full border-b border-white/[0.07] bg-[#080A0F]/90 pt-20 md:pt-4">
        <div className="max-w-[1280px] mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Orbi Dynamic
          </a>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a
              href="#assistente"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Assistente
            </a>
            <a
              href="#pastas"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Pastas Locais
            </a>
            <a
              href="#tela"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Leitura de Tela
            </a>
            <a
              href="#celular"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Celular / HyperOS
            </a>
            <a
              href="#windows"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Windows
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton variant="header" />
            <button
              type="button"
              onClick={() => void downloadWindowsScriptSafely()}
              className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-lg bg-[#00D2FF] text-[#030508] text-xs font-semibold hover:bg-[#33DCFF] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Baixar para Windows</span>
              <span className="sm:hidden">Windows</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main id="top" className="flex-1 max-w-[1280px] w-full mx-auto px-6 py-8 space-y-8">
        {/* Error Alert (only shown on real error) */}
        {errorBanner && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 flex items-center justify-between gap-4 text-xs text-rose-200">
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-rose-300 hover:text-white font-medium whitespace-nowrap cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {/* Hero / Quick Control Strip */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-white/[0.07]">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-medium text-[#00D2FF]">
              Assistente de Ilha Dinâmica · Gemini + Voz Masculina · PC Fraco ao Forte
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
              Clique nos olhinhos do Orbi lá no topo para conversar por voz ou use o painel abaixo
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Os olhos acompanham seu mouse em tempo real. Ele pesquisa na web, abre novas abas, lê o que está na sua tela e busca arquivos em pastas específicas pedindo sua autorização antes de abrir.
            </p>
          </div>

          {/* Performance + Voice Controls */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setLiteMode((v) => !v)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                liteMode
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-[#11151E] border-white/10 text-slate-300 hover:border-white/20"
              }`}
              title="Desativa brilhos e animações extras para consumir o mínimo possível em computadores fracos"
            >
              <Cpu className="w-3.5 h-3.5" />
              {liteMode ? "Modo PC Fraco: Ativo" : "Modo PC Fraco: Desligado"}
            </button>

            <button
              type="button"
              onClick={() => {
                if (autoSpeak) stopSpeaking();
                setAutoSpeak((v) => !v);
              }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                autoSpeak
                  ? "bg-[#00D2FF]/15 border-[#00D2FF]/35 text-[#00D2FF]"
                  : "bg-[#11151E] border-white/10 text-slate-400 hover:text-white"
              }`}
            >
              {autoSpeak ? (
                <Volume2 className="w-3.5 h-3.5" />
              ) : (
                <VolumeX className="w-3.5 h-3.5" />
              )}
              Voz Gemini ({voice})
            </button>
          </div>
        </section>

        {/* Primary 12-Column Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Column 1 (7 cols): Assistente & Conversa */}
          <section
            id="assistente"
            className="lg:col-span-7 rounded-2xl bg-[#0E121B] border border-white/[0.08] p-5 space-y-5"
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Comando de Voz e Texto
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Conectado ao Gemini gratuito com pesquisa web em tempo real
                </p>
              </div>
              <button
                type="button"
                onClick={handleIslandClick}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isListening
                    ? "bg-rose-500 text-white hover:bg-rose-600"
                    : "bg-[#00D2FF] text-[#030508] hover:bg-[#33DCFF]"
                }`}
              >
                {isListening ? (
                  <>
                    <MicOff className="w-3.5 h-3.5" /> Parar Escuta
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5" /> Falar com Orbi
                  </>
                )}
              </button>
            </div>

            {/* Quick Action Triggers */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  void sendMessageToOrbi(
                    "Leia o que está aparecendo na minha tela agora e me explique.",
                    true
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-slate-200 hover:bg-white/[0.08] transition-colors cursor-pointer whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5 text-[#00D2FF]" />
                Ler minha tela
              </button>
              <button
                type="button"
                onClick={() =>
                  void sendMessageToOrbi(
                    "Abra uma nova aba no YouTube para mim."
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-slate-200 hover:bg-white/[0.08] transition-colors cursor-pointer whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#00D2FF]" />
                Abrir aba no YouTube
              </button>
              <button
                type="button"
                onClick={() =>
                  void sendMessageToOrbi(
                    "Quais são as principais notícias de tecnologia de hoje?"
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-slate-200 hover:bg-white/[0.08] transition-colors cursor-pointer whitespace-nowrap"
              >
                <Globe className="w-3.5 h-3.5 text-[#00D2FF]" />
                Pesquisar na Web
              </button>
            </div>

            {/* Conversation History */}
            <div className="space-y-3 min-h-[280px] max-h-[420px] overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <div className="py-14 text-center space-y-2 border border-dashed border-white/10 rounded-xl px-4">
                  <p className="text-sm font-medium text-slate-200">
                    Nenhuma conversa iniciada ainda
                  </p>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Clique nos olhinhos ciano da ilha lá no topo da tela para falar, ou digite um comando abaixo como &ldquo;procure o arquivo contrato na pasta Documentos&rdquo;.
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-xl px-4 py-3 text-sm leading-relaxed border ${
                      msg.role === "user"
                        ? "bg-white/[0.03] border-white/[0.07] text-slate-200 ml-8"
                        : "bg-[#131926] border-[#00D2FF]/20 text-slate-100 mr-4"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] text-slate-400">
                      <span className="font-medium text-slate-300">
                        {msg.role === "user" ? "Você" : "Orbi Dynamic"}
                      </span>
                      <div className="flex items-center gap-2 tabular-nums">
                        {msg.attachedScreen && <span>Leitura de tela</span>}
                        <span>{msg.timestamp}</span>
                        {msg.role === "model" && (
                          <button
                            type="button"
                            onClick={() => {
                              if (msg.audioBase64) {
                                void playWavBase64(msg.audioBase64);
                              } else {
                                void speakWithGemini(msg.text);
                              }
                            }}
                            className="p-1 rounded hover:bg-white/10 text-[#00D2FF] cursor-pointer"
                            title="Ouvir novamente com voz do Gemini"
                          >
                            <Play className="w-3 h-3 fill-current" />
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="whitespace-pre-wrap">{msg.text}</p>

                    {msg.openedTab && (
                      <div className="mt-2.5 pt-2 border-t border-white/10 flex flex-wrap items-center gap-3">
                        <a
                          href={msg.openedTab.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#00D2FF] hover:underline"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Abrir aba: {msg.openedTab.title}
                        </a>
                        {msg.openedTab.spotifyUri && (
                          <a
                            href={msg.openedTab.spotifyUri}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:underline"
                          >
                            <Play className="w-3 h-3" />
                            Abrir no App Spotify
                          </a>
                        )}
                        {msg.openedTab.embedUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTabAction({
                                ...msg.openedTab!,
                                autoplay: true,
                                blocked: true,
                              });
                              setIslandExpanded(true);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
                          >
                            <Play className="w-3 h-3 text-[#00D2FF]" />
                            Tocar na Ilha
                          </button>
                        )}
                      </div>
                    )}

                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-white/10 flex flex-wrap gap-3">
                        {msg.sources.slice(0, 4).map((src, i) => (
                          <a
                            key={`${src.uri}-${i}`}
                            href={src.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-[#00D2FF] transition-colors truncate max-w-[240px]"
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <span className="truncate">{src.title}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Text Command Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessageToOrbi(inputText);
              }}
              className="flex items-center gap-2 pt-2 border-t border-white/[0.07]"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Digite uma pergunta, comando ou busca de arquivo..."
                className="flex-1 bg-[#080A0F] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00D2FF]"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || mood === "thinking"}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#00D2FF] text-[#030508] text-xs font-semibold hover:bg-[#33DCFF] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                Enviar
              </button>
            </form>
          </section>

          {/* Column 2 (5 cols): Pastas Locais + Voz Masculina Gemini + Tela + Windows */}
          <div className="lg:col-span-5 space-y-6">
            {/* Local Folders Silent Search */}
            <section
              id="pastas"
              className="rounded-2xl bg-[#0E121B] border border-white/[0.08] p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Pastas Locais (Busca Silenciosa)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    O Orbi procura sem abrir janelas e pede permissão para abrir
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleAuthorizeFolder()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#00D2FF]" />
                  Autorizar Pasta
                </button>
              </div>

              {authorizedFolders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-slate-400 space-y-2">
                  <p>
                    Nenhuma pasta do computador conectada. Autorize uma pasta (como Documentos ou Downloads) para pedir ao Orbi: &ldquo;procure o arquivo X na pasta Y&rdquo;.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-3 text-xs text-slate-300">
                    {authorizedFolders.map((folder) => (
                      <span key={folder.name} className="font-mono tabular-nums">
                        {folder.name} ({folder.count} arquivos)
                      </span>
                    ))}
                  </div>

                  <div className="relative">
                    <FileSearch className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={localSearchQuery}
                      onChange={(e) => setLocalSearchQuery(e.target.value)}
                      placeholder="Filtrar arquivos indexados..."
                      className="w-full bg-[#080A0F] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#00D2FF]"
                    />
                  </div>

                  <div className="divide-y divide-white/[0.06] max-h-40 overflow-y-auto">
                    {filteredLocalFiles.map((f) => (
                      <div
                        key={f.id}
                        className="py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="text-slate-200 truncate">{f.name}</p>
                          <p className="text-[11px] text-slate-500 font-mono truncate">
                            {f.path} · {formatBytes(f.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingFileAuth({
                              file: f,
                              matches: [f],
                              status: "asking",
                              requestedAt: new Date().toLocaleTimeString(
                                "pt-BR",
                                { hour: "2-digit", minute: "2-digit" }
                              ),
                            });
                            setIslandExpanded(true);
                            setMood("authorizing");
                            const q = `Encontrei ${f.name} na pasta ${f.folder}. Deseja que eu abra agora?`;
                            setLastReply(q);
                            if (autoSpeak) void speakWithGemini(q);
                          }}
                          className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-[#00D2FF] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Solicitar abertura
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Waiting Queue ("Aguarda") */}
              {waitingFiles.length > 0 && (
                <div className="pt-3 border-t border-white/[0.07] space-y-2">
                  <p className="text-xs font-medium text-amber-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Aguardando sua ordem ({waitingFiles.length})
                  </p>
                  {waitingFiles.map((wf) => (
                    <div
                      key={wf.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-amber-400/5 border border-amber-400/20 px-3 py-2 text-xs"
                    >
                      <span className="truncate text-slate-200">{wf.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleFileDecision("open", wf)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#00D2FF] text-[#030508] text-[11px] font-semibold cursor-pointer"
                        >
                          <Check className="w-3 h-3" /> Abrir
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setWaitingFiles((prev) =>
                              prev.filter((item) => item.id !== wf.id)
                            )
                          }
                          className="p-1 text-slate-400 hover:text-rose-300 cursor-pointer"
                          title="Remover da espera"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Screen Reading & Gemini Male Voice Config */}
            <section
              id="tela"
              className="rounded-2xl bg-[#0E121B] border border-white/[0.08] p-5 space-y-5"
            >
              {/* Screen Share */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Leitura da Tela
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Captura sob demanda em baixo FPS para não pesar no PC
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (screenActive) stopScreenCapture();
                    else void startScreenCapture();
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    screenActive
                      ? "bg-emerald-500/15 border border-emerald-500/35 text-emerald-300"
                      : "bg-white/10 hover:bg-white/15 text-white"
                  }`}
                >
                  {screenActive ? (
                    <>
                      <MonitorOff className="w-3.5 h-3.5" /> Desconectar Tela
                    </>
                  ) : (
                    <>
                      <Monitor className="w-3.5 h-3.5 text-[#00D2FF]" />{" "}
                      Conectar Tela
                    </>
                  )}
                </button>
              </div>

              {/* Gemini Male Voice Selection */}
              <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">
                    Voz Masculina Oficial do Gemini
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void speakWithGemini(
                        `Olá, eu sou o Orbi Dynamic falando com a voz masculina ${voice} do Gemini.`
                      )
                    }
                    className="text-[11px] text-[#00D2FF] hover:underline cursor-pointer"
                  >
                    Testar voz
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {MALE_VOICE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setVoice(opt.id)}
                      className={`px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                        voice === opt.id
                          ? "bg-[#00D2FF]/15 border-[#00D2FF]/50 text-white"
                          : "bg-[#080A0F] border-white/10 text-slate-400 hover:text-white"
                      }`}
                    >
                      <div className="text-xs font-semibold">{opt.label}</div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Poco X8 Pro / HyperOS 3 Dynamic Island Section */}
            <section
              id="celular"
              className="rounded-2xl bg-[#0E121B] border border-[#00D2FF]/20 p-5 space-y-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-[#00D2FF]" />
                    Poco X8 Pro · HyperOS 3 (100% Gratuito)
                  </h2>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Não precisa pagar nada nem publicar em loja: abra este mesmo
                    link no{" "}
                    <span className="text-slate-200 font-medium">
                      Chrome do celular
                    </span>
                    , instale como app gratuito e ative o modo abaixo para ficar
                    na{" "}
                    <span className="text-slate-200 font-medium">
                      Ilha Dinâmica da HyperOS 3
                    </span>{" "}
                    mesmo ao sair do app.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={toggleHyperOSIsland}
                className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  isHyperOSActive
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20"
                    : "bg-white/10 border-white/10 text-white hover:bg-white/15"
                }`}
              >
                <Radio
                  className={`w-3.5 h-3.5 ${
                    isHyperOSActive && !isPausedInIsland ? "animate-pulse" : ""
                  }`}
                />
                {isHyperOSActive
                  ? isPausedInIsland
                    ? "Ilha HyperOS 3 Pausada · Toque para Desativar"
                    : "Ativo na Ilha Dinâmica HyperOS 3"
                  : "Manter na Ilha da HyperOS 3 ao Sair"}
              </button>

              {hyperOSStatusMsg && (
                <p className="text-[11px] text-amber-300">{hyperOSStatusMsg}</p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <PWAInstallButton variant="card" />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(window.location.href)
                      .then(() => {
                        setCopiedPhoneLink(true);
                        window.setTimeout(() => setCopiedPhoneLink(false), 2200);
                      })
                      .catch(() => {});
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors cursor-pointer"
                >
                  {copiedPhoneLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Link Copiado!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#00D2FF]" />
                      Copiar Link p/ Celular
                    </>
                  )}
                </button>
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Dica grátis: abra o Google AI Studio no Chrome do Poco X8 Pro
                com sua mesma conta Google (ou use o botão Compartilhar, que é
                gratuito) e toque em Instalar App.
              </p>
            </section>

            {/* Lightweight Windows Companion Section */}
            <section
              id="windows"
              className="rounded-2xl bg-[#0E121B] border border-white/[0.08] p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Executar Nativo no Windows
                  </h2>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Baixe o script ultra-leve (~25 MB de RAM) para fixar a ilha com os dois olhinhos ciano flutuando no topo da tela do seu Windows 10/11 acompanhando o mouse globalmente.
                  </p>
                </div>
              </div>
              <div className="rounded-lg bg-[#080A0F] border border-white/10 p-3 font-mono text-[11px] text-slate-300 space-y-1">
                <div>1. py -m pip install pillow requests</div>
                <div>2. py orbi_dynamic_windows.pyw</div>
              </div>
              <button
                type="button"
                onClick={() => void downloadWindowsScriptSafely()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#00D2FF]" />
                Baixar orbi_dynamic_windows.pyw
              </button>
            </section>
          </div>
        </div>
      </main>

      {/* File Preview Modal when user authorizes opening */}
      <FilePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />

      {/* Offline PWA connectivity notice */}
      <OfflineIndicator />
    </div>
  );
}
