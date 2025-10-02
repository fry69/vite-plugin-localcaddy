import { basename, join } from "@std/path";
import { bold, cyan, dim } from "@std/fmt/colors";

// Vite Plugin type (defined locally since vite is not a Deno dependency)
// deno-lint-ignore no-explicit-any
type Plugin = any;

type Options = {
  /** Caddy Admin API base URL */
  adminUrl?: string;
  /** Caddy apps.http server id to use/create */
  serverId?: string;
  /** Addresses for the dev server we manage in Caddy */
  listen?: string[];
  /**
   * Choose the subdomain source (before the TLD) when no explicit `domain` is given:
   *    - 'folder' (default): use current folder name
   *    - 'pkg': use package.json "name"
   */
  nameSource?: "folder" | "pkg";
  /** Top-level domain (TLD) to use when building the domain (ignored if `domain` is set) */
  tld?: string;
  /**
   * Fully explicit domain to use (e.g., 'myapp.local' or 'myapp.localhost').
   * If provided, overrides nameSource+tld.
   */
  domain?: string;
  /**
   * If an existing domain points to an active port that is NOT the current Vite port:
   *    - true (default): fail fast & explain
   *    - false: leave it alone and continue (no changes)
   */
  failOnActiveDomain?: boolean;
  /**
   * Insert the route at index 0 (before others) when creating a new one.
   * Default: true
   */
  insertFirst?: boolean;
  /** Print logs. Default: false */
  verbose?: boolean;
};

type InternalOptions = {
  adminUrl: string;
  serverId: string;
  listen: string[];
  nameSource: "folder" | "pkg";
  tld: string;
  domain: string | undefined;
  failOnActiveDomain: boolean;
  insertFirst: boolean;
  verbose: boolean;
};

type CaddyRoute = {
  match?: Array<{ host?: string[] }>;
  handle?: Array<{ handler: string; upstreams?: Array<{ dial: string }> }>;
  terminal?: boolean;
};

// Export types for testing
export type { CaddyRoute, Options };

// Exported utility functions for testing
export function slugFromFolder(cwd?: string): string {
  const dir = cwd ?? Deno.cwd();
  return basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

export function computeDomain(options: {
  domain?: string;
  nameSource?: "folder" | "pkg";
  tld?: string;
  cwd?: string;
}): string {
  if (options.domain) return options.domain;
  const nameSource = options.nameSource ?? "folder";
  const tld = options.tld ?? "local";
  const cwd = options.cwd;
  const base = nameSource === "pkg" ? slugFromPkg(cwd) : slugFromFolder(cwd);
  return `${base}.${tld}`;
}

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

export function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

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

export default function domain(user: Options = {}): Plugin {
  const opt: InternalOptions = {
    adminUrl: user.adminUrl ?? "http://127.0.0.1:2019",
    serverId: user.serverId ?? "vite-dev",
    listen: user.listen ?? [":443", ":80"],
    nameSource: user.nameSource ?? "folder",
    tld: user.tld ?? "local",
    domain: user.domain ?? undefined,
    failOnActiveDomain: user.failOnActiveDomain ?? true,
    insertFirst: user.insertFirst ?? true,
    verbose: user.verbose ?? false,
  };

  const log = (...args: unknown[]) => {
    if (opt.verbose) console.log("[vite-plugin-domain]", ...args);
  };

  const warn = (...args: unknown[]) =>
    console.warn("[vite-plugin-domain]", ...args);

  const err = (...args: unknown[]) =>
    console.error("[vite-plugin-domain]", ...args);

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
    name: "vite-plugin-domain",
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
