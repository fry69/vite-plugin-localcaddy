/**
 * A Vite plugin that automatically configures Caddy reverse proxy routes for local HTTPS development.
 *
 * This plugin integrates with Caddy's admin API to dynamically create and manage
 * reverse proxy routes, enabling local development with custom domains and HTTPS certificates.
 *
 * @example
 * ```ts
 * import { defineConfig } from "vite";
 * import localcaddy from "vite-plugin-localcaddy";
 *
 * export default defineConfig({
 *   plugins: [
 *     localcaddy({
 *       domain: "myapp.localhost",
 *       verbose: true,
 *     }),
 *   ],
 * });
 * ```
 *
 * @module
 */

import { basename, join } from "@std/path";
import { bold, cyan, dim } from "@std/fmt/colors";

// Vite Plugin type (defined locally since vite is not a Deno dependency)
// deno-lint-ignore no-explicit-any
type Plugin = any;

/**
 * Configuration options for the vite-plugin-localcaddy plugin.
 *
 * @example
 * ```ts
 * const options: Options = {
 *   domain: "myapp.localhost",
 *   verbose: true,
 *   failOnActiveDomain: false,
 * };
 * ```
 */
type Options = {
  /** Caddy Admin API base URL. Defaults to `http://127.0.0.1:2019`. */
  adminUrl?: string;
  /** Caddy apps.http server id to use/create. Defaults to `vite-dev`. */
  serverId?: string;
  /** Addresses for the dev server we manage in Caddy. Defaults to `[":443", ":80"]`. */
  listen?: string[];
  /**
   * Choose the subdomain source (before the TLD) when no explicit `domain` is given:
   *    - `'folder'` (default): use current folder name
   *    - `'pkg'`: use package.json "name"
   */
  nameSource?: "folder" | "pkg";
  /** Top-level domain (TLD) to use when building the domain (ignored if `domain` is set). Defaults to `localhost`. */
  tld?: string;
  /**
   * Fully explicit domain to use (e.g., `'myapp.localhost'` or `'myapp.local'`).
   * If provided, overrides nameSource+tld.
   */
  domain?: string;
  /**
   * If an existing domain points to an active port that is NOT the current Vite port:
   *    - `true` (default): fail fast & explain
   *    - `false`: leave it alone and continue (no changes)
   */
  failOnActiveDomain?: boolean;
  /**
   * Insert the route at index 0 (before others) when creating a new one.
   * Defaults to `true`.
   */
  insertFirst?: boolean;
  /** Print verbose logs to console. Defaults to `false`. */
  verbose?: boolean;
};

/**
 * Internal options type with all required fields resolved to their defaults.
 * Used internally after merging user options with defaults.
 */
type InternalOptions = {
  /** Caddy Admin API base URL. */
  adminUrl: string;
  /** Caddy apps.http server id to use/create. */
  serverId: string;
  /** Addresses for the dev server we manage in Caddy. */
  listen: string[];
  /** The subdomain source to use when building the domain. */
  nameSource: "folder" | "pkg";
  /** Top-level domain (TLD) to use when building the domain. */
  tld: string;
  /** Fully explicit domain to use, if provided. */
  domain: string | undefined;
  /** Whether to fail when an existing domain points to an active port. */
  failOnActiveDomain: boolean;
  /** Whether to insert new routes at index 0. */
  insertFirst: boolean;
  /** Whether to print verbose logs. */
  verbose: boolean;
};

/**
 * Represents a Caddy reverse proxy route configuration.
 * This structure matches Caddy's HTTP route format.
 */
type CaddyRoute = {
  /** Array of match conditions, typically containing host matchers. */
  match?: Array<{ host?: string[] }>;
  /** Array of handlers, typically containing reverse_proxy configuration. */
  handle?: Array<{ handler: string; upstreams?: Array<{ dial: string }> }>;
  /** Whether this route is terminal (stops processing subsequent routes). */
  terminal?: boolean;
};

/**
 * Exported types for testing and external usage.
 */
