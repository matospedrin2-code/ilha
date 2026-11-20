import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import {
  GoogleGenAI,
  FunctionDeclaration,
  Type,
  ThinkingLevel,
  Part,
} from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const GEMINI_MALE_VOICES = new Set(["Charon", "Fenrir", "Puck"]);

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY não configurada no servidor. Configure a chave em Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
      retryOptions: {
        attempts: 1,
      },
    },
  });
}

const searchLocalFilesDecl: FunctionDeclaration = {
  name: "search_local_files",
  description:
    "Busca silenciosamente um arquivo ou pasta específica dentro das pastas locais autorizadas no computador do usuário, sem abrir nenhuma aba ou explorador.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          "Nome, parte do nome, extensão ou palavra-chave do arquivo a procurar.",
      },
      folderHint: {
        type: Type.STRING,
        description:
          "Nome da pasta específica mencionada pelo usuário (ex: Documentos, Downloads, Projetos), se houver.",
      },
    },
    required: ["query"],
  },
};

const openWebTabDecl: FunctionDeclaration = {
  name: "open_web_tab",
  description:
    "Abre uma nova aba no navegador ou aplicativo de mídia (YouTube, Spotify, Google ou site específico), já na pesquisa solicitada ou pronto para tocar/dar play.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      platform: {
        type: Type.STRING,
        description:
          "Plataforma alvo: 'youtube', 'spotify', 'google' ou 'custom'.",
      },
      query: {
        type: Type.STRING,
        description:
          "Termo de busca ou nome da música/vídeo/artista/assunto (opcional se for apenas abrir a página inicial ou custom url).",
      },
      autoplay: {
        type: Type.BOOLEAN,
        description:
          "true se o usuário pediu para tocar, colocar música ou dar o play imediatamente; false se pediu apenas para abrir na busca.",
      },
      url: {
        type: Type.STRING,
        description:
          "URL completa começando com https:// quando platform for 'custom'.",
      },
      title: {
        type: Type.STRING,
        description: "Nome amigável da aba ou mídia sendo aberta.",
      },
    },
    required: ["platform", "title"],
  },
};

const requestScreenCaptureDecl: FunctionDeclaration = {
  name: "request_screen_capture",
  description:
    "Solicita a leitura/captura da tela atual do computador para responder perguntas sobre o que está aparecendo na tela.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      question: {
        type: Type.STRING,
        description: "O que o usuário perguntou ou pediu para ler na tela.",
      },
    },
    required: ["question"],
  },
};

const handlePendingFileAuthDecl: FunctionDeclaration = {
  name: "handle_pending_file_authorization",
  description:
    "Executa a decisão do usuário sobre abrir, aguardar ou cancelar um arquivo encontrado que estava aguardando autorização.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      decision: {
        type: Type.STRING,
        description:
          "Decisão do usuário: 'open' (se falou sim/quero/pode abrir), 'wait' (se pediu para aguardar/esperar), ou 'cancel' (se falou não/não quero/cancelar).",
      },
    },
    required: ["decision"],
  },
};

const ORBI_SYSTEM_INSTRUCTION = `Você é o Orbi Dynamic, um assistente virtual de ilha dinâmica para Windows, leve, inteligente, prestativo e com personalidade amigável e precisa.
Você possui dois olhinhos digitais azul-ciano que acompanham o mouse e reagem às ações do usuário.

Regras essenciais de comportamento:
1. Idioma: Responda sempre em Português do Brasil claro, natural e direto (suas respostas serão faladas em voz alta pela voz masculina do Gemini, portanto evite formatações pesadas como tabelas markdown ou listas longas demais; seja conciso e informativo).
2. Busca e Conhecimento na Web: Para qualquer pergunta informativa ("o que é...", "quais as novidades...", "pesquise sobre...", "quanto está..."), responda diretamente falando o resumo da resposta com base no seu conhecimento e na ferramenta googleSearch quando disponível. NÃO chame open_web_tab para perguntas normais.
3. Leitura de Tela: Se o usuário perguntar sobre algo que está na tela ("o que tem na tela?", "leia isso", "resolva esse erro na minha tela") e nenhuma imagem da tela foi enviada nesta mensagem, chame imediatamente a função request_screen_capture. Se uma imagem da tela já veio anexada, leia e responda com precisão sobre o conteúdo visível.
4. Abrir Abas, YouTube e Spotify: Chame open_web_tab quando o usuário pedir para abrir um site/aba, abrir o Spotify ou YouTube (com ou sem pesquisa), ou tocar uma música/vídeo ("abre o YouTube", "abre o YouTube pesquisando lofi", "abre o Spotify com Linkin Park", "toca Daft Punk no YouTube", "dá o play em..."). Preencha platform ('youtube' | 'spotify' | 'google' | 'custom'), query (se houver pesquisa ou música) e autoplay=true se ele pedir para tocar/dar play.
5. Busca Silenciosa em Pastas Locais: Se o usuário pedir para procurar um arquivo em uma pasta específica ou no computador, chame search_local_files. NUNCA diga que abriu o arquivo automaticamente! Quando o resultado da busca voltar, informe se encontrou ou não e peça autorização explícita ("Encontrei o arquivo X na pasta Y. Quer que eu abra agora ou prefere que eu aguarde?").
6. Autorização de Arquivo Pendente: Se houver um arquivo aguardando autorização no contexto e o usuário responder "sim", "quero", "pode abrir", "não", "não quero", "aguarda", "espera", chame handle_pending_file_authorization com 'open', 'cancel' ou 'wait'.`;

