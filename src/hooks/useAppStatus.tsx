// App-wide state shared by the top bar and pages: live session, OBS/FFmpeg/hotkey status, settings.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../services/api";
import type { FfmpegStatus, HotkeyStatus, ObsStatus, Session, Settings } from "../types";
import { useTauriEvent } from "./useTauriEvent";

interface AppStatus {
  live: Session | null;
  obs: ObsStatus | null;
  ffmpeg: FfmpegStatus | null;
  hotkey: HotkeyStatus | null;
  settings: Settings | null;
  refreshFfmpeg: () => void;
  refreshHotkey: () => void;
  setSettings: (s: Settings) => void;
}

const Ctx = createContext<AppStatus | null>(null);

export function AppStatusProvider({ children }: { children: ReactNode }) {
  const [live, setLive] = useState<Session | null>(null);
  const [obs, setObs] = useState<ObsStatus | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [hotkey, setHotkey] = useState<HotkeyStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  const refreshFfmpeg = useCallback(() => void api.getFfmpegStatus().then(setFfmpeg), []);
  const refreshHotkey = useCallback(() => void api.getHotkeyStatus().then(setHotkey), []);

  useEffect(() => {
    void api.getLiveSession().then(setLive);
    void api.getObsStatus().then(setObs);
    void api.getSettings().then(setSettings);
    refreshFfmpeg();
    refreshHotkey();
  }, [refreshFfmpeg, refreshHotkey]);

  useTauriEvent<ObsStatus>("obs-status", setObs);
  useTauriEvent<Session>("session-updated", (s) => {
    if (s.status !== "ended") setLive(s);
    else setLive((cur) => (cur?.id === s.id ? null : cur));
  });

  const value = useMemo(
    () => ({ live, obs, ffmpeg, hotkey, settings, refreshFfmpeg, refreshHotkey, setSettings }),
    [live, obs, ffmpeg, hotkey, settings, refreshFfmpeg, refreshHotkey],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppStatus(): AppStatus {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppStatus outside AppStatusProvider");
  return ctx;
}
