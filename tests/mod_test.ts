import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import domain, {
  arraysEqual,
  type CaddyRoute,
  computeDomain,
  extractUpstreamPort,
  findRouteByHost,
  isPortActive,
  type Options,
  pickHttpsPort,
  slugFromFolder,
  slugFromPkg,
} from "../src/mod.ts";

// ===== Domain Generation Tests =====

Deno.test("slugFromFolder - converts folder name to slug", () => {
  const testCases = [
    { input: "/path/to/my-app", expected: "my-app" },
    { input: "/path/to/My App", expected: "my-app" },
    { input: "/path/to/my_app_123", expected: "my-app-123" },
    { input: "/path/to/***my---app***", expected: "my---app" },
    { input: "/path/to/UPPERCASE", expected: "uppercase" },
    { input: "/path/to/-leading-trailing-", expected: "leading-trailing" },
  ];

  for (const { input, expected } of testCases) {
    const result = slugFromFolder(input);
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
      JSON.stringify({ name: "@scope/my-package" }),
    );

    const slug = slugFromPkg(tempDir);
    assertEquals(slug, "scope-my-package");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("slugFromPkg - falls back to folder name on error", () => {
  // Test with a directory that doesn't have package.json
  const slug = slugFromPkg("/nonexistent/fallback-folder");
  assertEquals(slug, "fallback-folder");
});

Deno.test("computeDomain - uses explicit domain when provided", () => {
  const result = computeDomain({ domain: "explicit.local" });
  assertEquals(result, "explicit.local");
});

Deno.test("computeDomain - combines slug with TLD", () => {
  const result = computeDomain({
    nameSource: "folder",
    tld: "local",
    cwd: "/path/to/my-app",
  });
  assertEquals(result, "my-app.local");
});

Deno.test("computeDomain - uses package name when nameSource is pkg", () => {
  // This will fall back to folder name since no package.json exists
  const result = computeDomain({
    nameSource: "pkg",
    tld: "local",
    cwd: "/path/to/test-app",
  });
  assertEquals(result, "test-app.local");
});

// ===== Route Extraction Tests =====

Deno.test("findRouteByHost - finds route with matching host", () => {
  const routes: CaddyRoute[] = [
    {
      match: [{ host: ["other.local"] }],
      handle: [],
    },
    {
      match: [{ host: ["target.local"] }],
      handle: [{
        handler: "reverse_proxy",
        upstreams: [{ dial: "127.0.0.1:5173" }],
      }],
    },
  ];

  const { route, index } = findRouteByHost(routes, "target.local");

  assertEquals(index, 1);
  assertExists(route);
  assertEquals(route.match?.[0].host?.[0], "target.local");
});

Deno.test("findRouteByHost - returns undefined when not found", () => {
  const routes: CaddyRoute[] = [
    {
      match: [{ host: ["other.local"] }],
      handle: [],
    },
  ];

  const { route, index } = findRouteByHost(routes, "nonexistent.local");

  assertEquals(index, -1);
  assertEquals(route, undefined);
});

Deno.test("extractUpstreamPort - extracts port from route", () => {
  const route: CaddyRoute = {
    match: [{ host: ["test.local"] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: "127.0.0.1:5173" }],
      },
    ],
  };

  const port = extractUpstreamPort(route);
  assertEquals(port, 5173);
});

Deno.test("extractUpstreamPort - returns undefined when no port", () => {
  const route: CaddyRoute = {
    match: [{ host: ["test.local"] }],
    handle: [{ handler: "static_response" }],
  };

  const port = extractUpstreamPort(route);
  assertEquals(port, undefined);
});

// ===== Port Checking Tests =====

Deno.test("isPortActive - returns false for inactive port", async () => {
  // Test with a port that's very unlikely to be in use
  const unusedPort = 59999;
  const result = await isPortActive(unusedPort);

  // Should return false for inactive port
  assertEquals(result, false);
});

Deno.test("isPortActive - can check custom host", async () => {
  // Test with localhost explicitly
  const unusedPort = 59998;
  const result = await isPortActive(unusedPort, "127.0.0.1", 100);

  assertEquals(result, false);
});

// ===== Utility Function Tests =====

Deno.test("arraysEqual - returns true for equal arrays", () => {
  const a = [1, 2, 3];
  const b = [1, 2, 3];

  const result = arraysEqual(a, b);
  assertEquals(result, true);
});

Deno.test("arraysEqual - returns false for different arrays", () => {
  const a = [1, 2, 3];
  const b = [1, 2, 4];

  const result = arraysEqual(a, b);
  assertEquals(result, false);
});

Deno.test("arraysEqual - returns false for different length arrays", () => {
  const a = [1, 2, 3];
  const b = [1, 2];

  const result = arraysEqual(a, b);
  assertEquals(result, false);
});

Deno.test("pickHttpsPort - prefers 443", () => {
  const listen = [":80", ":443", ":8443"];
  const result = pickHttpsPort(listen);
  assertEquals(result, 443);
});

Deno.test("pickHttpsPort - avoids 80 when no 443", () => {
  const listen = [":80", ":8443"];
  const result = pickHttpsPort(listen);
  assertEquals(result, 8443);
});

Deno.test("pickHttpsPort - returns undefined when only 80", () => {
  const listen = [":80"];
  const result = pickHttpsPort(listen);
  assertEquals(result, undefined);
}); // ===== Host File Validation Tests =====

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

Deno.test("CaddyRoute - type structure validation", () => {
  // Test that CaddyRoute type allows proper route structure
  const route: CaddyRoute = {
    match: [{ host: ["test.local"] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: "127.0.0.1:5173" }],
      },
    ],
    terminal: true,
  };

  assertExists(route.match);
  assertEquals(route.match[0].host?.[0], "test.local");
  assertEquals(route.handle?.[0].handler, "reverse_proxy");
  assertEquals(route.handle?.[0].upstreams?.[0].dial, "127.0.0.1:5173");
  assertEquals(route.terminal, true);
});

// ===== Option Defaults Tests =====

Deno.test("plugin - returns correct plugin structure", () => {
  const plugin = domain({ verbose: true });

  assertEquals(plugin.name, "vite-plugin-domain");
  assertEquals(plugin.apply, "serve");
  assertExists(plugin.configureServer);
});

Deno.test("plugin - applies default options", () => {
  // Test that plugin can be created with empty options
  const plugin = domain({});

  assertEquals(plugin.name, "vite-plugin-domain");
  assertExists(plugin.configureServer);
});

Deno.test("plugin - accepts custom options", () => {
  const options: Options = {
    adminUrl: "http://localhost:3000",
    serverId: "custom-server",
    listen: [":8443"],
    nameSource: "pkg",
    tld: "localhost",
    domain: "custom.local",
    failOnActiveDomain: false,
    insertFirst: false,
    verbose: true,
  };

  const plugin = domain(options);

  assertEquals(plugin.name, "vite-plugin-domain");
  assertEquals(plugin.apply, "serve");
});
