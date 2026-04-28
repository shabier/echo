import { useEffect, useRef, useState, useCallback } from "react";

export interface AudioPlayerState {
  playing: boolean;
  currentTime: number;
  duration: number;
  toggle: () => void;
  seek: (t: number) => void;
}

/** Wraps an HTMLAudioElement with rAF-driven currentTime for smooth playhead updates. */
export function useAudioPlayer(url: string | null): AudioPlayerState {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!url) {
      setCurrentTime(0);
      setDuration(0);
      setPlaying(false);
      return;
    }
    const audio = new Audio(url);
    audio.preload = "metadata";
    audioRef.current = audio;
    if (typeof window !== "undefined") (window as unknown as { __echoAudio?: HTMLAudioElement }).__echoAudio = audio;

    const onLoaded = () => setDuration(audio.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      audioRef.current = null;
    };
  }, [url]);

  // rAF tracking for smooth playhead while playing
  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      const a = audioRef.current;
      if (a) setCurrentTime(a.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play(); else a.pause();
  }, []);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (!a) return;
    const clamped = Math.max(0, Math.min(a.duration || 0, t));
    a.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  return { playing, currentTime, duration, toggle, seek };
}
