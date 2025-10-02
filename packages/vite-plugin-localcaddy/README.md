# vite-plugin-domain (Deno Version)

> **Stop playing the localhost lottery.** Automatically assigns memorable, stable domains to your Vite projects using Caddy as a reverse proxy.

This is a faithful reimplementation of the [Node.js version](https://www.npmjs.com/package/vite-plugin-domain), converted to TypeScript and built for the Deno runtime using Deno's standard library.

Transform this chaos:
- `localhost:5173` → `frontend.local`
- `localhost:5174` → `admin.local`
- `localhost:5175` → `api.local`

**📚 For complete usage documentation, see [USAGE.md](./USAGE.md)**

## Quick Start

```bash
# Install Caddy and trust its CA (one-time setup)
caddy trust

# Start Caddy
caddy run

# Add to your project
deno add jsr:@fry69/vite-plugin-localcaddy
```

```typescript
// vite.config.ts
import { defineConfig } from "npm:vite";
import domain from "jsr:@fry69/vite-plugin-localcaddy";

export default defineConfig({
  plugins: [domain()],
  server: { allowedHosts: [".local"] }
})
```

```bash
# Run with permissions
deno task dev --allow-read --allow-net
```

## What Makes This Deno Version Different?

This conversion replaces Node.js-specific APIs with Deno equivalents while maintaining 100% functional compatibility with the original.

### Key Technical Changes

| Category | Node.js | Deno |
|----------|---------|------|
| **File System** | `import fs from 'node:fs'`<br/>`fs.readFileSync()` | `Deno.readTextFileSync()` |
| **Path Operations** | `import path from 'node:path'`<br/>`path.basename()`, `process.cwd()` | `import { basename } from "@std/path"`<br/>`basename(Deno.cwd())` |
| **Network** | `import net from 'node:net'`<br/>`net.createConnection()` | `Deno.connect()` |
| **Process** | `process.exitCode = 1` | `Deno.exit(1)` |
| **Terminal Colors** | `import pc from 'picocolors'` | `import { bold, cyan, dim } from "@std/fmt/colors"` |
| **Type Definitions** | Separate `.d.ts` file | Built-in TypeScript support |
| **Permissions** | Implicit Node.js permissions | Explicit Deno flags: `--allow-read`, `--allow-net` |

### Features Retained

✅ All functionality from the Node.js version
✅ Automatic domain generation from folder or package.json
✅ HTTPS via Caddy's internal issuer
✅ Port conflict detection and resolution
✅ Multiple projects sharing one Caddy instance
✅ Full TypeScript support with type safety

## Conversion Methodology

The conversion followed a rigorous test-driven approach:

1. **Analysis** — Studied the original Node.js implementation to understand behavior
2. **Test Extraction** — Identified and documented all test cases from the source code
3. **Test Implementation** — Wrote comprehensive Deno tests (25 test cases covering all functionality)
4. **Incremental Conversion** — Reimplemented each function in Deno TypeScript until all tests passed
5. **Validation** — Ensured 100% test coverage and functional equivalence

**Result:** A maintainable, fully-tested Deno implementation with type safety and modern best practices.

For detailed conversion notes, see [CONVERSION_SUMMARY.md](./CONVERSION_SUMMARY.md).

## Development

### Running Tests

```bash
cd packages/vite-plugin-localcaddy
deno test --allow-read --allow-write --allow-net
```

All 25 tests validate:
- Domain generation (folder and package.json sources)
- Route management and conflict detection
- Port checking and availability
- Array comparison utilities
- Plugin configuration and structure

### Project Structure

```
packages/vite-plugin-localcaddy/
├── src/
│   └── mod.ts              # Main plugin implementation (533 lines)
├── tests/
│   └── mod_test.ts         # Comprehensive test suite (25 tests)
├── deno.json               # Deno configuration and dependencies
├── README.md               # This file (conversion overview)
├── USAGE.md                # Complete usage guide
├── CONVERSION_SUMMARY.md   # Detailed conversion documentation
└── vite.config.example.ts  # Example configuration

## Documentation

- **[USAGE.md](./USAGE.md)** — Complete usage guide with examples, troubleshooting, and best practices
- **[CONVERSION_SUMMARY.md](./CONVERSION_SUMMARY.md)** — Detailed technical documentation of the Node.js → Deno conversion
- **[vite.config.example.ts](./vite.config.example.ts)** — Example Vite configuration file

## Resources

- [Original Node.js version](https://www.npmjs.com/package/vite-plugin-domain) — The source implementation
- [Caddy Documentation](https://caddyserver.com/docs/) — Reverse proxy and TLS setup
- [Deno Standard Library](https://deno.land/std) — Standard library modules used

## Acknowledgement

This code is based on the [original Node.js version](https://www.npmjs.com/package/vite-plugin-domain) found in the npm registry. Since no author name or contact information is provided in the original package metadata, credit is given by reference to the source package URL above.

## License

MIT (Same as the original Node.js version)
