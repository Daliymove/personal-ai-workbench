import { useEffect, useMemo, useState } from "react";

function scopeForPath(pathname) {
  if (pathname === "/") return "overview";
  if (pathname.startsWith("/materials")) return "materials";
  if (pathname.startsWith("/wiki")) return "wiki";
  if (pathname.startsWith("/graph")) return "graph";
  if (pathname.startsWith("/topics")) return "topics";
  if (pathname.startsWith("/content")) return "content";
  if (pathname.startsWith("/douyin")) return "douyin";
  if (pathname.startsWith("/social-insights")) return "social_insights";
  if (pathname.startsWith("/system")) return "runtime";
  return "overview";
}

export function useVaultSync(pathname) {
  const scope = useMemo(() => scopeForPath(pathname), [pathname]);
  const [state, setState] = useState({
    revision: 0,
    status: "connecting",
    indexVersion: 0,
    lastIndexedAt: null,
    error: null,
  });

  useEffect(() => {
    const events = new EventSource("/api/vault/events");

    events.onmessage = (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }

      window.dispatchEvent(new CustomEvent("vault:index-event", { detail: event }));
      setState((current) => {
        const shouldRefresh =
          event.type === "vault.index.changed" &&
          event.affectedScopes?.includes(scope);
        return {
          revision: shouldRefresh ? current.revision + 1 : current.revision,
          status: event.status || current.status,
          indexVersion: event.indexVersion ?? current.indexVersion,
          lastIndexedAt: event.lastIndexedAt ?? current.lastIndexedAt,
          error: event.lastError ?? null,
        };
      });
    };

    events.onopen = () => {
      setState((current) => ({ ...current, status: "watching", error: null }));
    };
    events.onerror = () => {
      setState((current) => ({
        ...current,
        status: events.readyState === EventSource.CLOSED ? "disconnected" : "reconnecting",
      }));
    };

    return () => events.close();
  }, [scope]);

  return state;
}
