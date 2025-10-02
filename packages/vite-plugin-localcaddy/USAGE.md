# vite-plugin-domain Usage Guide

**Juggling multiple Vite apps and can't remember which port is which?**

Stop playing the localhost lottery. This plugin automatically assigns memorable domains to each of your projects — derived from the folder name or package.json — so `localhost:5173`, `localhost:5174`, and `localhost:5175` become `frontend.local`, `admin.local`, and `api.local`.

## The Problem

You're working on multiple Vite projects. Each one claims a random port. You have browser tabs open to:
- `localhost:5173` — wait, is this the admin panel or the customer app?
- `localhost:5174` — definitely the API... or was it the docs site?
- `localhost:3000` — something's running here but you forgot what

Tomorrow when you restart everything, the ports shuffle around. The API that was on 5173 is now on 5175. Your bookmarks are useless. Your muscle memory is worthless.

## The Solution

This tiny plugin wires each project to a stable local domain via [Caddy](https://caddyserver.com). Now you have:
- `frontend.local` — always your frontend, no matter the port
- `admin.local` — always your admin panel
- `api.local` — always your API

Start any project in any order. Restart them whenever. The domains stay the same.

## What It Does

The plugin automatically:
- Configures a Caddy HTTP server with HTTPS via the internal issuer
- Routes your domain to whatever port Vite picks
- Generates domain names from your folder or package.json
- Shares one Caddy instance across all your projects

## Prerequisites

### Install and Start Caddy

1. [Install Caddy](https://caddyserver.com/docs/install) for your platform
2. Trust Caddy's local CA (one-time setup):
   ```bash
   sudo caddy trust
   ```
3. Start Caddy with the admin API enabled:
   ```bash
   caddy run
   ```
   The admin API runs on `http://127.0.0.1:2019` by default. The plugin uses this API to configure domains dynamically.

## Installation

Add the package to your Deno project:

```bash
deno install jsr:@fry69/vite-plugin-localcaddy
```

This adds the package to your `deno.json` imports, allowing you to use a clean import alias in your code:

```typescript
import domain from "vite-plugin-localcaddy";
```

## Basic Configuration

Add the plugin to your `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import domain from "vite-plugin-localcaddy";

export default defineConfig({
  plugins: [
    domain({
      // All options are optional with sensible defaults:
      adminUrl: "http://127.0.0.1:2019",   // Caddy admin API endpoint
      serverId: "vite-dev",                // Caddy server identifier
      listen: [":443", ":80"],             // Ports Caddy should listen on
      nameSource: "folder",                // Use folder name for domain ('folder' | 'pkg')
      tld: "localhost",                    // Top-level domain suffix
      // domain: "myapp.localhost",        // Explicit domain (overrides nameSource+tld)
      failOnActiveDomain: true,            // Fail if domain already has an active route
      insertFirst: true,                   // Insert new route at top of route list
      verbose: false,                      // Enable detailed logging
    })
  ]
})
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
| `tld`                | `string`              | `"localhost"`             | Top-level domain                                  |
| `domain`             | `string \| undefined` | `undefined`               | Explicit domain (overrides auto-naming)           |
| `failOnActiveDomain` | `boolean`             | `true`                    | Fail if domain has active route to different port |
| `insertFirst`        | `boolean`             | `true`                    | Insert route at beginning of route list           |
| `verbose`            | `boolean`             | `false`                   | Enable detailed logging                           |

## Domain Configuration

### Automatic Naming

By default, the plugin generates a domain based on:
- **Folder name** (`nameSource: "folder"`) — Uses the current directory name
- **Package name** (`nameSource: "pkg"`) — Uses the `name` field from `package.json`

The generated domain follows the pattern: `{name}.{tld}`

Examples:
```typescript
// In folder "my-frontend" with nameSource: "folder"
// → Domain: my-frontend.localhost

// With package.json containing { "name": "awesome-app" } and nameSource: "pkg"
// → Domain: awesome-app.localhost
```

### Manual Naming

Override automatic naming by specifying an explicit domain:

```typescript
domain({ domain: "my-custom-app.localhost" })
```

## Choosing a TLD: .localhost vs .local

### Using .localhost (Recommended)

Works without additional setup in most browsers:

```typescript
domain({ tld: "localhost" })
```

Browsers automatically resolve `*.localhost` to `127.0.0.1` per [RFC 6761](https://datatracker.ietf.org/doc/html/rfc6761). This is the **preferred option** as `.localhost` is officially reserved for local development.

**Benefits:**
- No `/etc/hosts` entries needed
- Works across all operating systems
- Officially designated for loopback testing

### Using .local (Alternative)

Shorter and cleaner URLs, but **not recommended** as `.local` is officially reserved for mDNS (Multicast DNS) by RFC 6762:

```typescript
domain({ tld: "local" })
```

**Requirements if you choose this option:**
1. Add to Vite's allowed hosts:
   ```typescript
   server: { allowedHosts: [".local"] }
   ```

2. Add an entry to `/etc/hosts`:
   ```bash
   sudo bash -c "echo '127.0.0.1 myapp.local' >> /etc/hosts"
   ```

**Note:** Using `.local` may cause conflicts on networks that use mDNS (like macOS Bonjour). The `.localhost` TLD avoids these issues.

## Advanced Usage

### Multiple Projects

Run several Vite projects simultaneously with different domains:

```typescript
// Project A: vite.config.ts
domain({ domain: "frontend.localhost" })

// Project B: vite.config.ts
domain({ domain: "admin.localhost" })

// Project C: vite.config.ts
domain({ domain: "api.localhost" })
```

All three projects can run concurrently, each accessible via its own domain, all routing through the same Caddy instance.

### Custom Caddy Server Configuration

If you need different Caddy server settings per project:

```typescript
domain({
  serverId: "my-project-server",
  listen: [":8443", ":8080"],  // Custom ports
  adminUrl: "http://127.0.0.1:2019"
})
```

### Debugging

Enable verbose logging to troubleshoot issues:

```typescript
domain({ verbose: true })
```

This will print detailed information about:
- Domain resolution and conflicts
- Caddy API calls and responses
- Port detection and binding
- Route configuration

## How It Works

When you start your Vite dev server:

1. The plugin connects to Caddy's admin API at the configured `adminUrl`
2. Creates or updates a Caddy server configuration with the specified `serverId`
3. Sets up TLS automation with Caddy's internal issuer for HTTPS
4. Determines your domain name (from folder, package.json, or explicit config)
5. Detects Vite's dev server port
6. Adds a reverse proxy route from your domain to the Vite port
7. Prints the HTTPS URL where you can access your app

Example output:
```
  ➜  Domain: https://my-app.localhost/ (via caddy)
```

## Troubleshooting

### Browser Shows "Connection Refused"

- Ensure Caddy is running: `caddy run`
- Check the domain resolves: `ping myapp.localhost`
- For `.local` domains, verify `/etc/hosts` entry exists
- Check Caddy's logs for errors

### Certificate Warnings

- Run `sudo caddy trust` to install Caddy's local CA
- Restart your browser after trusting the certificate
- On macOS, you may need to manually trust the certificate in Keychain Access

### "Domain Already Has an Active Route" Error

- Another project is using this domain
- Either stop the other project or use a different domain
- Or set `failOnActiveDomain: false` to override (use with caution)

### Vite Shows "Invalid Host Header"

- Add your TLD to Vite's allowed hosts: `server: { allowedHosts: [".localhost"] }`
- This is typically only needed for custom TLDs or `.local` domains

### Permission Errors with Deno

The plugin requires specific permissions:
- `--allow-read` — To read `package.json` and folder names
- `--allow-net` — To communicate with Caddy's admin API and check ports
- `--allow-write` — (Optional) Only if the plugin needs to write temporary files

Make sure these are granted when running Vite:
```bash
deno task dev --allow-read --allow-net --allow-write
```

### Port Conflicts

If the plugin reports a port conflict:
1. Check what's running on the conflicting port: `lsof -i :PORT`
2. Stop the conflicting service or configure Vite to use a different port
3. The plugin will automatically detect and use Vite's chosen port

## Examples

### Simple Project with Folder-Based Domain

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import domain from "vite-plugin-localcaddy";

export default defineConfig({
  plugins: [domain()]
})
```

Running in folder `my-app` → accessible at `https://my-app.localhost`

### Custom Domain with Debugging

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import domain from "vite-plugin-localcaddy";

export default defineConfig({
  plugins: [
    domain({
      domain: "frontend.localhost",
      verbose: true
    })
  ]
})
```

### Using .local TLD (Not Recommended)

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import domain from "vite-plugin-localcaddy";

export default defineConfig({
  plugins: [
    domain({
      tld: "local"
    })
  ],
  server: { allowedHosts: [".local"] }
})
```

Running in folder `my-app` → accessible at `https://my-app.local`

**Note:** Remember to add the `/etc/hosts` entry for `.local` domains.

### Multiple Projects with Shared Caddy

```typescript
// frontend/vite.config.ts
import { defineConfig } from "vite";
import domain from "vite-plugin-localcaddy";

export default defineConfig({
  plugins: [domain({ domain: "frontend.localhost" })]
})

// api/vite.config.ts
import { defineConfig } from "vite";
import domain from "vite-plugin-localcaddy";

export default defineConfig({
  plugins: [domain({ domain: "api.localhost" })]
})

// admin/vite.config.ts
import { defineConfig } from "vite";
import domain from "vite-plugin-localcaddy";

export default defineConfig({
  plugins: [domain({ domain: "admin.localhost" })]
})
```

All three projects can run simultaneously, each on its own stable domain.

## Best Practices

1. **Use `.localhost` TLD** — Officially reserved for loopback testing, works everywhere without setup
2. **Use explicit domains for production-like setups** — This makes it clear which service is which
3. **Enable verbose mode during initial setup** — Helps diagnose configuration issues
4. **Keep Caddy running in a dedicated terminal** — So you can see logs if issues arise
5. **Use the same serverId across projects** — Allows them to share one Caddy server instance
6. **Trust Caddy's CA immediately** — Avoids certificate warnings later
7. **Use import aliases from deno.json** — Avoid explicit package specifiers in source code

## See Also

- [Caddy Documentation](https://caddyserver.com/docs/)
- [Caddy Admin API Reference](https://caddyserver.com/docs/api)
- [Vite Configuration Reference](https://vitejs.dev/config/)
- [Deno Standard Library](https://deno.land/std)

## License

MIT
