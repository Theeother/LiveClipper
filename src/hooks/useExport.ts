import { useCallback, useRef, useState } from "react";
import { api, errorMessage } from "../services/api";
import type { ExportFinishedEvent, ExportPreset, ExportProgressEvent } from "../types";
import { useTauriEvent } from "./useTauriEvent";

export type ExportPhase = "idle" | "starting" | "running" | "done" | "failed" | "cancelled";

export interface ExportState {
  phase: ExportPhase;
  progress: number;
  jobId?: string;
  outputPath?: string;
  error?: string;
  clipStart?: number;
  clipEnd?: number;
}

export interface ExportRequest {
  sessionId: string;
  markerId: string;
  clipStart: number;
  clipEnd: number;
  preset: ExportPreset;
  name?: string;
}

/** Drives one export at a time and tracks its backend progress events. */
export function useExport() {
  const [state, setState] = useState<ExportState>({ phase: "idle", progress: 0 });
  const jobRef = useRef<string | null>(null);
  // A very short (or failing) export can finish before start_export resolves.
  const early = useRef(new Map<string, ExportFinishedEvent>());

  const applyFinished = useCallback((e: ExportFinishedEvent) => {
    setState((s) => ({
      ...s,
      phase: e.outcome === "done" ? "done" : e.outcome === "cancelled" ? "cancelled" : "failed",
      progress: e.outcome === "done" ? 1 : s.progress,
      outputPath: e.outputPath,
      error: e.error ?? undefined,
    }));
  }, []);

  useTauriEvent<ExportProgressEvent>("export-progress", (e) => {
    if (e.jobId === jobRef.current) setState((s) => (s.phase === "running" ? { ...s, progress: e.progress } : s));
  });
  useTauriEvent<ExportFinishedEvent>("export-finished", (e) => {
    if (e.jobId === jobRef.current) applyFinished(e);
    else early.current.set(e.jobId, e);
  });

  const start = useCallback(
    async (req: ExportRequest) => {
      setState({ phase: "starting", progress: 0, clipStart: req.clipStart, clipEnd: req.clipEnd });
      try {
        const started = await api.startExport(req);
        jobRef.current = started.jobId;
        setState({
          phase: "running",
          progress: 0,
          jobId: started.jobId,
          outputPath: started.outputPath,
          clipStart: started.clipStart,
          clipEnd: started.clipEnd,
        });
        const finished = early.current.get(started.jobId);
        if (finished) applyFinished(finished);
      } catch (e) {
        setState((s) => ({ ...s, phase: "failed", error: errorMessage(e) }));
      }
    },
    [applyFinished],
  );

  const cancel = useCallback(() => {
    if (jobRef.current) void api.cancelExport(jobRef.current);
  }, []);

  const reset = useCallback(() => {
    jobRef.current = null;
    setState({ phase: "idle", progress: 0 });
  }, []);

  return { state, start, cancel, reset };
}