export type { CaddyRoute, Options };

/**
 * Generates a URL-safe slug from the current folder name.
 *
 * Converts the folder name to lowercase and replaces non-alphanumeric
 * characters with hyphens, removing leading/trailing hyphens.
 *
 * @param cwd The current working directory path. Defaults to `Deno.cwd()` if not specified.
 * @returns A URL-safe slug derived from the folder name.
 *
 * @example
 * ```ts
 * slugFromFolder("/path/to/My App!") // "my-app"
 * slugFromFolder("/path/to/foo_bar-123") // "foo-bar-123"
 * ```
 */
export function slugFromFolder(cwd?: string): string {
  const dir = cwd ?? Deno.cwd();
  return basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generates a URL-safe slug from the package.json "name" field.
 *
 * Reads the package.json file and extracts the "name" field, converting it
 * to a URL-safe slug. Falls back to {@link slugFromFolder} if the file
 * cannot be read or doesn't contain a valid name.
 *
 * @param cwd The current working directory path. Defaults to `Deno.cwd()` if not specified.
 * @returns A URL-safe slug derived from the package name.
 *
 * @example
 * ```ts
 * // If package.json contains: { "name": "@my/package-name" }
 * slugFromPkg("/path/to/project") // "my-package-name"
 *
 * // If package.json is missing or invalid
 * slugFromPkg("/path/to/my-folder") // "my-folder" (falls back to folder name)
 * ```
 */
export function slugFromPkg(cwd?: string): string {
  const dir = cwd ?? Deno.cwd();
  try {
    const pkg = JSON.parse(
      Deno.readTextFileSync(join(dir, "package.json")),
    );
    const name = typeof pkg.name === "string" ? pkg.name : slugFromFolder(dir);
    return String(name)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  } catch {
    return slugFromFolder(dir);
  }
}

/**
 * Computes the final domain name based on the provided options.
 *
 * If an explicit domain is provided, it is returned as-is. Otherwise, the domain
 * is constructed from a base name (either from the folder or package.json) and the TLD.
 *
 * @param options Configuration options for domain computation.
 * @param options.domain Explicit domain name. If provided, this is returned directly.
 * @param options.nameSource Source for the subdomain: `'folder'` or `'pkg'`. Defaults to `'folder'`.
 * @param options.tld Top-level domain to append. Defaults to `'localhost'`.
 * @param options.cwd Current working directory. Defaults to `Deno.cwd()`.
 * @returns The computed domain name.
 *
 * @example
 * ```ts
 * computeDomain({ domain: "myapp.localhost" }) // "myapp.localhost"
 * computeDomain({ nameSource: "folder", tld: "dev" }) // "my-project.dev"
 * computeDomain({ nameSource: "pkg", tld: "localhost" }) // "my-package.localhost"
 * ```
 */
export function computeDomain(options: {
  domain?: string;
  nameSource?: "folder" | "pkg";
  tld?: string;
  cwd?: string;
}): string {
  if (options.domain) return options.domain;
  const nameSource = options.nameSource ?? "folder";
  const tld = options.tld ?? "localhost";
  const cwd = options.cwd;
  const base = nameSource === "pkg" ? slugFromPkg(cwd) : slugFromFolder(cwd);
  return `${base}.${tld}`;
}

/**
 * Searches for a Caddy route that matches the specified host.
 *
 * Iterates through the routes array and finds the first route with a host matcher
 * that includes the specified hostname.
 *
 * @param routes Array of Caddy routes to search through.
 * @param host The hostname to search for.
 * @returns An object containing the matching route (or undefined) and its index (-1 if not found).
 *
 * @example
 * ```ts
 * const routes = [
 *   { match: [{ host: ["example.localhost"] }], handle: [...] },
 *   { match: [{ host: ["test.localhost"] }], handle: [...] },
 * ];
 * findRouteByHost(routes, "example.localhost") // { route: routes[0], index: 0 }
 * findRouteByHost(routes, "missing.localhost") // { route: undefined, index: -1 }
 * ```
 */
export function findRouteByHost(
  routes: CaddyRoute[] | undefined,
  host: string,
): { route: CaddyRoute | undefined; index: number } {
  if (!routes) return { route: undefined, index: -1 };

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const matches = Array.isArray(r.match) ? r.match : [];
    for (const m of matches) {
      if (Array.isArray(m.host) && m.host.includes(host)) {
        return { route: r, index: i };
      }
    }
  }
  return { route: undefined, index: -1 };
}

