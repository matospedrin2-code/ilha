import { useCallback, useEffect, useRef, useState } from "react";
import { GeminiMaleVoice } from "../types/orbi";
import { postJson } from "../utils/safeFetch";

interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface UseOrbiVoiceOptions {
  voice: GeminiMaleVoice;
  onTranscriptFinal: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (message: string) => void;
}

export function useOrbiVoice({
  voice,
  onTranscriptFinal,
  onListeningChange,
  onSpeakingChange,
  onError,
}: UseOrbiVoiceOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafLevelRef = useRef<number>(0);
  const finalTranscriptRef = useRef<string>("");
  const speakRequestIdRef = useRef<number>(0);

  const onTranscriptFinalRef = useRef(onTranscriptFinal);
  const onListeningChangeRef = useRef(onListeningChange);
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTranscriptFinalRef.current = onTranscriptFinal;
    onListeningChangeRef.current = onListeningChange;
    onSpeakingChangeRef.current = onSpeakingChange;
    onErrorRef.current = onError;
  }, [onTranscriptFinal, onListeningChange, onSpeakingChange, onError]);

  const stopSpeaking = useCallback(() => {
    speakRequestIdRef.current += 1;
    if (rafLevelRef.current) {
      window.cancelAnimationFrame(rafLevelRef.current);
      rafLevelRef.current = 0;
    }
    if (audioElRef.current) {
      const currentAudio = audioElRef.current;
      audioElRef.current = null;
      currentAudio.onended = null;
      currentAudio.onerror = null;
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      } catch {
        // ignore
      }
    }
    setAudioLevel(0);
    setIsSpeaking(false);
    onSpeakingChangeRef.current?.(false);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setIsListening(false);
    onListeningChangeRef.current?.(false);
  }, []);

  const startMediaRecorderFallback = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        if (blob.size < 400) return;

        setLiveTranscript("Transcrevendo sua fala...");
        try {
          const base64 = await blobToBase64(blob);
          const data = await postJson<{ text?: string }>("/api/orbi/transcribe", {
            audioBase64: base64,
            mimeType,
          });
          if (data.text) {
            setLiveTranscript(data.text);
            onTranscriptFinalRef.current(data.text);
          } else {
            setLiveTranscript("");
          }
        } catch (err) {
          onErrorRef.current?.(
            err instanceof Error ? err.message : "Erro ao transcrever áudio."
          );
          setLiveTranscript("");
        }
      };

      recorder.start();
      setIsListening(true);
      onListeningChangeRef.current?.(true);
      setLiveTranscript("Gravando áudio... clique na ilha para enviar.");
    } catch {
      onErrorRef.current?.(
        "Não foi possível acessar o microfone. Verifique a permissão do navegador ou digite seu comando."
      );
      setIsListening(false);
      onListeningChangeRef.current?.(false);
    }
  }, []);

  const startListening = useCallback(() => {
    stopSpeaking();
    finalTranscriptRef.current = "";
    setLiveTranscript("");

    const WinSpeech =
      (
        window as unknown as {
          SpeechRecognition?: new () => SpeechRecognitionLike;
          webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        }
      ).webkitSpeechRecognition;

    if (!WinSpeech) {
      void startMediaRecorderFallback();
      return;
    }

    try {
      const recognition = new WinSpeech();
      recognition.lang = "pt-BR";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognitionRef.current = recognition;

      recognition.onresult = (event) => {
        let interim = "";
        let finalized = "";
        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0].transcript;
          if (res.isFinal) finalized += text + " ";
          else interim += text;
        }
        const combined = (finalized + interim).trim();
        setLiveTranscript(combined);
        if (finalized.trim()) {
          finalTranscriptRef.current = finalized.trim();
        }
      };

      recognition.onerror = (ev) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          onErrorRef.current?.("Permissão de microfone negada no navegador.");
          stopListening();
        } else if (ev.error === "network" || ev.error === "audio-capture") {
          recognitionRef.current = null;
          void startMediaRecorderFallback();
        } else {
          stopListening();
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        onListeningChangeRef.current?.(false);
        recognitionRef.current = null;
        const spoken = finalTranscriptRef.current.trim();
        if (spoken) {
          finalTranscriptRef.current = "";
          onTranscriptFinalRef.current(spoken);
        }
      };

      recognition.start();
      setIsListening(true);
      onListeningChangeRef.current?.(true);
    } catch {
      void startMediaRecorderFallback();
    }
  }, [
    startMediaRecorderFallback,
    stopListening,
    stopSpeaking,
  ]);

  const playWavBase64 = useCallback(
    async (audioBase64: string) => {
      stopSpeaking();
      const requestId = speakRequestIdRef.current;
      setIsSpeaking(true);
      onSpeakingChangeRef.current?.(true);

      const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
      audioElRef.current = audio;

      try {
        if (!audioCtxRef.current) {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        if (speakRequestIdRef.current !== requestId) return;

        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyser.connect(ctx.destination);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (!audioElRef.current || audioElRef.current.paused) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / (dataArray.length * 255);
          setAudioLevel(avg);
          rafLevelRef.current = window.requestAnimationFrame(updateLevel);
        };
        rafLevelRef.current = window.requestAnimationFrame(updateLevel);
      } catch {
        // Fallback if WebAudio node fails; audio still plays normally
      }

      if (speakRequestIdRef.current !== requestId) return;

      audio.onended = () => {
        if (speakRequestIdRef.current === requestId) {
          stopSpeaking();
        }
      };
      audio.onerror = () => {
        if (speakRequestIdRef.current === requestId) {
          stopSpeaking();
        }
      };

      try {
        await audio.play();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Playback was intentionally interrupted by stopSpeaking or a newer audio clip
          return;
        }
        throw err;
      }
    },
    [stopSpeaking]
  );

  const speakWithGemini = useCallback(
    async (text: string): Promise<string | null> => {
      if (!text.trim()) return null;
      stopSpeaking();
      const requestId = speakRequestIdRef.current;

      try {
        setIsSpeaking(true);
        onSpeakingChangeRef.current?.(true);

        const data = await postJson<{ audioBase64?: string }>("/api/orbi/tts", {
          text,
          voice,
        });
        if (speakRequestIdRef.current !== requestId) {
          return null;
        }
        if (!data.audioBase64) {
          throw new Error("Falha na voz do Gemini.");
        }

        await playWavBase64(data.audioBase64);
        return data.audioBase64 as string;
      } catch (err) {
        if (speakRequestIdRef.current === requestId) {
          setIsSpeaking(false);
          onSpeakingChangeRef.current?.(false);
          onErrorRef.current?.(
            err instanceof Error
              ? err.message
              : "Erro ao reproduzir voz masculina do Gemini."
          );
        }
        return null;
      }
    },
    [playWavBase64, stopSpeaking, voice]
  );

  useEffect(() => {
    return () => {
      stopListening();
      stopSpeaking();
    };
  }, [stopListening, stopSpeaking]);

  return {
    isListening,
    isSpeaking,
    liveTranscript,
    setLiveTranscript,
    audioLevel,
    startListening,
    stopListening,
    speakWithGemini,
    playWavBase64,
    stopSpeaking,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = String(reader.result || "");
      const idx = res.indexOf(",");
      resolve(idx >= 0 ? res.slice(idx + 1) : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
