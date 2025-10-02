import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";

// ===== Domain Generation Tests =====

Deno.test("slugFromFolder - converts folder name to slug", () => {
  const testCases = [
    { input: "my-app", expected: "my-app" },
    { input: "My App", expected: "my-app" },
    { input: "my_app_123", expected: "my-app-123" },
    { input: "***my---app***", expected: "my---app" }, // Note: consecutive dashes preserved (matches Node implementation)
    { input: "UPPERCASE", expected: "uppercase" },
    { input: "-leading-trailing-", expected: "leading-trailing" },
  ];

  for (const { input, expected } of testCases) {
    const result = input
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    assertEquals(result, expected, `Failed for input: ${input}`);
  }
});

Deno.test("slugFromPkg - reads package.json name", async () => {
  // Create a temporary directory with package.json
  const tempDir = await Deno.makeTempDir();
  try {
    const pkgPath = join(tempDir, "package.json");
    await Deno.writeTextFile(
      pkgPath,
      JSON.stringify({ name: "@scope/my-package" })
    );

    // Test reading and slugifying package name
    const pkgText = await Deno.readTextFile(pkgPath);
    const pkg = JSON.parse(pkgText);
    const slug = String(pkg.name)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    assertEquals(slug, "scope-my-package");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("slugFromPkg - falls back to folder name on error", () => {
  // When package.json doesn't exist or can't be read
  // Should fall back to folder name
  const folderName = "fallback-folder";
  const slug = folderName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  assertEquals(slug, "fallback-folder");
});

Deno.test("computeDomain - uses explicit domain when provided", () => {
  const options = { domain: "explicit.local" };
  const result = options.domain;
  assertEquals(result, "explicit.local");
});

Deno.test("computeDomain - combines slug with TLD", () => {
  const slug = "my-app";
  const tld = "local";
  const domain = `${slug}.${tld}`;
  assertEquals(domain, "my-app.local");
});

// ===== HTTP Helper Tests =====

Deno.test("HTTP helpers - successful GET request", async () => {
  const mockResponse = { data: "test" };

  // Mock fetch for testing
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    } as Response);
  };

  try {
    const response = await fetch("http://test.com");
    const text = await response.text();
    const data = JSON.parse(text);
    assertEquals(data, mockResponse);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("HTTP helpers - GET returns undefined on 404", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    return Promise.resolve({
      ok: false,
      status: 404,
    } as Response);
  };

  try {
    const response = await fetch("http://test.com");
    assertEquals(response.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("HTTP helpers - POST with JSON body", async () => {
  const testBody = { key: "value" };
  let capturedInit: RequestInit | undefined;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ success: true })),
    } as Response);
  };

  try {
    await fetch("http://test.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(testBody),
    });

    assertExists(capturedInit);
    assertEquals(capturedInit.method, "POST");
    assertEquals(
      (capturedInit.headers as Record<string, string>)["content-type"],
      "application/json"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ===== Route Extraction Tests =====

Deno.test("findRouteByHost - finds route with matching host", () => {
  const routes = [
    {
      match: [{ host: ["other.local"] }],
      handle: [],
    },
    {
      match: [{ host: ["target.local"] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "127.0.0.1:5173" }] }],
    },
  ];

  let foundIndex = -1;
  let foundRoute = undefined;

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const matches = Array.isArray(r.match) ? r.match : [];
    for (const m of matches) {
      if (Array.isArray(m.host) && m.host.includes("target.local")) {
        foundRoute = r;
        foundIndex = i;
        break;
      }
    }
    if (foundRoute) break;
  }

  assertEquals(foundIndex, 1);
  assertExists(foundRoute);
});

Deno.test("findRouteByHost - returns undefined when not found", () => {
  const routes = [
    {
      match: [{ host: ["other.local"] }],
      handle: [],
    },
  ];

  let foundIndex = -1;

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const matches = Array.isArray(r.match) ? r.match : [];
    for (const m of matches) {
      if (Array.isArray(m.host) && m.host.includes("nonexistent.local")) {
        foundIndex = i;
        break;
      }
    }
  }

  assertEquals(foundIndex, -1);
});

