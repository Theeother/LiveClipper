import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../services/api";
import type { Session } from "../types";
import { useTauriEvent } from "./useTauriEvent";

/** A session kept in sync with backend `session-updated` events. */
export function useSession(id: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .getSession(id)
      .then((s) => {
        setSession(s);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(reload, [reload]);
  useTauriEvent<Session>("session-updated", (s) => {
    if (s.id === id) setSession(s);
  });

  return { session, setSession, error, reload };
}
