[![JSR](https://jsr.io/badges/@fry69/vite-plugin-localcaddy)](https://jsr.io/@fry69/vite-plugin-localcaddy)
[![JSR Score](https://jsr.io/badges/@fry69/vite-plugin-localcaddy/score)](https://jsr.io/@fry69/vite-plugin-localcaddy/score)

# vite-plugin-localcaddy

> **Stop playing the localhost lottery.** Automatically assigns memorable, stable domains to your Vite projects using Caddy as a reverse proxy.

This is a faithful reimplementation of [mustafa0x/vite-plugin-domain](https://github.com/mustafa0x/vite-plugin-domain), built for the Deno runtime using Deno's standard library.

Transform this chaos:

- `localhost:5173` → `frontend.localhost`
- `localhost:5174` → `admin.localhost`
- `localhost:5175` → `api.localhost`

**📚 For complete usage documentation, see [USAGE.md](./USAGE.md)**

## Quick Start

```bash
# Start Caddy
caddy run

# Install Caddy and trust its CA (one-time setup)
caddy trust

# Add to your project
deno install jsr:@fry69/vite-plugin-localcaddy
```

> [!NOTE]
> **macOS users:** If you encounter certificate trust issues, you may need to install the `nss` package: `brew install nss`

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import domain from "@fry69/vite-plugin-localcaddy";

export default defineConfig({
  plugins: [domain()],
});
```

```bash
# The development server runs with necessary permissions by default
deno task dev
```

## What Makes This Deno Version Different?

This conversion replaces Node.js-specific APIs with Deno equivalents while maintaining 100% functional compatibility with the original.

### Key Technical Changes

| Category            | Node.js                                                               | Deno                                                              |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **File System**     | `import fs from 'node:fs'`<br/>`fs.readFileSync()`                    | `Deno.readTextFileSync()`                                         |
| **Path Operations** | `import path from 'node:path'`<br/>`path.basename()`, `process.cwd()` | `import { basename } from "@std/path"`<br/>`basename(Deno.cwd())` |
| **Network**         | `import net from 'node:net'`<br/>`net.createConnection()`             | `Deno.connect()`                                                  |
| **Process**         | `process.exitCode = 1`                                                | `Deno.exit(1)`                                                    |
| **Terminal Colors** | `import pc from 'picocolors'`                                         | `import { bold, cyan, dim } from "@std/fmt/colors"`               |

### Features Retained

- All functionality from the Node.js version
- Automatic domain generation from folder or package.json
- HTTPS via Caddy's internal issuer
- Port conflict detection and resolution
- Multiple projects sharing one Caddy instance
- Full type safety and IDE support

For detailed conversion notes, see [CONVERSION_SUMMARY.md](./CONVERSION_SUMMARY.md).

## Development

### Running Tests

```bash
deno test -A
```

Tests validate:

- Domain generation (folder and package.json sources)
- Route management and conflict detection
- Port checking and availability
- Array comparison utilities
- Plugin configuration and structure

## Documentation

- **[USAGE.md](./USAGE.md)** — Complete usage guide with examples, troubleshooting, and best practices
- **[CONVERSION_SUMMARY.md](./CONVERSION_SUMMARY.md)** — Detailed technical documentation of the Node.js → Deno conversion
- **[vite.config.example.ts](./vite.config.example.ts)** — Example Vite configuration file

## Resources

- [mustafa0x/vite-plugin-domain](https://github.com/mustafa0x/vite-plugin-domain) — Original Node.js implementation
- [npm package](https://www.npmjs.com/package/vite-plugin-domain) — Published package
- [Caddy Documentation](https://caddyserver.com/docs/) — Reverse proxy and TLS setup
- [Deno Standard Library](https://deno.land/std) — Standard library modules used

## Acknowledgement

This package is a Deno conversion of [vite-plugin-domain](https://github.com/mustafa0x/vite-plugin-domain) by [mustafa0x](https://github.com/mustafa0x). The original Node.js implementation provided the foundation for this fully-tested Deno port.

## License

MIT (Same as the original)
