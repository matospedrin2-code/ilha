import React, { useEffect, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import { IndexedFile } from "../types/orbi";
import { formatBytes, readIndexedFile } from "../utils/localFiles";

interface FilePreviewModalProps {
  file: IndexedFile | null;
  onClose: () => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  onClose,
}) => {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file) {
      setTextContent(null);
      setObjectUrl(null);
      setError(null);
      return;
    }

    let revokedUrl: string | null = null;
    let active = true;
    setLoading(true);
    setError(null);
    setTextContent(null);
    setObjectUrl(null);

    (async () => {
      try {
        const realFile = await readIndexedFile(file);
        if (!active) return;

        const isText =
          realFile.type.startsWith("text/") ||
          /\.(txt|md|json|ts|tsx|js|jsx|py|pyw|css|html|csv|log|bat|ini|xml|yaml|yml)$/i.test(
            realFile.name
          );

        if (isText && realFile.size <= 1024 * 512) {
          const text = await realFile.text();
          if (active) setTextContent(text);
        } else {
          const url = URL.createObjectURL(realFile);
          revokedUrl = url;
          if (active) setObjectUrl(url);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível abrir o arquivo."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [file]);

  if (!file) return null;

  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Visualizador de arquivo: ${file.name}`}
    >
      <div className="w-full max-w-3xl rounded-2xl bg-[#0E121B] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-5 h-5 text-[#00D2FF] shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">
                {file.name}
              </h3>
              <p className="text-xs text-slate-400 font-mono truncate">
                {file.path} · {formatBytes(file.size)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {objectUrl && (
              <a
                href={objectUrl}
                download={file.name}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00D2FF] text-[#030508] text-xs font-semibold hover:bg-[#33DCFF] transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Baixar / Abrir Externo
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Fechar visualizador"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-auto flex-1 bg-[#080A0F]">
          {loading && (
            <div className="text-sm text-slate-400 py-10 text-center">
              Carregando conteúdo do arquivo...
            </div>
          )}
          {error && (
            <div className="text-sm text-rose-400 py-8 text-center">
              {error}
            </div>
          )}
          {!loading && !error && textContent !== null && (
            <pre className="text-xs leading-relaxed text-slate-200 font-mono whitespace-pre-wrap break-words">
              {textContent || "(Arquivo vazio)"}
            </pre>
          )}
          {!loading && !error && objectUrl && isImage && (
            <div className="flex justify-center">
              <img
                src={objectUrl}
                alt={file.name}
                className="max-h-[65vh] rounded-lg border border-white/10 object-contain"
              />
            </div>
          )}
          {!loading && !error && objectUrl && isPdf && (
            <iframe
              src={objectUrl}
              title={file.name}
              className="w-full h-[65vh] rounded-lg border border-white/10 bg-white"
            />
          )}
          {!loading && !error && objectUrl && !isImage && !isPdf && (
            <div className="text-center py-10 space-y-3">
              <p className="text-sm text-slate-300">
                Arquivo pronto para abertura ou download no seu aplicativo padrão do Windows.
              </p>
              <a
                href={objectUrl}
                download={file.name}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00D2FF] text-[#030508] text-xs font-semibold hover:bg-[#33DCFF] transition-colors"
              >
                <Download className="w-4 h-4" /> Abrir {file.name}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