/**
 * Extracts the upstream port number from a Caddy route configuration.
 *
 * Searches through the route's handlers to find a reverse_proxy handler and
 * extracts the port number from the first upstream's dial address.
 *
 * @param route The Caddy route to extract the port from.
 * @returns The upstream port number, or undefined if not found.
 *
 * @example
 * ```ts
 * const route = {
 *   handle: [
 *     { handler: "reverse_proxy", upstreams: [{ dial: "127.0.0.1:5173" }] }
 *   ]
 * };
 * extractUpstreamPort(route) // 5173
 * ```
 */
export function extractUpstreamPort(route: CaddyRoute): number | undefined {
  const handlers = Array.isArray(route.handle) ? route.handle : [];
  for (const h of handlers) {
    if (h.handler === "reverse_proxy") {
      const ups = h.upstreams;
      if (Array.isArray(ups) && ups.length > 0) {
        const dial = ups[0]?.dial;
        if (dial) {
          const m = /:(\d+)$/.exec(dial.trim());
          if (m) return Number(m[1]);
        }
      }
    }
  }
  return undefined;
}

/**
 * Selects the best HTTPS port from a list of listen addresses.
 *
 * Prefers port 443 if available, otherwise returns the first port that is not 80.
 * This is used to determine which port to display in the HTTPS URL.
 *
 * @param listen Array of listen addresses (e.g., `[":443", ":80"]`).
 * @returns The selected HTTPS port number, or undefined if no suitable port is found.
 *
 * @example
 * ```ts
 * pickHttpsPort([":443", ":80"]) // 443
 * pickHttpsPort([":8443", ":80"]) // 8443
 * pickHttpsPort([":80"]) // undefined
 * ```
 */
export function pickHttpsPort(listen: string[]): number | undefined {
  const ports = listen
    .map((a) => {
      const m = /:(\d+)$/.exec(a);
      return m ? Number(m[1]) : undefined;
    })
    .filter((n): n is number => typeof n === "number");

  if (ports.includes(443)) return 443;
  // prefer any port that's not 80
  return ports.find((p) => p !== 80);
}

/**
 * Compares two arrays for equality by checking if all elements match in order.
 *
 * @param a The first array to compare.
 * @param b The second array to compare.
 * @returns `true` if the arrays have the same length and all elements are equal at each index, `false` otherwise.
 *
 * @example
 * ```ts
 * arraysEqual([1, 2, 3], [1, 2, 3]) // true
 * arraysEqual([1, 2], [1, 2, 3]) // false
 * arraysEqual(["a", "b"], ["b", "a"]) // false
 * ```
 */
export function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Checks if a TCP port is actively listening for connections.
 *
 * Attempts to establish a TCP connection to the specified host and port.
 * Returns `true` if the connection succeeds (port is active), `false` otherwise.
 *
 * @param port The port number to check.
 * @param host The hostname or IP address to check. Defaults to `127.0.0.1`.
 * @param timeoutMs Maximum time to wait for the connection in milliseconds. Defaults to `350`.
 * @returns A promise that resolves to `true` if the port is active, `false` otherwise.
 *
 * @example
 * ```ts
 * const active = await isPortActive(5173); // Check if port 5173 is listening
 * if (active) {
 *   console.log("Port is in use");
 * }
 * ```
 */
