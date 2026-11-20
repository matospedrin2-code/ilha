import { useCallback, useEffect, useRef, useState } from "react";
import { OrbiMood } from "../types/orbi";

interface UseHyperOSIslandOptions {
  mood: OrbiMood;
  lastReply: string;
  activeTabTitle?: string | null;
  onTriggerVoice?: () => void;
  onStopSpeaking?: () => void;
}

/**
 * Generates an ultra-lightweight 1-second silent 8kHz mono PCM WAV Blob URL.
 * Keeping an active silent audio loop + MediaSession metadata is what allows
 * Xiaomi HyperOS 3's native Dynamic Island / Live Media pill on Poco X8 Pro
 * to keep displaying Orbi Dynamic even after leaving the app/browser.
 */
function createSilentWavBlobUrl(): string {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // Byte rate
  view.setUint16(32, 1, true); // Block align
  view.setUint16(34, 8, true); // 8-bit unsigned
  writeStr(36, "data");
  view.setUint32(40, numSamples, true);

  // 0x80 is exact digital zero for unsigned 8-bit PCM
  const bytes = new Uint8Array(buffer, 44);
  bytes.fill(0x80);

  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

export function useHyperOSIsland({
  mood,
  lastReply,
  activeTabTitle,
  onTriggerVoice,
  onStopSpeaking,
}: UseHyperOSIslandOptions) {
  const [isHyperOSActive, setIsHyperOSActive] = useState(false);
  const [isPausedInIsland, setIsPausedInIsland] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const silentUrlRef = useRef<string | null>(null);
  const onTriggerVoiceRef = useRef(onTriggerVoice);
  const onStopSpeakingRef = useRef(onStopSpeaking);

  useEffect(() => {
    onTriggerVoiceRef.current = onTriggerVoice;
    onStopSpeakingRef.current = onStopSpeaking;
  }, [onTriggerVoice, onStopSpeaking]);

  const stopHyperOSIsland = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = "none";
      } catch {
        // Ignore browser restriction
      }
    }
    setIsHyperOSActive(false);
    setIsPausedInIsland(false);
    setStatusMessage(null);
  }, []);

  const syncMediaSessionMetadata = useCallback(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") {
      return;
    }

    let title = "Orbi Dynamic · Ativo";
    if (mood === "listening") title = "Orbi Ouvindo você...";
    else if (mood === "thinking") title = "Orbi Pensando...";
    else if (mood === "speaking") title = "Orbi Falando (Gemini)";
    else if (mood === "authorizing") title = "Orbi Aguardando Autorização";
    else if (activeTabTitle) title = `Tocando: ${activeTabTitle}`;

    const artist = "Orbi Dynamic · HyperOS 3";
    const album = lastReply
      ? lastReply.slice(0, 72) + (lastReply.length > 72 ? "..." : "")
      : "Toque em Play na ilha para ativar";

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork: [
          {
            src: `${window.location.origin}/pwa-192x192.png`,
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: `${window.location.origin}/pwa-512x512.png`,
            sizes: "512x512",
            type: "image/png",
          },
        ],
      });
    } catch {
      // Ignore unsupported metadata fields
    }
  }, [activeTabTitle, lastReply, mood]);

  const startHyperOSIsland = useCallback(async () => {
    setStatusMessage(null);

    if (!silentUrlRef.current) {
      silentUrlRef.current = createSilentWavBlobUrl();
    }
    if (!audioRef.current) {
      const audio = new Audio(silentUrlRef.current);
      audio.loop = true;
      audio.preload = "auto";
      audio.setAttribute("playsinline", "true");
      audioRef.current = audio;
    }

    try {
      await audioRef.current.play();
      setIsHyperOSActive(true);
      setIsPausedInIsland(false);
      syncMediaSessionMetadata();

      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
        navigator.mediaSession.setActionHandler("play", () => {
          void audioRef.current?.play().catch(() => {});
          setIsPausedInIsland(false);
          navigator.mediaSession.playbackState = "playing";
          onTriggerVoiceRef.current?.();
        });
        navigator.mediaSession.setActionHandler("pause", () => {
          audioRef.current?.pause();
          setIsPausedInIsland(true);
          navigator.mediaSession.playbackState = "paused";
          onStopSpeakingRef.current?.();
        });
        navigator.mediaSession.setActionHandler("stop", () => {
          onStopSpeakingRef.current?.();
          stopHyperOSIsland();
        });
        navigator.mediaSession.setActionHandler("nexttrack", () => {
          onTriggerVoiceRef.current?.();
        });
      }

      // Request notification permission so HyperOS 3 Dynamic Island also shows replies in background
      if ("Notification" in window) {
        if (Notification.permission === "default") {
          const perm = await Notification.requestPermission();
          setNotificationPermission(perm);
        } else {
          setNotificationPermission(Notification.permission);
        }
      }
    } catch {
      setStatusMessage(
        "Não foi possível iniciar o áudio em segundo plano neste navegador."
      );
    }
  }, [stopHyperOSIsland, syncMediaSessionMetadata]);

  const toggleHyperOSIsland = useCallback(() => {
    if (isHyperOSActive) {
      stopHyperOSIsland();
    } else {
      void startHyperOSIsland();
    }
  }, [isHyperOSActive, startHyperOSIsland, stopHyperOSIsland]);

  // Keep HyperOS 3 Dynamic Island metadata fresh while active or speaking
  useEffect(() => {
    if (isHyperOSActive || mood === "speaking" || Boolean(activeTabTitle)) {
      syncMediaSessionMetadata();
      if ("mediaSession" in navigator && isHyperOSActive) {
        try {
          navigator.mediaSession.playbackState = isPausedInIsland
            ? "paused"
            : "playing";
        } catch {
          // Ignore
        }
      }
    }
  }, [
    activeTabTitle,
    isHyperOSActive,
    isPausedInIsland,
    lastReply,
    mood,
    syncMediaSessionMetadata,
  ]);

  // Show a HyperOS 3 notification capsule update when a reply arrives while user is in another app
  const showBackgroundCapsuleAlert = useCallback(
    async (title: string, body: string) => {
      if (!isHyperOSActive) return;
      if (!("Notification" in window) || Notification.permission !== "granted") {
        return;
      }
      if (!document.hidden) return;

      const options: NotificationOptions & { renotify?: boolean } = {
        body: body.slice(0, 140),
        icon: "/pwa-192x192.png",
        badge: "/pwa-192x192.png",
        tag: "orbi-hyperos-island",
        renotify: true,
        silent: true,
      };

      try {
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification(title, options);
          return;
        }
        new Notification(title, options);
      } catch {
        // Ignore notification errors in restricted contexts
      }
    },
    [isHyperOSActive]
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (silentUrlRef.current) {
        URL.revokeObjectURL(silentUrlRef.current);
        silentUrlRef.current = null;
      }
    };
  }, []);

  return {
    isHyperOSActive,
    isPausedInIsland,
    notificationPermission,
    statusMessage,
    toggleHyperOSIsland,
    startHyperOSIsland,
    stopHyperOSIsland,
    showBackgroundCapsuleAlert,
  };
}
