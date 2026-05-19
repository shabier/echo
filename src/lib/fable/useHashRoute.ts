import { useCallback, useEffect, useState } from "react";

export type Route =
  | { name: "library" }
  | { name: "reader"; storyId: string; replayPath?: number[] }
  | { name: "seed"; seedId: string; replayPath?: number[] };

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  if (!raw) return { name: "library" };

  const [path, query] = raw.split("?");
  const segs = path.split("/");
  const params = new URLSearchParams(query || "");
  const replayPathRaw = params.get("p");
  const replayPath = replayPathRaw
    ? replayPathRaw
        .split(",")
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n))
    : undefined;

  if (segs[0] === "read" && segs[1]) {
    return { name: "reader", storyId: segs[1], replayPath };
  }
  if (segs[0] === "seed" && segs[1]) {
    return { name: "seed", seedId: segs[1], replayPath };
  }
  return { name: "library" };
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((to: Route) => {
    window.location.hash = formatRoute(to);
  }, []);

  return { route, navigate };
}

export function formatRoute(r: Route): string {
  switch (r.name) {
    case "library":
      return "/";
    case "reader": {
      const q = r.replayPath?.length ? `?p=${r.replayPath.join(",")}` : "";
      return `/read/${r.storyId}${q}`;
    }
    case "seed": {
      const q = r.replayPath?.length ? `?p=${r.replayPath.join(",")}` : "";
      return `/seed/${r.seedId}${q}`;
    }
  }
}
