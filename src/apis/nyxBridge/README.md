# nyxBridge

Host-side bridge giving NyxAI (loaded at `ddx://ai`) typed control over
DDX tabs — read pages, click, type, navigate, run CDP commands,
manipulate cookies and storage, intercept dialogs, drive low-level input.

## Architecture

Three layers:

1. **Host coordinator** (this folder) — `NyxBridge` singleton, handshake,
   channel, per-tab serialized queue, handler registry. Constructed once
   in `src/index.tsx` and exposed on `window.nyxBridge`.

2. **Per-frame agent** (`agent/`) — chobitsu + a thin receiver injected
   into every non-Nyx proxied frame by `hookInstaller.ts`. Mirrors the
   pattern in `src/apis/devtools/agent/`. Built as an IIFE bundle at
   `dist/assets/nyx-bridge-agent.js`.

3. **Client runtime** (`client/`) — the `window.ddx` builder injected
   into NyxAI frames via `scriptInjectionRegistry`. Iterates
   `METHOD_REGISTRY` to materialize every method as a Promise-returning
   RPC. Built as an IIFE bundle at `dist/assets/nyx-bridge-client.js`.

## The contract

`api.ts` is the single source of truth. To add a method:

1. Declare its signature on the relevant `DDX*` interface.
2. Append the dotted name (`"foo.bar"`) to `METHOD_REGISTRY`.
3. Add a handler entry in `handlers/<namespace>.ts` and re-import via
   `handlers/_loadAll.ts`.
4. The runtime registry guard (`tests/nyxBridge/registry.test.ts`)
   enforces completeness — adding a method without a handler fails the
   test loudly.

The client runtime rebuilds `window.ddx` automatically on next iframe
load — no NyxAI changes needed.

## Security

- **Origin allowlist** (`nyx.night-x.com`, `nyx.ampscat.dev`, `nyxai.me`, plus
  optional `aiBridgeDevOrigin` settings override) gates both
  `scriptInjectionRegistry.match` AND channel source verification.
- **Handshake**: host injects a per-session `HOST_MARKER`; client
  computes `sha256(nonce + ":" + HOST_MARKER + ":nyx-bridge-v1")` and
  echoes it back. Only the real injected runtime knows the marker, so
  only the real NyxAI can complete handshake. See `handshake.ts`.
- Every RPC after handshake is verified against the bound iframe; any
  request from a different source rejects with `permission_denied`. The
  underlying `RequestResponseChannel` already drops same-window
  spoofing.

## Backends

| Concern              | Backend                                                      |
|----------------------|--------------------------------------------------------------|
| Tabs / navigation    | Direct DDX APIs (`window.tabs`, `proxy.navigateFrame`)       |
| DOM read / interact  | Direct DOM (`iframe.contentDocument`) — Scramjet same-origin |
| Page storage         | Direct DOM (`iframe.contentWindow.localStorage/sessionStorage`) |
| Cookies              | CDP `Network.{get,set,delete}Cookies`                        |
| Dialogs              | CDP `Page.handleJavaScriptDialog`                            |
| Low-level input      | CDP `Input.dispatchKeyEvent` / `dispatchMouseEvent`          |
| Screenshots          | CDP `Page.captureScreenshot`                                 |
| File uploads         | CDP `DOM.setFileInputFiles` (blob-URL workaround in v1)      |
| Raw CDP escape hatch | `ddx.debugger.sendCommand` → `CdpHelper.send`                |

## Spec / plan / smoke

- Design: `docs/superpowers/specs/2026-06-13-nyxai-bridge-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-13-nyxai-bridge.md`
- Manual smoke test: `docs/nyxBridge/SMOKE.md`

## v1 limitations

See the spec's "Out of scope (v1)" section. Headlines:

- No push events to NyxAI — `wait*` polling tools cover most needs.
- No `AbortSignal` cancellation across the channel.
- No network interception via CDP `Fetch.enable`.
- `scripting.executeScript` supports `func:` only; `files:` rejects.
- `windows.create` opens tabs in DDX's single window; it cannot create a separate browser window.
- `dom.uploadFile` works against chobitsu via blob URLs; behaviour
  against real Chrome may differ — revisit in v2.
- Pre-existing NyxAI tabs don't get the client runtime on hot-reload of
  the bridge — user must reload `ddx://ai`.
