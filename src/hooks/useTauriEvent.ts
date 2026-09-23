import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/** Subscribe to a backend event for the lifetime of the component. */
export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<T>(event, (e) => ref.current(e.payload)).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [event]);
}
