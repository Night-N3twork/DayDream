# Building DayDream

## Terbium TAPP build

DayDream can also be packaged as a self-contained [Terbium](https://github.com/TerbiumOS/web-v2) app (`.TAPP.zip`). The TAPP build shares Terbium's Wisp transport (so it doesn't open its own backend connection) and routes downloads through Terbium's VFS.

```bash
pnpm run build:tapp
```

This produces `dist-tapp/daydream.TAPP.zip` containing the full Daydream build, a generated `.tbconfig` (Terbium's runtime app config), the app icon (copied from `public/res/logo.png`), and the Terbium integration shims under `terbium/`.

To install the TAPP inside a running Terbium instance, extract the zip into Terbium's filesystem and call from the Terbium console:

```js
// After extracting daydream.TAPP.zip to /fs/apps/daydream.tapp/
await tb.launcher.addApp({
  name: "Daydream",
  icon: "/fs/apps/daydream.tapp/icon.png",
  src: "/fs/apps/daydream.tapp/index.html"
});
```

The standalone `pnpm run build` is unaffected — TAPP-specific build steps only run when the `build:tapp` script is invoked.

TAPP-specific configuration (display name, window size, package name) lives under the `terbium` key in `package.json` and is the source of truth for the generated `.tbconfig`. The `app_id` is derived as `com.tb.<pkg-name>`.

> Note: `.tbconfig` is the **runtime** config inside the TAPP zip — what Terbium reads on install. It is distinct from the tb-repo *catalog* `manifest.json` (which lives in `TerbiumOS/tb-repo` and points to a hosted `pkg-download` URL). Producing a tb-repo entry for catalog submission is out of scope for this build.
