import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  Clock,
  ExternalLink,
  FileSearch,
  Mic,
  MicOff,
  Pause,
  Play,
  Square,
  Volume2,
  X,
} from "lucide-react";
import {
  GroundingSource,
  OpenedTabInfo,
  OrbiMood,
  PendingFileAuth,
} from "../types/orbi";

interface DynamicIslandProps {
  mood: OrbiMood;
  liteMode: boolean;
  isExpanded: boolean;
  onToggleExpand: (next: boolean) => void;
  onIslandClick: () => void;
  onStopSpeaking: () => void;
  liveTranscript: string;
  lastReply: string;
  lastSources: GroundingSource[];
  pendingFileAuth: PendingFileAuth | null;
  onFileDecision: (decision: "open" | "wait" | "cancel") => void;
  activeTabAction?: OpenedTabInfo | null;
  onDismissTabAction?: () => void;
  audioLevel: number;
  lastClickedLabel: string | null;
}

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  mood,
  liteMode,
  isExpanded,
  onToggleExpand,
  onIslandClick,
  onStopSpeaking,
  liveTranscript,
  lastReply,
  lastSources,
  pendingFileAuth,
  onFileDecision,
  activeTabAction,
  onDismissTabAction,
  audioLevel,
  lastClickedLabel,
}) => {
  const islandRef = useRef<HTMLDivElement | null>(null);
  const leftEyeRef = useRef<HTMLDivElement | null>(null);
  const rightEyeRef = useRef<HTMLDivElement | null>(null);
  const [isBlinking, setIsBlinking] = useState(false);
  const [clickPulse, setClickPulse] = useState(false);

  const pointerTargetRef = useRef({ x: 0, y: 0 });
  const currentOffsetRef = useRef({ x: 0, y: 0 });

  // Natural periodic blinking
  useEffect(() => {
    let timeoutId: number;
    const scheduleBlink = () => {
      const delay = 3200 + Math.random() * 3400;
      timeoutId = window.setTimeout(() => {
        if (mood === "idle" || mood === "speaking") {
          setIsBlinking(true);
          window.setTimeout(() => setIsBlinking(false), 140);
        }
        scheduleBlink();
      }, delay);
    };
    scheduleBlink();
    return () => window.clearTimeout(timeoutId);
  }, [mood]);

  // Global mouse movement + click tracking directly via GPU transform (zero React re-renders per frame)
  useEffect(() => {
    let rafId = 0;

    const updateTargetFromPoint = (clientX: number, clientY: number) => {
      const el = islandRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const rawDx = (clientX - cx) / (window.innerWidth * 0.45);
      const rawDy = (clientY - cy) / (window.innerHeight * 0.55);

      const clampedX = Math.max(-1, Math.min(1, rawDx)) * 12;
      const clampedY = Math.max(-0.6, Math.min(1, rawDy)) * 7;

      pointerTargetRef.current = { x: clampedX, y: clampedY };
    };

    const handlePointerMove = (e: PointerEvent) => {
      updateTargetFromPoint(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        updateTargetFromPoint(touch.clientX, touch.clientY);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      updateTargetFromPoint(e.clientX, e.clientY);
      setClickPulse(true);
      window.setTimeout(() => setClickPulse(false), 180);
    };

    const tick = () => {
      const target = pointerTargetRef.current;
      const curr = currentOffsetRef.current;

      // Smooth lerp; faster when liteMode is off, snappy anyway
      const factor = liteMode ? 0.35 : 0.18;
      curr.x += (target.x - curr.x) * factor;
      curr.y += (target.y - curr.y) * factor;

      let extraY = 0;
      let scaleY = 1;
      let scaleX = 1;

      if (mood === "thinking") {
        extraY = -3;
        scaleY = 0.88;
      } else if (mood === "speaking") {
        const bounce = Math.min(0.24, audioLevel * 0.4);
        scaleY = 1 + bounce;
        scaleX = 1 - bounce * 0.25;
      } else if (mood === "listening") {
        scaleX = 1.07;
        scaleY = 1.07;
      } else if (mood === "authorizing") {
        scaleY = 0.92;
      }

      if (isBlinking) {
        scaleY = 0.08;
      } else if (clickPulse && mood === "idle") {
        scaleY = 0.78;
        scaleX = 1.06;
      }

      const transform = `translate3d(${curr.x.toFixed(2)}px, ${(
        curr.y + extraY
      ).toFixed(2)}px, 0) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`;

      if (leftEyeRef.current) {
        leftEyeRef.current.style.transform = transform;
      }
      if (rightEyeRef.current) {
        rightEyeRef.current.style.transform = transform;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.cancelAnimationFrame(rafId);
    };
  }, [mood, isBlinking, clickPulse, audioLevel, liteMode]);

  const [showInlinePlayer, setShowInlinePlayer] = useState(false);
  const [isMediaPaused, setIsMediaPaused] = useState(false);
  const ytIframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoCollapsedKeyRef = useRef<string>("");

  useEffect(() => {
    setIsMediaPaused(false);
    if (
      activeTabAction?.embedUrl &&
      activeTabAction.autoplay &&
      activeTabAction.blocked
    ) {
      setShowInlinePlayer(true);
    } else {
      setShowInlinePlayer(false);
    }
  }, [activeTabAction]);

  // Auto-collapse back to compact Dynamic Island when playing music or speaking a very long text
  useEffect(() => {
    const isLongSpeech = mood === "speaking" && lastReply.length > 110;
    const isMusicPlaying = showInlinePlayer && !isMediaPaused;

    if (!isExpanded) return;
    if (mood === "listening" || mood === "thinking" || pendingFileAuth?.status === "asking") {
      return;
    }

    if (isMusicPlaying) {
      const key = `music:${activeTabAction?.url || ""}`;
      if (autoCollapsedKeyRef.current !== key) {
        const t = window.setTimeout(() => {
          autoCollapsedKeyRef.current = key;
          onToggleExpand(false);
        }, 2200);
        return () => window.clearTimeout(t);
      }
    } else if (isLongSpeech) {
      const key = `speech:${lastReply.slice(0, 40)}`;
      if (autoCollapsedKeyRef.current !== key) {
        const t = window.setTimeout(() => {
          autoCollapsedKeyRef.current = key;
          onToggleExpand(false);
        }, 2400);
        return () => window.clearTimeout(t);
      }
    }
  }, [
    activeTabAction?.url,
    isExpanded,
    isMediaPaused,
    lastReply,
    mood,
    onToggleExpand,
    pendingFileAuth?.status,
    showInlinePlayer,
  ]);

  const toggleYouTubePlayPause = () => {
    const nextPaused = !isMediaPaused;
    setIsMediaPaused(nextPaused);
    ytIframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({
        event: "command",
        func: nextPaused ? "pauseVideo" : "playVideo",
        args: "",
      }),
      "*"
    );
  };

  const showDrawer =
    isExpanded ||
    mood === "listening" ||
    mood === "thinking" ||
    pendingFileAuth?.status === "asking";

  const hasBackgroundMedia = showInlinePlayer || mood === "speaking";
  const compactMediaMode = !showDrawer && hasBackgroundMedia;

  const isActiveRim =
    !liteMode &&
    (mood === "listening" ||
      mood === "thinking" ||
      mood === "speaking" ||
      mood === "authorizing" ||
      (showInlinePlayer && !isMediaPaused));

  const eyeColorClass =
    mood === "error"
      ? "bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,0.65)]"
      : mood === "authorizing"
      ? "bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.65)]"
      : liteMode
      ? "bg-[#00D2FF]"
      : "bg-[#00D2FF] shadow-[0_0_18px_rgba(0,210,255,0.65)]";

  const handleCompactVisorClick = () => {
    if (compactMediaMode) {
      onToggleExpand(true);
    } else {
      onIslandClick();
    }
  };

  return (
    <div className="fixed top-[max(0.5rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none select-none w-full max-w-[540px] px-3">
      {/* Outer Rim Container (Attachment 1 inspiration) */}
      <div
        ref={islandRef}
        className={`pointer-events-auto relative rounded-[26px] p-[1.5px] transition-transform duration-200 ${
          isActiveRim
            ? "orbi-rim-active shadow-[0_14px_45px_rgba(0,210,255,0.18)]"
            : "bg-white/15 shadow-[0_12px_36px_rgba(0,0,0,0.75)]"
        }`}
      >
        <div
          className={`bg-[#030508] rounded-[24.5px] overflow-hidden transition-all duration-200 ${
            showDrawer
              ? "w-[min(510px,calc(100vw-28px))]"
              : compactMediaMode
              ? "w-[258px]"
              : "w-[228px]"
          }`}
        >
          {/* Top Compact Visor: Always Visible Eyes */}
          <div className="flex items-center justify-between px-4 h-[54px] gap-3">
            <button
              type="button"
              onClick={showDrawer ? onIslandClick : handleCompactVisorClick}
              title={
                compactMediaMode
                  ? `${activeTabAction?.title || "Reproduzindo"} — clique para abrir controles`
                  : mood === "listening"
                  ? "Clique para parar de ouvir"
                  : "Clique na ilha para falar com o Orbi"
              }
              aria-label={
                compactMediaMode
                  ? "Abrir controles de reprodução do Orbi Dynamic"
                  : "Ativar escuta de voz do Orbi Dynamic"
              }
              className={`flex items-center gap-3 flex-1 h-full cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00D2FF] rounded-xl ${
                compactMediaMode ? "justify-between" : "justify-center"
              }`}
            >
              {/* Status left glyph when expanded */}
              {showDrawer && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mr-auto whitespace-nowrap">
                  {mood === "listening" ? (
                    <Mic className="w-3.5 h-3.5 text-[#00D2FF]" />
                  ) : mood === "speaking" ? (
                    <Volume2 className="w-3.5 h-3.5 text-[#00D2FF]" />
                  ) : mood === "authorizing" ? (
                    <FileSearch className="w-3.5 h-3.5 text-amber-300" />
                  ) : (
                    <Mic className="w-3.5 h-3.5 text-slate-500 group-hover:text-[#00D2FF] transition-colors" />
                  )}
                  <span className="hidden sm:inline">Orbi Dynamic</span>
                </span>
              )}

              {/* The Iconic Two OLED Cyan Eyes (shift left naturally when compact media is active) */}
              <div
                className={`flex items-center justify-center gap-2.5 py-1 transition-all duration-200 ${
                  compactMediaMode ? "pl-0.5 pr-1" : "px-2"
                }`}
              >
                <div
                  ref={leftEyeRef}
                  className={`w-[24px] h-[23px] rounded-[6.5px] will-change-transform transition-colors duration-150 ${eyeColorClass}`}
                />
                <div
                  ref={rightEyeRef}
                  className={`w-[24px] h-[23px] rounded-[6.5px] will-change-transform transition-colors duration-150 ${eyeColorClass}`}
                />
              </div>

              {/* Right micro indicator when compact */}
              {!showDrawer ? (
                compactMediaMode ? (
                  <div className="flex items-center gap-2 pr-0.5">
                    <span className="text-[11px] font-medium text-slate-300 max-w-[76px] truncate">
                      {mood === "speaking" && !showInlinePlayer
                        ? "Falando"
                        : isMediaPaused
                        ? "Pausado"
                        : activeTabAction?.title || "Tocando"}
                    </span>
                    {/* Equalizer Visualizer Bars */}
                    <div
                      className="flex items-end gap-[2.5px] h-4 w-5 justify-center"
                      aria-hidden="true"
                    >
                      {[0, 0.18, 0.36, 0.12].map((delay, idx) => (
                        <span
                          key={idx}
                          style={{
                            animationDelay: `${delay}s`,
                            animationPlayState:
                              isMediaPaused && mood !== "speaking"
                                ? "paused"
                                : "running",
                          }}
                          className={`w-[3px] rounded-full transition-colors ${
                            isMediaPaused && mood !== "speaking"
                              ? "h-1.5 bg-slate-500"
                              : liteMode
                              ? "h-3.5 bg-[#00D2FF]"
                              : "h-4 bg-[#00D2FF] orbi-eq-bar"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className="text-[11px] font-medium text-slate-400 group-hover:text-slate-200 transition-colors whitespace-nowrap">
                    Falar
                  </span>
                )
              ) : (
                <div className="ml-auto flex items-center gap-1.5">
                  {mood === "speaking" && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        onStopSpeaking();
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          onStopSpeaking();
                        }
                      }}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
                      title="Parar voz"
                    >
                      <Square className="w-3 h-3 fill-current" />
                    </span>
                  )}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpand(false);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        onToggleExpand(false);
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                    title="Recolher ilha"
                  >
                    <X className="w-3.5 h-3.5" />
                  </span>
                </div>
              )}
            </button>
          </div>

          {/* Expanded Drawer Area inside Dynamic Island */}
          {showDrawer && (
            <div className="px-4 pb-4 pt-1 border-t border-white/10 space-y-3 text-left">
              {/* Context Awareness Line */}
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="truncate">
                  {mood === "listening"
                    ? "Microfone ativo · fale sua pergunta ou comando"
                    : mood === "thinking"
                    ? "Consultando Gemini e ferramentas..."
                    : mood === "speaking"
                    ? "Respondendo com voz do Gemini"
                    : mood === "authorizing"
                    ? "Aguardando sua autorização"
                    : lastClickedLabel
                    ? `Último foco: ${lastClickedLabel}`
                    : "Pronto · clique nos olhos para falar"}
                </span>
                <button
                  type="button"
                  onClick={onIslandClick}
                  className={`ml-2 px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    mood === "listening"
                      ? "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                      : "bg-[#00D2FF]/15 text-[#00D2FF] hover:bg-[#00D2FF]/25"
                  }`}
                >
                  {mood === "listening" ? (
                    <span className="inline-flex items-center gap-1">
                      <MicOff className="w-3 h-3" /> Parar
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Mic className="w-3 h-3" /> Ouvir
                    </span>
                  )}
                </button>
              </div>

              {/* Live Transcript */}
              {liveTranscript && (
                <div className="rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 text-xs text-slate-200">
                  <span className="text-slate-400 mr-1.5">Você:</span>
                  {liveTranscript}
                </div>
              )}

              {/* File Authorization Prompt (Required behavior when file is found) */}
              {pendingFileAuth && pendingFileAuth.status === "asking" && (
                <div className="rounded-xl bg-amber-400/10 border border-amber-400/25 p-3 space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <FileSearch className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-amber-100 truncate">
                        Arquivo encontrado: {pendingFileAuth.file.name}
                      </p>
                      <p className="text-[11px] text-amber-200/80 font-mono truncate">
                        {pendingFileAuth.file.path}
                      </p>
                      <p className="text-[11px] text-slate-300 mt-1">
                        Deseja que eu abra este arquivo agora? (Pode responder por
                        voz ou clicar abaixo)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onFileDecision("open")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00D2FF] text-[#030508] text-xs font-semibold hover:bg-[#33DCFF] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" /> Quero abrir
                    </button>
                    <button
                      type="button"
                      onClick={() => onFileDecision("wait")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-slate-200 text-xs font-medium hover:bg-white/15 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Clock className="w-3.5 h-3.5" /> Aguarda
                    </button>
                    <button
                      type="button"
                      onClick={() => onFileDecision("cancel")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-transparent border border-white/10 text-slate-400 text-xs font-medium hover:text-white hover:border-white/25 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Não quero
                    </button>
                  </div>
                </div>
              )}

              {/* Orbi Spoken Response */}
              {lastReply && (
                <div className="text-[13px] leading-relaxed text-slate-100 max-h-40 overflow-y-auto pr-1">
                  {lastReply}
                </div>
              )}

              {/* Active Media / Tab Action Card */}
              {activeTabAction && (
                <div className="rounded-xl bg-white/[0.04] border border-[#00D2FF]/25 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">
                        {activeTabAction.title}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {activeTabAction.blocked
                          ? "Abertura automática bloqueada pelo navegador · clique para abrir"
                          : "Aba preparada para você"}
                      </p>
                    </div>
                    {onDismissTabAction && (
                      <button
                        type="button"
                        onClick={onDismissTabAction}
                        className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                        title="Fechar player/atalho"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={activeTabAction.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00D2FF] text-[#030508] text-xs font-semibold hover:bg-[#33DCFF] transition-colors whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      {activeTabAction.platform === "spotify"
                        ? "Abrir Spotify Web"
                        : activeTabAction.platform === "youtube"
                        ? "Abrir no YouTube"
                        : "Abrir Nova Aba"}
                    </a>

                    {activeTabAction.spotifyUri && (
                      <a
                        href={activeTabAction.spotifyUri}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-slate-200 text-xs font-medium hover:bg-white/15 transition-colors whitespace-nowrap"
                      >
                        <Play className="w-3.5 h-3.5 text-emerald-400" />
                        App Spotify
                      </a>
                    )}

                    {activeTabAction.embedUrl && !showInlinePlayer && (
                      <button
                        type="button"
                        onClick={() => setShowInlinePlayer(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-slate-200 text-xs font-medium hover:bg-white/15 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Play className="w-3.5 h-3.5 text-[#00D2FF]" />
                        Tocar na Ilha
                      </button>
                    )}

                    {showInlinePlayer && activeTabAction.embedUrl && (
                      <button
                        type="button"
                        onClick={toggleYouTubePlayPause}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-slate-100 text-xs font-medium hover:bg-white/15 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {isMediaPaused ? (
                          <>
                            <Play className="w-3.5 h-3.5 text-[#00D2FF]" />
                            Continuar Música
                          </>
                        ) : (
                          <>
                            <Pause className="w-3.5 h-3.5 text-[#00D2FF]" />
                            Pausar Música
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Web Grounding Sources */}
              {lastSources.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1 border-t border-white/10">
                  {lastSources.slice(0, 3).map((src, idx) => (
                    <a
                      key={`${src.uri}-${idx}`}
                      href={src.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-[#00D2FF] hover:underline truncate max-w-[220px]"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{src.title}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Persistent YouTube Player Container (keeps audio playing seamlessly when island collapses!) */}
          {showInlinePlayer && activeTabAction?.embedUrl && (
            <div
              className={
                showDrawer
                  ? "px-4 pb-4 pt-0 transition-all"
                  : "h-0 w-0 overflow-hidden opacity-0 pointer-events-none"
              }
            >
              <iframe
                ref={ytIframeRef}
                src={activeTabAction.embedUrl}
                title={activeTabAction.title}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="w-full h-40 rounded-lg border border-white/10 bg-black"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