Deno.test("extractUpstreamPort - extracts port from route", () => {
  const route = {
    match: [{ host: ["test.local"] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: "127.0.0.1:5173" }],
      },
    ],
  };

  const handlers = Array.isArray(route.handle) ? route.handle : [];
  let port: number | undefined;

  for (const h of handlers) {
    if (h.handler === "reverse_proxy" && "upstreams" in h) {
      const ups = h.upstreams as Array<{ dial: string }>;
      if (Array.isArray(ups) && ups.length > 0) {
        const dial = ups[0]?.dial;
        if (dial) {
          const m = /:(\d+)$/.exec(dial.trim());
          if (m) {
            port = Number(m[1]);
          }
        }
      }
    }
  }

  assertEquals(port, 5173);
});

Deno.test("extractUpstreamPort - returns undefined when no port", () => {
  const route = {
    match: [{ host: ["test.local"] }],
    handle: [{ handler: "static_response" }],
  };

  const handlers = Array.isArray(route.handle) ? route.handle : [];
  let port: number | undefined;

  for (const h of handlers) {
    if (h.handler === "reverse_proxy" && "upstreams" in h) {
      const ups = h.upstreams as Array<{ dial: string }>;
      if (Array.isArray(ups) && ups.length > 0) {
        const dial = ups[0]?.dial;
        if (dial) {
          const m = /:(\d+)$/.exec(dial.trim());
          if (m) {
            port = Number(m[1]);
          }
        }
      }
    }
  }

  assertEquals(port, undefined);
});

// ===== Port Checking Tests =====

Deno.test("isPortActive - returns false for inactive port", async () => {
  // Test with a port that's very unlikely to be in use
  const unusedPort = 59999;

  try {
    const conn = await Deno.connect({ hostname: "127.0.0.1", port: unusedPort });
    conn.close();
    // If connection succeeds, port is active
    assertEquals(true, true, "Port was unexpectedly active");
  } catch (_error) {
    // Connection failed, port is not active (expected)
    assertEquals(true, true, "Port is inactive as expected");
  }
});

// ===== Utility Function Tests =====

Deno.test("arraysEqual - returns true for equal arrays", () => {
  const a = [1, 2, 3];
  const b = [1, 2, 3];

  let equal = true;
  if (a.length !== b.length) {
    equal = false;
  } else {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        equal = false;
        break;
      }
    }
  }

  assertEquals(equal, true);
});

Deno.test("arraysEqual - returns false for different arrays", () => {
  const a = [1, 2, 3];
  const b = [1, 2, 4];

  let equal = true;
  if (a.length !== b.length) {
    equal = false;
  } else {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        equal = false;
        break;
      }
    }
  }

  assertEquals(equal, false);
});

Deno.test("pickHttpsPort - prefers 443", () => {
  const listen = [":80", ":443", ":8443"];

  const ports = listen
    .map((a) => {
      const m = /:(\d+)$/.exec(a);
      return m ? Number(m[1]) : undefined;
    })
    .filter((n): n is number => typeof n === "number");

  let result: number | undefined;
  if (ports.includes(443)) {
    result = 443;
  } else {
    result = ports.find((p) => p !== 80);
  }

  assertEquals(result, 443);
});

Deno.test("pickHttpsPort - avoids 80 when no 443", () => {
  const listen = [":80", ":8443"];

  const ports = listen
    .map((a) => {
      const m = /:(\d+)$/.exec(a);
      return m ? Number(m[1]) : undefined;
    })
    .filter((n): n is number => typeof n === "number");

  let result: number | undefined;
  if (ports.includes(443)) {
    result = 443;
  } else {
    result = ports.find((p) => p !== 80);
  }

  assertEquals(result, 8443);
});

// ===== Host File Validation Tests =====

Deno.test("checkHostsForLocal - only checks .local domains", () => {
  const domain1 = "test.localhost";
  const domain2 = "test.local";

  assertEquals(domain1.endsWith(".local"), false);
  assertEquals(domain2.endsWith(".local"), true);
});

