import { useEffect, useState } from "react";

const KEY = "menu_extractor_device_id";

function generate(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join("");
}

export function useDeviceId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let v = window.localStorage.getItem(KEY);
    if (!v || !/^[a-zA-Z0-9_-]{8,64}$/.test(v)) {
      v = generate();
      window.localStorage.setItem(KEY, v);
    }
    setId(v);
  }, []);
  return id;
}