interface ChatMessageInput {
  role: "user" | "model";
  text: string;
}

interface GroundingSource {
  title: string;
  uri: string;
}

function extractErrorStatus(err: unknown): number {
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") return status;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) return 429;
  if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) return 403;
  if (msg.includes("400") || msg.includes("API_KEY_INVALID")) return 400;
  if (msg.includes("404") || msg.includes("NOT_FOUND")) return 404;
  return 500;
}

function formatGeminiError(err: unknown, fallbackMsg: string): { status: number; message: string } {
  const status = extractErrorStatus(err);
  if (status === 429) {
    return {
      status: 429,
      message:
        "Limite de cota gratuita da API Gemini atingido (erro 429). Aguarde alguns instantes para tentar novamente ou selecione uma chave com faturamento ativo no painel Settings > Secrets.",
    };
  }
  if (status === 403 || status === 400) {
    const raw = err instanceof Error ? err.message : "";
    if (raw.includes("API_KEY") || raw.includes("PERMISSION_DENIED")) {
      return {
        status,
        message:
          "Chave da API Gemini inválida ou sem permissão. Verifique sua chave no painel Settings > Secrets.",
      };
    }
  }
  return {
    status,
    message: err instanceof Error ? err.message : fallbackMsg,
  };
}

async function generateWithRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = extractErrorStatus(err);
      // Never tight-loop retry 4xx or 429 quota errors
      if (status >= 400 && status < 500) {
        throw err;
      }
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 450 * (i + 1)));
      }
    }
  }
  throw lastError;
}