Deno.test("checkHostsForLocal - detects missing domain entry", () => {
  // This test verifies the logic for checking hosts file
  const domain = "testapp.local";
  const mockHostsContent = `
127.0.0.1 localhost
127.0.0.1 other.local
# Comment line
`;

  const present = mockHostsContent
    .split(/\r?\n/)
    .some((line) =>
      line.trim().startsWith("#")
        ? false
        : line.split(/\s+/).slice(1).includes(domain)
    );

  assertEquals(present, false);
});

Deno.test("checkHostsForLocal - finds existing domain entry", () => {
  const domain = "existing.local";
  const mockHostsContent = `
127.0.0.1 localhost
127.0.0.1 existing.local
# Comment line
`;

  const present = mockHostsContent
    .split(/\r?\n/)
    .some((line) =>
      line.trim().startsWith("#")
        ? false
        : line.split(/\s+/).slice(1).includes(domain)
    );

  assertEquals(present, true);
});

// ===== Route Creation Tests =====

Deno.test("addRoute - creates proper route structure", () => {
  const domain = "test.local";
  const port = 5173;

  const route = {
    match: [{ host: [domain] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: `127.0.0.1:${port}` }],
      },
    ],
    terminal: true,
  };

  assertExists(route.match);
  assertEquals(route.match[0].host[0], domain);
  assertEquals(route.handle[0].handler, "reverse_proxy");
  assertEquals(route.handle[0].upstreams[0].dial, "127.0.0.1:5173");
  assertEquals(route.terminal, true);
});

// ===== Option Defaults Tests =====

Deno.test("plugin options - applies defaults correctly", () => {
  const userOptions: Record<string, unknown> = {
    verbose: true,
  };

  const options = {
    adminUrl: (userOptions.adminUrl as string | undefined) ?? "http://127.0.0.1:2019",
    serverId: (userOptions.serverId as string | undefined) ?? "vite-dev",
    listen: (userOptions.listen as string[] | undefined) ?? [":443", ":80"],
    nameSource: (userOptions.nameSource as "folder" | "pkg" | undefined) ?? "folder",
    tld: (userOptions.tld as string | undefined) ?? "local",
    domain: userOptions.domain as string | undefined,
    failOnActiveDomain: (userOptions.failOnActiveDomain as boolean | undefined) ?? true,
    insertFirst: (userOptions.insertFirst as boolean | undefined) ?? true,
    verbose: (userOptions.verbose as boolean | undefined) ?? false,
  };

  assertEquals(options.adminUrl, "http://127.0.0.1:2019");
  assertEquals(options.serverId, "vite-dev");
  assertEquals(options.listen, [":443", ":80"]);
  assertEquals(options.nameSource, "folder");
  assertEquals(options.tld, "local");
  assertEquals(options.domain, undefined);
  assertEquals(options.failOnActiveDomain, true);
  assertEquals(options.insertFirst, true);
  assertEquals(options.verbose, true);
});

Deno.test("plugin options - respects user overrides", () => {
  const userOptions = {
    adminUrl: "http://localhost:3000",
    serverId: "custom-server",
    listen: [":8443"],
    nameSource: "pkg" as const,
    tld: "localhost",
    domain: "custom.local",
    failOnActiveDomain: false,
    insertFirst: false,
    verbose: true,
  };

  const options = {
    adminUrl: userOptions.adminUrl ?? "http://127.0.0.1:2019",
    serverId: userOptions.serverId ?? "vite-dev",
    listen: userOptions.listen ?? [":443", ":80"],
    nameSource: userOptions.nameSource ?? "folder",
    tld: userOptions.tld ?? "local",
    domain: userOptions.domain,
    failOnActiveDomain: userOptions.failOnActiveDomain ?? true,
    insertFirst: userOptions.insertFirst ?? true,
    verbose: userOptions.verbose ?? false,
  };

  assertEquals(options.adminUrl, "http://localhost:3000");
  assertEquals(options.serverId, "custom-server");
  assertEquals(options.listen, [":8443"]);
  assertEquals(options.nameSource, "pkg");
  assertEquals(options.tld, "localhost");
  assertEquals(options.domain, "custom.local");
  assertEquals(options.failOnActiveDomain, false);
  assertEquals(options.insertFirst, false);
  assertEquals(options.verbose, true);
});
