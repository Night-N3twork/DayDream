import { buildConfig } from "@core/shared/build-runtime";

const cfg = buildConfig();
const beaconUrl = `${cfg.workspace}${cfg.cover.route}/${cfg.routes.assets}/${cfg.rpc.token}/beacon`;

const CLIENT_ID_KEY = "__ddx_client_id";

function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

export function trackEvent(
  name: string,
  params: Record<string, unknown> = {},
): void {
  try {
    const payload = JSON.stringify({
      client_id: getClientId(),
      events: [{ name, params }],
    });
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(beaconUrl, blob);
    } else {
      void fetch(beaconUrl, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {
        /* swallow */
      });
    }
  } catch {
    /* telemetry must never break app */
  }
}