async function resolveTopYouTubeVideoId(query: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3200);
    const resp = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      }
    );
    clearTimeout(timer);
    if (!resp.ok) return null;
    const html = await resp.text();
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function resolveMediaTabAction(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const rawPlatform = String(args.platform || "").toLowerCase().trim();
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const autoplay = Boolean(args.autoplay);
  const rawUrl = typeof args.url === "string" ? args.url.trim() : "";
  const title =
    typeof args.title === "string" && args.title.trim()
      ? args.title.trim()
      : query || "Nova Aba";

  let platform = rawPlatform;
  if (!platform) {
    if (rawUrl.includes("youtube.com") || rawUrl.includes("youtu.be")) {
      platform = "youtube";
    } else if (rawUrl.includes("spotify.com")) {
      platform = "spotify";
    } else if (rawUrl.includes("google.com")) {
      platform = "google";
    } else {
      platform = "custom";
    }
  }

  if (platform === "youtube") {
    if (!query && rawUrl) {
      return {
        ...args,
        platform: "youtube",
        title,
        url: rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`,
      };
    }
    const searchUrl = query
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      : "https://www.youtube.com/";

    let videoId: string | null = null;
    if (query) {
      videoId = await resolveTopYouTubeVideoId(query);
    }

    const resolvedUrl =
      autoplay && videoId
        ? `https://www.youtube.com/watch?v=${videoId}&autoplay=1`
        : searchUrl;

    return {
      ...args,
      platform: "youtube",
      query,
      autoplay,
      title,
      url: resolvedUrl,
      searchUrl,
      videoId: videoId ?? undefined,
      embedUrl: videoId
        ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&enablejsapi=1`
        : undefined,
    };
  }

  if (platform === "spotify") {
    const webUrl = query
      ? `https://open.spotify.com/search/${encodeURIComponent(query)}`
      : rawUrl && rawUrl.startsWith("http")
      ? rawUrl
      : "https://open.spotify.com/";
    const spotifyUri = query
      ? `spotify:search:${encodeURIComponent(query)}`
      : "spotify:";

    return {
      ...args,
      platform: "spotify",
      query,
      autoplay,
      title,
      url: webUrl,
      spotifyUri,
    };
  }

  if (platform === "google") {
    const url = query
      ? `https://www.google.com/search?q=${encodeURIComponent(query)}`
      : rawUrl && rawUrl.startsWith("http")
      ? rawUrl
      : "https://www.google.com/";
    return {
      ...args,
      platform: "google",
      query,
      title,
      url,
    };
  }

  const safeCustomUrl = rawUrl
    ? rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
      ? rawUrl
      : `https://${rawUrl}`
    : query
    ? `https://www.google.com/search?q=${encodeURIComponent(query)}`
    : "https://www.google.com/";

  return {
    ...args,
    platform: "custom",
    title,
    url: safeCustomUrl,
  };
}

function buildWindowsPythonScript(serverOrigin: string): string {
  return `"""
Orbi Dynamic - Ilha Dinamica Ultra-Leve para Windows
Consumo minimo de RAM/CPU para rodar do PC mais fraco ao mais forte.
Requer Python 3.9+ e pacotes leves: pip install pillow requests
"""
import base64
import ctypes
import io
import os
import threading
import tkinter as tk
from tkinter import messagebox
import webbrowser

try:
    import winsound
except ImportError:
    winsound = None

try:
    import requests
    from PIL import ImageGrab
except ImportError as exc:
    root_err = tk.Tk()
    root_err.withdraw()
    messagebox.showerror(
        "Orbi Dynamic - Dependencia faltando",
        f"Instale as bibliotecas antes de abrir:\\n\\npy -m pip install pillow requests\\n\\nDetalhe: {exc}",
    )
    raise SystemExit(1)

SERVER_URL = "${serverOrigin}"
VOICE_NAME = "Charon"


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


def get_cursor_pos():
    pt = POINT()
    ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
    return pt.x, pt.y


class OrbiDynamicWindow:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Orbi Dynamic")
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.configure(bg="#030508")

        self.screen_w = self.root.winfo_screenwidth()
        self.screen_h = self.root.winfo_screenheight()
        self.width = 210
        self.height = 52
        self.x = (self.screen_w - self.width) // 2
        self.y = 8
        self.root.geometry(f"{self.width}x{self.height}+{self.x}+{self.y}")

        self.canvas = tk.Canvas(
            self.root,
            width=self.width,
            height=self.height,
            bg="#030508",
            highlightthickness=1,
            highlightbackground="#1E293B",
        )
        self.canvas.pack(fill="both", expand=True)

        # Dois olhinhos estilo OLED ciano (#00D2FF)
        self.eye_l = self.canvas.create_rectangle(74, 14, 98, 38, fill="#00D2FF", outline="")
        self.eye_r = self.canvas.create_rectangle(112, 14, 136, 38, fill="#00D2FF", outline="")

        self.canvas.bind("<Button-1>", self.on_island_click)
        self.canvas.bind("<Button-3>", self.on_right_click)
        self.history = []
        self.pending_file = None
        self.dialog = None
        self.status_var = tk.StringVar(value="")
        self.update_eyes_loop()

    def on_right_click(self, event):
        menu = tk.Menu(self.root, tearoff=0, bg="#0B0F17", fg="#F8FAFC")
        menu.add_command(label="Perguntar ao Orbi", command=lambda: self.on_island_click(event))
        menu.add_separator()
        menu.add_command(label="Fechar Orbi", command=self.root.destroy)
        menu.tk_popup(event.x_root, event.y_root)

    def update_eyes_loop(self):
        mx, my = get_cursor_pos()
        cx = self.x + self.width // 2
        cy = self.y + self.height // 2
        dx = max(-10, min(10, (mx - cx) / 55.0))
        dy = max(-6, min(6, (my - cy) / 65.0))

        self.canvas.coords(self.eye_l, 74 + dx, 14 + dy, 98 + dx, 38 + dy)
        self.canvas.coords(self.eye_r, 112 + dx, 14 + dy, 136 + dx, 38 + dy)
        self.root.after(33, self.update_eyes_loop)

    def on_island_click(self, _event=None):
        if self.dialog is not None and self.dialog.winfo_exists():
            self.dialog.lift()
            return

        dialog = tk.Toplevel(self.root)
        self.dialog = dialog
        dialog.title("Orbi Dynamic")
        dialog.attributes("-topmost", True)
        dialog.configure(bg="#0B0F17")
        dialog.geometry(f"440x165+{(self.screen_w - 440) // 2}+70")

        entry = tk.Entry(
            dialog,
            bg="#151B26",
            fg="#F8FAFC",
            insertbackground="#00D2FF",
            font=("Segoe UI", 11),
            relief="flat",
        )
        entry.pack(fill="x", padx=14, pady=(14, 8), ipady=6)
        entry.focus_set()

        status_lbl = tk.Label(
            dialog,
            textvariable=self.status_var,
            bg="#0B0F17",
            fg="#94A3B8",
            font=("Segoe UI", 9),
            wraplength=410,
            justify="left",
        )
        status_lbl.pack(fill="x", padx=14, pady=(0, 8))

        def submit(_e=None):
            prompt = entry.get().strip()
            if not prompt:
                return
            entry.delete(0, tk.END)
            self.status_var.set("Pensando com Gemini...")
            threading.Thread(target=self.ask_orbi, args=(prompt,), daemon=True).start()

        entry.bind("<Return>", submit)
        btns = tk.Frame(dialog, bg="#0B0F17")
        btns.pack(fill="x", padx=14, pady=(0, 10))
        tk.Button(
            btns,
            text="Enviar ao Orbi",
            command=submit,
            bg="#00D2FF",
            fg="#030508",
            font=("Segoe UI", 9, "bold"),
            relief="flat",
            padx=12,
            pady=4,
        ).pack(side="left")
        tk.Button(
            btns,
            text="Fechar Ilha",
            command=self.root.destroy,
            bg="#1E293B",
            fg="#E2E8F0",
            font=("Segoe UI", 9),
            relief="flat",
            padx=10,
            pady=4,
        ).pack(side="right")

    def capture_screen_b64(self):
        img = ImageGrab.grab()
        img.thumbnail((1280, 720))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70)
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    def set_status_safe(self, text):
        self.root.after(0, lambda: self.status_var.set(text))

    def ask_orbi(self, prompt):
        try:
            needs_screen = any(k in prompt.lower() for k in ["tela", "screen", "leia", "vendo"])
            screen_b64 = self.capture_screen_b64() if needs_screen else None
            r = requests.post(
                f"{SERVER_URL}/api/orbi/chat",
                json={
                    "message": prompt,
                    "history": self.history[-6:],
                    "screenImageBase64": screen_b64,
                },
                timeout=30,
            )
            ctype = r.headers.get("content-type", "")
            if "application/json" not in ctype:
                self.set_status_safe(
                    "Servidor de preview protegido por login Google. Use o Orbi no navegador ou no link compartilhado/publicado."
                )
                return

            resp = r.json()
            if not r.ok:
                self.set_status_safe(resp.get("error", f"Erro HTTP {r.status_code}"))
                return

            reply = resp.get("reply", "")
            for act in resp.get("actions", []):
                if act.get("name") == "open_web_tab":
                    target = act.get("args", {}).get("spotifyUri") or act.get("args", {}).get("url")
                    if target:
                        webbrowser.open(target)
                elif act.get("name") == "search_local_files":
                    q = str(act.get("args", {}).get("query", "")).lower()
                    found = []
                    docs_dir = os.path.join(os.path.expanduser("~"), "Documents")
                    for root_dir, _dirs, files in os.walk(docs_dir):
                        for f in files:
                            if q in f.lower():
                                found.append(os.path.join(root_dir, f))
                                if len(found) >= 3:
                                    break
                        if len(found) >= 3:
                            break
                    if found:
                        self.pending_file = found[0]
                        reply = f"Encontrei {os.path.basename(found[0])}. Deseja abrir?"

            if reply:
                self.history.append({"role": "user", "text": prompt})
                self.history.append({"role": "model", "text": reply})
                self.set_status_safe(reply)

                tts_r = requests.post(
                    f"{SERVER_URL}/api/orbi/tts",
                    json={"text": reply, "voice": VOICE_NAME},
                    timeout=30,
                )
                if tts_r.ok and "application/json" in tts_r.headers.get("content-type", ""):
                    tts = tts_r.json()
                    if tts.get("audioBase64") and winsound is not None:
                        wav_bytes = base64.b64decode(tts["audioBase64"])
                        winsound.PlaySound(wav_bytes, winsound.SND_MEMORY)
        except Exception as exc:
            self.set_status_safe(f"Erro ao conectar: {exc}")

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    OrbiDynamicWindow().run()
`;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: "15mb" }));

  // Health endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "orbi-dynamic" });
  });

  // Chat + Vision + Search Grounding + Function Calling
  app.post("/api/orbi/chat", async (req, res) => {
    try {
      const {
        message,
        history = [],
        screenImageBase64,
        indexedFolderNames = [],
        pendingAuthFile = null,
        toolFollowUp = null,
      } = req.body as {
        message: string;
        history?: ChatMessageInput[];
        screenImageBase64?: string | null;
        indexedFolderNames?: string[];
        pendingAuthFile?: { name: string; path: string; folder: string } | null;
        toolFollowUp?: {
          callId?: string;
          name: string;
          result: Record<string, unknown>;
        } | null;
      };

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Mensagem vazia." });
      }

      const ai = getGeminiClient();

      const contextParts: string[] = [];
      if (indexedFolderNames.length > 0) {
        contextParts.push(
          `[Pastas locais autorizadas disponíveis para busca silenciosa: ${indexedFolderNames.join(", ")}]`
        );
      } else {
        contextParts.push(
          `[Nenhuma pasta local foi autorizada ainda. Se o usuário pedir busca em pastas locais, chame search_local_files normalmente e o sistema solicitará ou avisará.]`
        );
      }

      if (pendingAuthFile) {
        contextParts.push(
          `[Arquivo encontrado aguardando autorização do usuário: "${pendingAuthFile.name}" na pasta "${pendingAuthFile.folder}" (caminho: ${pendingAuthFile.path}). Se o usuário responder sim/quero/abrir, não/cancelar, ou aguarda/espera, chame handle_pending_file_authorization.]`
        );
      }

      const contents: Array<{ role: "user" | "model"; parts: Part[] }> = [];

      for (const h of history.slice(-8)) {
        contents.push({
          role: h.role === "model" ? "model" : "user",
          parts: [{ text: h.text }],
        });
      }

      const userParts: Part[] = [];
      if (screenImageBase64) {
        const cleanB64 = screenImageBase64.replace(
          /^data:image\/[a-zA-Z0-9+.-]+;base64,/,
          ""
        );
        userParts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: cleanB64,
          },
        });
      }

      const finalUserText =
        contextParts.length > 0
          ? `${contextParts.join("\n")}\n\nUsuário: ${message}`
          : message;
      userParts.push({ text: finalUserText });

      contents.push({ role: "user", parts: userParts });

      // If client executed a local tool (e.g. search_local_files) and sent toolFollowUp,
      // give Gemini the explicit search outcome cleanly to craft the authorization question.
      if (toolFollowUp) {
        contents.push({
          role: "model",
          parts: [
            {
              text: `Executei a ação ${toolFollowUp.name}.`,
            },
          ],
        });
        contents.push({
          role: "user",
          parts: [
            {
              text: `[Resultado da ferramenta ${toolFollowUp.name}]: ${JSON.stringify(
                toolFollowUp.result
              )}. Com base exatamente neste resultado, responda ao usuário em português. Se um ou mais arquivos foram encontrados, informe o nome e a pasta e peça autorização explícita se ele quer abrir o arquivo agora ou se prefere aguardar.`,
            },
          ],
        });
      }

      const wantsWebSearch =
        !toolFollowUp &&
        !screenImageBase64 &&
        !pendingAuthFile &&
        !/^(oi|olá|ola|bom dia|boa tarde|boa noite|tudo bem|sim|não|nao|aguarda|espera|pode abrir)[!?. ]*$/i.test(
          message.trim()
        ) &&
        !/\b(abre|abra|abrir|toca|toque|coloca|dar play|dá o play|da o play|youtube|spotify|procure|procura|busca arquivo|na pasta|na minha tela|lê a tela|leia a tela)\b/i.test(
          message
        );

      const functionTools = {
        functionDeclarations: [
          searchLocalFilesDecl,
          openWebTabDecl,
          requestScreenCaptureDecl,
          handlePendingFileAuthDecl,
        ],
      };

      const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
        new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`${label} timeout after ${ms}ms`));
          }, ms);
          promise.then(
            (val) => {
              clearTimeout(timer);
              resolve(val);
            },
            (err) => {
              clearTimeout(timer);
              reject(err);
            }
          );
        });

      const callModel = async (
        modelName: string,
        useSearch: boolean,
        thinkingLevel: ThinkingLevel,
        timeoutMs = 18000
      ) => {
        const activeTools = useSearch
          ? [{ googleSearch: {} }, functionTools]
          : [functionTools];

        return withTimeout(
          generateWithRetry(() =>
            ai.models.generateContent({
              model: modelName,
              contents,
              config: {
                systemInstruction: ORBI_SYSTEM_INSTRUCTION,
                thinkingConfig: { thinkingLevel },
                tools: activeTools,
                ...(useSearch
                  ? { toolConfig: { includeServerSideToolInvocations: true } }
                  : {}),
              },
            })
          ),
          timeoutMs,
          modelName
        );
      };

      let response;
      try {
        // Primary: free-tier Gemini 4 Hydrogen (with Google Search only when needed)
        response = await callModel("gemini-4-hydrogen", wantsWebSearch, ThinkingLevel.LOW, 16000);
      } catch (primaryErr) {
        const status = extractErrorStatus(primaryErr);
        const isTimeout = primaryErr instanceof Error && primaryErr.message.includes("timeout");
        if (status !== 429 && !isTimeout) {
          throw primaryErr;
        }
        try {
          // Fallback 1: Gemini 3.1 Flash Lite (fast, highest free-tier quota)
          response = await callModel("gemini-3.1-flash-lite", false, ThinkingLevel.MINIMAL, 14000);
        } catch (fallbackErr) {
          if (wantsWebSearch && extractErrorStatus(fallbackErr) !== 429) {
            throw fallbackErr;
          }
          // Fallback 2: Gemini 4 Hydrogen without search grounding
          response = await callModel("gemini-4-hydrogen", false, ThinkingLevel.LOW, 14000);
        }
      }

      const actions: Array<{
        id?: string;
        name: string;
        args: Record<string, unknown>;
      }> = [];

      if (response.functionCalls && response.functionCalls.length > 0) {
        for (const fc of response.functionCalls) {
          if (fc.name) {
            actions.push({
              id: fc.id,
              name: fc.name,
              args: (fc.args as Record<string, unknown>) ?? {},
            });
          }
        }
      }

      const groundingSources: GroundingSource[] = [];
      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (Array.isArray(chunks)) {
        for (const chunk of chunks) {
          if (chunk.web?.uri) {
            groundingSources.push({
              title: chunk.web.title || chunk.web.uri,
              uri: chunk.web.uri,
            });
          }
        }
      }

      // Resolve exact media/search URLs for YouTube, Spotify, Google, or custom tabs
      for (const act of actions) {
        if (act.name === "open_web_tab") {
          act.args = await resolveMediaTabAction(act.args);
        }
      }

      let replyText = (response.text ?? "").trim();

      // Provide clear natural fallback text only when the model strictly emitted a tool call with no prose
      if (!replyText && actions.length > 0) {
        const first = actions[0];
        if (first.name === "open_web_tab") {
          const title = String(first.args.title || "a nova aba");
          const autoplay = Boolean(first.args.autoplay);
          const platform = String(first.args.platform || "custom");
          if (platform === "youtube" && autoplay && first.args.videoId) {
            replyText = title.toLowerCase().includes("youtube")
              ? `Tocando ${title} agora.`
              : `Tocando ${title} no YouTube agora.`;
          } else if (platform === "spotify") {
            replyText = `Abri o Spotify com ${title} pronto para você dar o play.`;
          } else {
            replyText = `Abrindo ${title} para você.`;
          }
        } else if (first.name === "request_screen_capture") {
          replyText = "Vou ler o que está na sua tela agora.";
        } else if (first.name === "search_local_files") {
          replyText = `Procurando "${String(first.args.query || "arquivo")}" silenciosamente nas suas pastas.`;
        } else if (first.name === "handle_pending_file_authorization") {
          const d = String(first.args.decision);
          replyText =
            d === "open"
              ? "Autorizado! Abrindo o arquivo agora."
              : d === "wait"
              ? "Tudo bem, deixei o arquivo em espera. É só me avisar quando quiser abrir."
              : "Certo, não vou abrir o arquivo.";
        }
      }

      res.json({
        reply: replyText,
        actions,
        groundingSources,
      });
    } catch (err: unknown) {
      const formatted = formatGeminiError(
        err,
        "Erro ao processar resposta no Gemini."
      );
      console.warn(`Orbi chat failed (${formatted.status}):`, formatted.message);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  const ttsCache = new Map<string, string>();
  const MAX_TTS_CACHE = 40;

  // Official Gemini Male TTS Endpoint
  app.post("/api/orbi/tts", async (req, res) => {
    try {
      const { text, voice = "Charon" } = req.body as {
        text: string;
        voice?: string;
      };

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Texto para voz vazio." });
      }

      const selectedVoice = GEMINI_MALE_VOICES.has(voice) ? voice : "Charon";

      // Keep speech clean from raw markdown links/symbols
      const cleanSpeechText = text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[*_`#]/g, "")
        .trim()
        .slice(0, 1200);

      if (!cleanSpeechText) {
        return res.status(400).json({ error: "Texto para voz vazio." });
      }

      const cacheKey = `${selectedVoice}::${cleanSpeechText}`;
      const cachedAudio = ttsCache.get(cacheKey);
      if (cachedAudio) {
        return res.json({
          audioBase64: cachedAudio,
          mimeType: "audio/wav",
          voiceName: selectedVoice,
          cached: true,
        });
      }

      const ai = getGeminiClient();

      const callTtsModel = (modelName: string) =>
        ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: "user",
              parts: [{ text: cleanSpeechText }],
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: selectedVoice },
              },
            },
          },
        });

      let response;
      try {
        response = await generateWithRetry(() =>
          callTtsModel("gemini-3.8-flash-lite-tts")
        );
      } catch (primaryErr) {
        if (extractErrorStatus(primaryErr) !== 429) {
          throw primaryErr;
        }
        // Fallback to separate TTS quota bucket on 429
        await new Promise((r) => setTimeout(r, 400));
        response = await callTtsModel("gemini-3.8-flash-tts");
      }

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        return res
          .status(502)
          .json({ error: "Gemini TTS não retornou áudio válido." });
      }

      if (ttsCache.size >= MAX_TTS_CACHE) {
        const oldestKey = ttsCache.keys().next().value;
        if (oldestKey) ttsCache.delete(oldestKey);
      }
      ttsCache.set(cacheKey, base64Audio);

      res.json({
        audioBase64: base64Audio,
        mimeType: "audio/wav",
        voiceName: selectedVoice,
      });
    } catch (err: unknown) {
      const formatted = formatGeminiError(err, "Erro ao gerar voz do Gemini.");
      console.warn(`Orbi TTS failed (${formatted.status}):`, formatted.message);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Audio transcription fallback for browsers without Web Speech API
  app.post("/api/orbi/transcribe", async (req, res) => {
    try {
      const { audioBase64, mimeType = "audio/webm" } = req.body as {
        audioBase64: string;
        mimeType?: string;
      };

      if (!audioBase64) {
        return res.status(400).json({ error: "Áudio vazio." });
      }

      const ai = getGeminiClient();
      const response = await generateWithRetry(() =>
        ai.models.generateContent({
          model: "gemini-3.5-transcribe",
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: audioBase64,
                },
              },
              {
                text: "Transcreva exatamente o que foi falado em Português do Brasil. Retorne apenas a transcrição.",
              },
            ],
          },
        })
      );

      res.json({ text: (response.text ?? "").trim() });
    } catch (err: unknown) {
      const formatted = formatGeminiError(err, "Erro ao transcrever áudio.");
      console.warn(`Orbi transcribe failed (${formatted.status}):`, formatted.message);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Downloadable ultra-lightweight Windows desktop companion script
  app.get("/api/orbi/windows-script", (req, res) => {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const serverOrigin =
      process.env.APP_URL && process.env.APP_URL !== "MY_APP_URL"
        ? process.env.APP_URL.replace(/\/$/, "")
        : `${protocol}://${host}`;

    const script = buildWindowsPythonScript(serverOrigin);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="orbi_dynamic_windows.pyw"'
    );
    res.send(script);
  });

  app.use("/api", (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = extractErrorStatus(err);
    const msg = err instanceof Error ? err.message : "Erro interno no servidor.";
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === "true" ? false : { server: httpServer },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Orbi Dynamic server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start Orbi Dynamic server:", err);
  process.exit(1);
});
