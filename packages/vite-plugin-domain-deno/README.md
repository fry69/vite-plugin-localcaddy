# vite-plugin-domain (Deno Version)

Automatically assigns memorable domains to your Vite projects using Caddy as a reverse proxy.

This is a faithful reimplementation of the [Node.js version](https://www.npmjs.com/package/vite-plugin-domain), built for the Deno runtime using Deno's standard library.

## Features

- 🔒 **HTTPS by default** - Uses Caddy's internal issuer for local development certificates
- 🎯 **Stable domains** - No more guessing which port is which project
- 🔄 **Zero configuration** - Sensible defaults work out of the box
- 🧩 **Smart naming** - Derives domain from folder name or package.json
- 🚀 **Port reconciliation** - Detects and handles port conflicts automatically

## Differences from Node.js Version

This Deno version:

- Uses **Deno's standard library** (`@std/path`, `@std/fs`, `@std/fmt`) instead of Node.js built-ins
- Uses **`@std/fmt/colors`** for terminal output instead of `picocolors`
- Uses **Deno.connect()** for port checking instead of Node's `net` module
- Uses **Deno.cwd()** and **Deno.readTextFileSync()** instead of `process` and `fs`
- Has **TypeScript types built-in** (no separate `.d.ts` file needed)
- Uses **native Deno permissions** (--allow-read, --allow-net, etc.)

## Prerequisites

### Install and start Caddy

1. [Install Caddy](https://caddyserver.com/docs/install) for your platform
2. Trust Caddy's local CA (one-time setup):
   ```bash
   sudo caddy trust
   ```
3. Start Caddy with the admin API enabled:
   ```bash
   caddy run
   ```
   The admin API runs on `http://127.0.0.1:2019` by default.

## Installation

Add the package to your Deno project:

```bash
deno add jsr:@fry69/vite-plugin-domain-deno
```

Or import directly in your code:

```typescript
import domain from "jsr:@fry69/vite-plugin-domain-deno";
```

## Usage

Add the plugin to your `vite.config.ts`:

```typescript
import { defineConfig } from "npm:vite";
import domain from "jsr:@fry69/vite-plugin-domain-deno";

export default defineConfig({
  plugins: [
    domain({
      // All options are optional with sensible defaults:
      adminUrl: "http://127.0.0.1:2019", // Caddy admin API endpoint
      serverId: "vite-dev", // Caddy server identifier
      listen: [":443", ":80"], // Ports Caddy should listen on
      nameSource: "folder", // Use folder name ('folder' | 'pkg')
      tld: "local", // Top-level domain suffix
      // domain: "myapp.local",            // Explicit domain (overrides nameSource+tld)
      failOnActiveDomain: true, // Fail if domain has active route
      insertFirst: true, // Insert new route at top
      verbose: false, // Enable detailed logging
    }),
  ],
  server: {
    // Required for .local domains:
    allowedHosts: [".local"],
  },
});
```

## Running with Deno

Since the plugin interacts with Caddy and reads files, you'll need to grant Deno permissions:

```bash
deno task dev --allow-read --allow-net --allow-write
```

Or configure permissions in `deno.json`:

```json
{
  "tasks": {
    "dev": "deno run --allow-read --allow-net --allow-write vite"
  }
}
```

## Configuration Options

All options are optional with sensible defaults:

| Option               | Type                  | Default                   | Description                                       |
| -------------------- | --------------------- | ------------------------- | ------------------------------------------------- |
| `adminUrl`           | `string`              | `"http://127.0.0.1:2019"` | Caddy Admin API endpoint                          |
| `serverId`           | `string`              | `"vite-dev"`              | Caddy server identifier                           |
| `listen`             | `string[]`            | `[":443", ":80"]`         | Ports for Caddy to listen on                      |
| `nameSource`         | `"folder" \| "pkg"`   | `"folder"`                | Source for domain name                            |
| `tld`                | `string`              | `"local"`                 | Top-level domain                                  |
| `domain`             | `string \| undefined` | `undefined`               | Explicit domain (overrides auto-naming)           |
| `failOnActiveDomain` | `boolean`             | `true`                    | Fail if domain has active route to different port |
| `insertFirst`        | `boolean`             | `true`                    | Insert route at beginning of route list           |
| `verbose`            | `boolean`             | `false`                   | Enable detailed logging                           |

## Domain Configuration

### Automatic Naming

By default, the plugin generates a domain based on:

- **Folder name** (`nameSource: "folder"`) - Uses the current directory name
- **Package name** (`nameSource: "pkg"`) - Uses the `name` field from `package.json`

The generated domain follows the pattern: `{name}.{tld}`

### Manual Naming

Override automatic naming by specifying an explicit domain:

```typescript
domain({ domain: "my-custom-app.local" });
```

## TLD Options: .local vs .localhost

### Using .local (recommended)

Shorter and cleaner, but requires one-time setup:

1. Add to Vite's allowed hosts:
   ```typescript
   server: {
     allowedHosts: [".local"];
   }
   ```

2. Add an entry to `/etc/hosts`:
   ```bash
   sudo bash -c "echo '127.0.0.1 myapp.local' >> /etc/hosts"
   ```

### Using .localhost

Works without additional setup in most browsers:

```typescript
domain({ tld: "localhost" });
```

Browsers typically resolve `*.localhost` to `127.0.0.1` automatically.

## Development

### Running Tests

```bash
cd packages/vite-plugin-domain-deno
deno test --allow-read --allow-write --allow-net
```

### Project Structure

```
packages/vite-plugin-domain-deno/
├── src/
│   └── mod.ts          # Main plugin implementation
├── tests/
│   └── mod_test.ts     # Test suite
├── deno.json           # Deno configuration
└── README.md           # This file
```

## How It Works

When you start your Vite dev server:

1. The plugin connects to Caddy's admin API
2. Creates or updates a Caddy server configuration
3. Sets up TLS automation with Caddy's internal issuer
4. Adds a reverse proxy route from your domain to Vite's dev server port
5. Prints the HTTPS URL where you can access your app

## Key Deno Conversions

| Node.js                        | Deno                                                |
| ------------------------------ | --------------------------------------------------- |
| `import fs from 'node:fs'`     | `Deno.readTextFileSync()`                           |
| `import path from 'node:path'` | `import { basename, join } from "@std/path"`        |
| `import net from 'node:net'`   | `Deno.connect()`                                    |
| `process.cwd()`                | `Deno.cwd()`                                        |
| `process.exitCode = 1`         | `Deno.exit(1)`                                      |
| `import pc from 'picocolors'`  | `import { bold, cyan, dim } from "@std/fmt/colors"` |

## License

MIT (Same as the original Node.js version)

## See Also

- [Original Node.js version](https://www.npmjs.com/package/vite-plugin-domain)
- [Caddy Documentation](https://caddyserver.com/docs/)
- [Deno Standard Library](https://deno.land/std)

## Acknowledgement

This code is based on the [original Node.js version](https://www.npmjs.com/package/vite-plugin-domain) found in the npm registry. Since no author name or contact information is provided in the original package metadata, credit is given by reference to the source package URL above.
