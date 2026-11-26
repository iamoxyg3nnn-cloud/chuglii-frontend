import { useCallback, useEffect, useRef, useState, type IframeHTMLAttributes } from "react";
import { ArrowClockwise, WarningCircle, ArrowRight } from "@phosphor-icons/react";

interface PlayerFrameProps {
  src: string;
  title?: string;
  poster?: string;
  resetKey?: string | number;
  referrerPolicy?: IframeHTMLAttributes<HTMLIFrameElement>["referrerPolicy"];
  sandbox?: string;
  allow?: string;
  onRetry?: () => void;
  onNextSource?: () => void;
  onPlaying?: () => void;
  onEnded?: () => void;
  className?: string;
}

type PlayerMessage = {
  source?: string;
  type?: string;
  detail?: { code?: string; message?: string } | string;
};

function messageText(detail: PlayerMessage["detail"]): string | undefined {
  if (typeof detail === "string") return detail;
  return detail?.message;
}

/**
 * iframe host with a hardened postMessage bridge for the edge player.
 * Worker-generated players report errors/playback state; raw third-party
 * embeds are left alone but still get explicit retry controls.
 */
export function PlayerFrame({
  src,
  title,
  poster,
  resetKey,
  referrerPolicy = "no-referrer",
  sandbox,
  allow = "autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; accelerometer *; gyroscope *",
  onRetry,
  onNextSource,
  onPlaying,
  onEnded,
  className = "",
}: PlayerFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const errorTimerRef = useRef<number | null>(null);
  const callbacks = useRef({ onPlaying, onEnded });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState("This source could not start playback.");

  useEffect(() => {
    callbacks.current = { onPlaying, onEnded };
  }, [onPlaying, onEnded]);

  useEffect(() => {
    if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = null;
    setFailed(false);
    setReloadNonce(0);
  }, [src, resetKey]);

  useEffect(() => {
    const clearErrorTimer = () => {
      if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as PlayerMessage | null;
      if (!data || data.source !== "chuglii-player") return;

      if (data.type === "player:error") {
        // Worker players can recover from transient media errors internally.
        // Only show the blocking overlay if playback has not resumed shortly.
        clearErrorTimer();
        const detail = messageText(data.detail) || "This source could not start playback.";
        errorTimerRef.current = window.setTimeout(() => {
          errorTimerRef.current = null;
          setErrorMessage(detail);
          setFailed(true);
        }, 1200);
      } else if (data.type === "player:playing") {
        clearErrorTimer();
        setFailed(false);
        callbacks.current.onPlaying?.();
      } else if (data.type === "player:ended") {
        clearErrorTimer();
        callbacks.current.onEnded?.();
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearErrorTimer();
    };
  }, []);

  useEffect(() => {
    if (failed) retryRef.current?.focus();
  }, [failed]);

  const retry = useCallback(() => {
    if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = null;
    setFailed(false);
    setReloadNonce((value) => value + 1);
    onRetry?.();
  }, [onRetry]);

  const nextSource = useCallback(() => {
    if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = null;
    setFailed(false);
    if (onNextSource) {
      setReloadNonce((value) => value + 1);
      onNextSource();
      return;
    }
    retry();
  }, [onNextSource, retry]);

  return (
    <div className={`relative w-full h-full ${className}`}>
      <iframe
        ref={iframeRef}
        key={`${src}-${resetKey ?? ""}-${reloadNonce}`}
        src={src}
        title={title || "Video player"}
        referrerPolicy={referrerPolicy}
        sandbox={sandbox}
        allow={allow}
        allowFullScreen
        className="w-full h-full border-none bg-black"
      />

      {failed && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-6 text-center bg-black/85 backdrop-blur-sm" role="alert">
          {poster && (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-15 blur-xl scale-105 pointer-events-none"
              style={{ backgroundImage: `url(${poster})` }}
            />
          )}
          <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
            <WarningCircle size={26} weight="bold" />
          </div>
          <div className="relative max-w-sm">
            <p className="text-sm font-semibold text-white">This source is unavailable</p>
            <p className="mt-1 text-xs text-white/65">{errorMessage}</p>
          </div>
          <div className="relative mt-1 flex flex-wrap items-center justify-center gap-2">
            <button
              ref={retryRef}
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
              <ArrowClockwise size={14} weight="bold" /> Retry player
            </button>
            {onNextSource && (
              <button
                type="button"
                onClick={nextSource}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <ArrowRight size={14} weight="bold" /> Try next mirror
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
