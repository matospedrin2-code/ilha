import React, { useState } from "react";
import { CheckCircle2, Smartphone, X } from "lucide-react";
import { usePWAInstall } from "../hooks/usePWAInstall";

interface PWAInstallButtonProps {
  variant?: "header" | "card";
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = "header",
}) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } =
    usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    if (variant === "card") {
      return (
        <div className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5" />
          App Instalado no Celular
        </div>
      );
    }
    return null;
  }

  const handleClick = () => {
    if (isInstallable) {
      void install();
    } else {
      setShowGuide(true);
    }
  };

  const label =
    variant === "card"
      ? isInstallable
        ? "Instalar App no Poco / Celular"
        : "Como Instalar no Poco X8 Pro"
      : isInstallable
      ? "Instalar no Celular"
      : "App Celular";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          variant === "card"
            ? "w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#00D2FF] hover:bg-[#33DCFF] text-xs font-semibold text-[#030508] transition-colors cursor-pointer"
            : "inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        }
      >
        <Smartphone
          className={`w-3.5 h-3.5 ${
            variant === "card" ? "text-[#030508]" : "text-[#00D2FF]"
          }`}
        />
        {label}
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#0E121B] border border-white/15 p-5 space-y-4 text-left shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {isIOS
                    ? "Instalar Orbi no iPhone / iPad"
                    : "Instalar Orbi no Poco X8 Pro (HyperOS 3)"}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {isIOS
                    ? "Adicione à Tela de Início pelo Safari:"
                    : isAndroid
                    ? "Para rodar em tela cheia e ficar integrado à Ilha Dinâmica:"
                    : "Abra esta página no Chrome do seu Poco X8 Pro para instalar:"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="text-xs text-slate-200 space-y-2 list-decimal list-inside">
                <li>
                  Toque no botão <strong>Compartilhar</strong> na barra do
                  Safari.
                </li>
                <li>
                  Role e toque em <strong>Adicionar à Tela de Início</strong>.
                </li>
                <li>
                  Confirme em <strong>Adicionar</strong>.
                </li>
              </ol>
            ) : (
              <ol className="text-xs text-slate-200 space-y-2 list-decimal list-inside">
                <li>
                  Abra o link compartilhado do Orbi no <strong>Google Chrome</strong>{" "}
                  do Poco X8 Pro (fora da pré-visualização embutida).
                </li>
                <li>
                  Toque nos <strong>3 pontinhos (⋮)</strong> no canto superior
                  direito do Chrome.
                </li>
                <li>
                  Toque em <strong>Instalar aplicativo</strong> ou{" "}
                  <strong>Adicionar à tela inicial</strong>.
                </li>
                <li>
                  Depois de abrir o app instalado, ative o botão{" "}
                  <strong>Manter na Ilha da HyperOS 3</strong> para ele continuar
                  no topo do celular mesmo quando você sair do app.
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors cursor-pointer"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
};
