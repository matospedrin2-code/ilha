function buildFallbackWindowsScript(serverOrigin: string): string {
  return `"""
Orbi Dynamic - Ilha Dinamica Ultra-Leve para Windows
Consumo minimo de RAM/CPU para rodar do PC mais fraco ao mais forte.
Requer Python 3.9+ e pacotes leves: py -m pip install pillow requests
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
                    "Servidor de preview protegido por login Google. Use o Orbi no navegador ou no link compartilhado."
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

export async function downloadWindowsScriptSafely(): Promise<void> {
  let content = "";

  try {
    const res = await fetch("/api/orbi/windows-script", {
      credentials: "include",
    });
    if (res.ok) {
      const text = await res.text();
      const trimmed = text.trimStart();
      if (trimmed && !trimmed.startsWith("<")) {
        content = text;
      }
    }
  } catch {
    // Fallback to client-generated Python script
  }

  if (!content) {
    content = buildFallbackWindowsScript(window.location.origin);
  }

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "orbi_dynamic_windows.pyw";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
