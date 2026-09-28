# DayDream Browser

DayDream Browser is a customizable, privacy-focused browser experience with integrated proxy tools and advanced browsing features.

## Features

- InSpec support
- Extension support
- Proxy and UBG tools with panic key and cloaking
- Scramjet proxy support
- Tabs, bookmarks, history, and profiles
- Custom themes, backgrounds, and search suggestions
- Developer tools
- Night+

## Platform Support

Windows is not supported.

## Installation

> [!WARNING]
> DayDream Browser cannot be hosted on static web hosting platforms such as Netlify, GitHub Pages, or Cloudflare Pages.

```bash
git clone https://gitlab.com/nightnetwork/daydreamx.git
cd DayDreamX
pnpm install
pnpm build
cp config.example.js config.js
pnpm start
```

The app will run on `http://127.0.0.1:8080` (localhost only, not accessible from other machines).

## Builds

See [BUILDING.md](BUILDING.md).

### Terbium TAPP

Build a Terbium application package with `npm run build:tapp`. The generated
`dist-tapp/daydream.TAPP.zip` includes Terbium window options, App Island
shortcuts, VFS-backed downloads, media controls, notifications, and the shared
Wisp transport integration.

## Contributing

To contribute, fork the repository, implement your changes, and submit a pull request. See [CONTRIB.md](https://gitlab.com/nightnetwork/daydreamx/blob/main/CONTRIB.md) for guidelines.

## Community

Join the [Discord community](https://discord.night-x.com) for support and updates.