export function isPortActive(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 350,
): Promise<boolean> {
  return new Promise((resolve) => {
    const abort = new AbortController();
    let resolved = false;

    const done = (val: boolean) => {
      if (resolved) return;
      resolved = true;
      abort.abort();
      resolve(val);
    };

    const timer = setTimeout(() => done(false), timeoutMs);

    Deno.connect({ hostname: host, port, signal: abort.signal })
      .then((conn) => {
        clearTimeout(timer);
        conn.close();
        done(true);
      })
      .catch(() => {
        clearTimeout(timer);
        done(false);
      });
  });
}

/**
 * Creates a Vite plugin that automatically configures Caddy for local HTTPS development.
 *
 * See the module documentation for detailed usage information and examples.
 *
 * @param user Configuration options. See {@link Options} for all available settings.
 * @returns A Vite plugin instance that configures Caddy during development.
 */
export default function domain(user: Options = {}): Plugin {
  const opt: InternalOptions = {
    adminUrl: user.adminUrl ?? "http://127.0.0.1:2019",
    serverId: user.serverId ?? "vite-dev",
    listen: user.listen ?? [":443", ":80"],
    nameSource: user.nameSource ?? "folder",
    tld: user.tld ?? "localhost",
    domain: user.domain ?? undefined,
    failOnActiveDomain: user.failOnActiveDomain ?? true,
    insertFirst: user.insertFirst ?? true,
    verbose: user.verbose ?? false,
  };

  const log = (...args: unknown[]) => {
    if (opt.verbose) console.log("[vite-plugin-localcaddy]", ...args);
  };

  const warn = (...args: unknown[]) =>
    console.warn("[vite-plugin-localcaddy]", ...args);

  const err = (...args: unknown[]) =>
    console.error("[vite-plugin-localcaddy]", ...args);

  // ---------- HTTP helpers ----------
  async function req(url: string, init?: RequestInit): Promise<unknown> {
    const r = await fetch(url, init);
    const txt = await r.text();
    if (!r.ok) {
      throw new Error(
        `HTTP ${r.status} ${r.statusText} for ${url}\n${txt}`,
      );
    }
    return txt ? JSON.parse(txt) : undefined;
  }

  async function get(url: string): Promise<unknown> {
    const r = await fetch(url);
    if (!r.ok) return undefined;
    const t = await r.text();
    return t ? JSON.parse(t) : undefined;
  }

  const post = (url: string, body: unknown) =>
    req(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const put = (url: string, body: unknown) =>
    req(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // Note: del() not currently used but kept for API completeness
  const _del = async (url: string) => {
    const r = await fetch(url, { method: "DELETE" });
    if (!r.ok) {
      throw new Error(
        `HTTP ${r.status} ${r.statusText} for ${url}\n${await r.text()}`,
      );
    }
  };

  // Use exported utility functions
  const _computeDomain = () =>
    computeDomain({
      domain: opt.domain,
      nameSource: opt.nameSource,
      tld: opt.tld,
    });

  // ---------- Caddy bootstrap (HTTPS-first) ----------
  async function ensureCaddyServerExists(domain: string) {
    // If root config is null, seed both http+tls apps with internal issuer policy for this domain.
    const root = await get(`${opt.adminUrl}/config/`);
    if (root == null) {
      await post(`${opt.adminUrl}/load`, {
        apps: {
          http: {
            servers: {
              [opt.serverId]: {
                listen: opt.listen,
                routes: [],
              },
            },
          },
          tls: {
            automation: {
              policies: [
                {
                  subjects: [domain],
                  issuers: [{ module: "internal" }],
                },
              ],
            },
          },
        },
      });
      log(
        `Initialized Caddy config; server '${opt.serverId}' on ${
          opt.listen.join(", ")
        }; TLS internal for ${domain}`,
      );
      return;
    }

    // Ensure server exists (and listens on desired ports)
    const serverBase = `${opt.adminUrl}/config/apps/http/servers/${
      encodeURIComponent(opt.serverId)
    }`;
    const haveServer = await fetch(serverBase, { method: "GET" });
    if (!haveServer.ok) {
      // Create parents as needed, then server
      const ensurePath = async (p: string, payload: unknown) => {
        const r = await fetch(p, { method: "GET" });
        if (!r.ok) await put(p, payload);
      };

      await ensurePath(`${opt.adminUrl}/config/apps`, {});
      await ensurePath(`${opt.adminUrl}/config/apps/http`, { servers: {} });
      await ensurePath(`${opt.adminUrl}/config/apps/http/servers`, {});
      await put(serverBase, { listen: opt.listen, routes: [] });
      log(`Created server '${opt.serverId}' on ${opt.listen.join(", ")}`);
    } else {
      // Make sure desired ports are present
      const listenPath = `${serverBase}/listen`;
      const current = (await get(listenPath)) as string[] | undefined;
      const want = new Set(opt.listen);
      const next = Array.from(new Set([...(current ?? []), ...want]));
      if (!arraysEqual(current ?? [], next)) {
        await put(listenPath, next);
        log(`Updated '${opt.serverId}' listen → ${next.join(", ")}`);
      }

      // If automatic_https was previously disabled, re-enable by clearing/setting flag
      const autoPath = `${serverBase}/automatic_https`;
      const auto = (await get(autoPath)) as
        | { disable?: boolean }
        | undefined;
      if (auto?.disable === true) {
        await put(autoPath, { ...auto, disable: false });
        log(`Re-enabled automatic HTTPS on '${opt.serverId}'`);
      }
    }

    // Ensure TLS automation policy (internal issuer) exists for this domain
    await ensureTlsPolicy(domain);
  }

  async function ensureTlsPolicy(domain: string) {
    const ensurePath = async (p: string, payload: unknown) => {
      const r = await fetch(p, { method: "GET" });
      if (!r.ok) await put(p, payload);
    };

    await ensurePath(`${opt.adminUrl}/config/apps`, {});

    // Create bare tls app if needed (non-destructive to other apps)
    const tlsPath = `${opt.adminUrl}/config/apps/tls`;
    const haveTls = await fetch(tlsPath, { method: "GET" });
    if (!haveTls.ok) {
      await put(tlsPath, { automation: { policies: [] } });
    } else {
      // ensure automation/policies containers exist
      const autoPath = `${tlsPath}/automation`;
      const auto = await fetch(autoPath, { method: "GET" });
      if (!auto.ok) await put(autoPath, { policies: [] });

      const polPath = `${autoPath}/policies`;
      const pol = await fetch(polPath, { method: "GET" });
      if (!pol.ok) await put(polPath, []); // initialize array
    }

    // Check for an existing internal-policy that covers this exact domain
    const policies = ((await get(
      `${opt.adminUrl}/config/apps/tls/automation/policies`,
    )) as Array<{
      subjects?: string[];
      issuers?: Array<{ module?: string }>;
    }>) ?? [];

    const idx = policies.findIndex(
      (p) =>
        Array.isArray(p?.subjects) &&
        p.subjects.includes(domain) &&
        Array.isArray(p?.issuers) &&
        p.issuers.some((i) => i?.module === "internal"),
    );

    if (idx === -1) {
      await post(`${opt.adminUrl}/config/apps/tls/automation/policies`, {
        subjects: [domain],
        issuers: [{ module: "internal" }],
      });
      log(`Added TLS automation policy (internal) for ${domain}`);
    } else {
      log(`TLS automation policy already present for ${domain}`);
    }
  }

  async function getRoutes(): Promise<CaddyRoute[] | undefined> {
    return (await get(
      `${opt.adminUrl}/config/apps/http/servers/${
        encodeURIComponent(opt.serverId)
      }/routes`,
    )) as CaddyRoute[] | undefined;
  }

  async function addRoute(domain: string, port: number) {
    const route: CaddyRoute = {
      match: [{ host: [domain] }],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: `127.0.0.1:${port}` }],
        },
      ],
      terminal: true,
    };

    const base = `${opt.adminUrl}/config/apps/http/servers/${
      encodeURIComponent(opt.serverId)
    }/routes`;
    if (opt.insertFirst) {
      await put(`${base}/0`, route);
    } else {
      await post(base, route);
    }
  }

  async function replaceRouteAt(index: number, domain: string, port: number) {
    const base = `${opt.adminUrl}/config/apps/http/servers/${
      encodeURIComponent(opt.serverId)
    }/routes/${index}`;
    const updated: CaddyRoute = {
      match: [{ host: [domain] }],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: `127.0.0.1:${port}` }],
        },
      ],
      terminal: true,
    };
    await put(base, updated);
  }

  // ---------- /etc/hosts check for .local ----------
  function checkHostsForLocal(domain: string) {
    if (!domain.endsWith(".local")) return;

    try {
      const hosts = Deno.readTextFileSync("/etc/hosts");
      const present = hosts
        .split(/\r?\n/)
        .some((line) =>
          line.trim().startsWith("#")
            ? false
            : line.split(/\s+/).slice(1).includes(domain)
        );

      if (!present) {
        warn(
          `Missing /etc/hosts entry for ${domain}. Add it with:\n` +
            `    sudo bash -c "echo '127.0.0.1 ${domain}' >> /etc/hosts"`,
        );
      }
    } catch {
      warn(
        `Could not read /etc/hosts to verify ${domain}. If requests fail, add:\n` +
          `    sudo bash -c "echo '127.0.0.1 ${domain}' >> /etc/hosts"`,
      );
    }
  }

  // ---------- Main flow ----------
  async function wireDomain(server: {
    httpServer?: {
      address?: () => { port: number } | null;
    };
    close?: () => Promise<void>;
  }) {
    const addr = server.httpServer?.address?.();
    const vitePort = addr && typeof addr === "object" && "port" in addr
      ? addr.port
      : undefined;
    if (!vitePort) throw new Error("Unable to determine Vite dev server port");

    const domain = _computeDomain();

    // HTTPS-first bootstrap (server + TLS policy)
    await ensureCaddyServerExists(domain);

    // /etc/hosts check (for .local)
    checkHostsForLocal(domain);

    // Route management (stable domain, port reconciliation)
    const routes = await getRoutes();
    const { route, index } = findRouteByHost(routes, domain);

    if (!route) {
      await addRoute(domain, vitePort);
      printWhereToBrowse(domain);
      return;
    }

    const existingPort = extractUpstreamPort(route);
    if (!existingPort) {
      await replaceRouteAt(index, domain, vitePort);
      printWhereToBrowse(domain);
      return;
    }

    const active = await isPortActive(existingPort);
    if (active) {
      if (existingPort === vitePort) {
        printWhereToBrowse(domain);
        return;
      }

      const msg =
        `Domain '${domain}' is already mapped to active port ${existingPort}. ` +
        `Refusing to overwrite. Stop that service or choose a different domain.`;

      if (opt.failOnActiveDomain) {
        err(msg);
        try {
          await server.close?.();
        } catch {
          // ignore
        }
        Deno.exit(1);
      } else {
        warn(msg);
        return;
      }
    }

    if (existingPort !== vitePort) {
      await replaceRouteAt(index, domain, vitePort);
    }
    printWhereToBrowse(domain);
  }

  function printWhereToBrowse(domain: string) {
    const httpsPort = pickHttpsPort(opt.listen);
    const url = httpsPort && httpsPort !== 443
      ? `https://${domain}:${httpsPort}`
      : `https://${domain}`;
    console.log(
      `  ➜  ${bold("Domain")}: ${cyan(url)} ${dim("(via caddy)")}`,
    );
  }

  return {
    name: "vite-plugin-localcaddy",
    apply: "serve",
    // deno-lint-ignore no-explicit-any
    configureServer(server: any) {
      server.httpServer?.once("listening", () => {
        wireDomain(server).catch((e: Error) => {
          err("setup failed:", e.message || e);
        });
      });
    },
  };
}
