// Example Vite configuration for Deno with vite-plugin-localcaddy
//
// Prerequisites:
// 1. Install the plugin: deno install jsr:@fry69/vite-plugin-localcaddy
// 2. Make sure Caddy is running: caddy run
// 3. Trust Caddy's CA (one-time): sudo caddy trust
//
// Run with: deno task dev
//
// Note: Import aliases below require deno.json with imports configured:
// {
//   "imports": {
//     "vite": "npm:vite@^7",
//     "vite-plugin-localcaddy": "jsr:@fry69/vite-plugin-localcaddy@^0.1"
//   }
// }

import { defineConfig } from "vite";
import domain from "@fry69/vite-plugin-localcaddy";

// Simple configuration using defaults
// Domain will be derived from folder name with .localhost TLD
// Example: if folder is "my-app" → https://my-app.localhost
export default defineConfig({
  plugins: [
    domain({
      verbose: true, // Enable to see what's happening during setup
    }),
  ],
});

// ===== Alternative Configurations =====

// 1. Explicit domain name
/*
export default defineConfig({
  plugins: [
    domain({
      domain: "frontend.localhost",  // Specify exact domain
      verbose: true,
    }),
  ],
});
*/

// 2. Use package.json name instead of folder name
/*
export default defineConfig({
  plugins: [
    domain({
      nameSource: "pkg",  // Use "name" field from package.json
      verbose: true,
    }),
  ],
});
*/

// 3. Use .local TLD (not recommended - requires /etc/hosts setup)
/*
export default defineConfig({
  plugins: [
    domain({
      tld: "local",
      verbose: true,
    }),
  ],
  server: {
    allowedHosts: [".local"],  // Required for .local domains
  },
});
*/

// 4. Full configuration with all options
/*
export default defineConfig({
  plugins: [
    domain({
      adminUrl: "http://127.0.0.1:2019",  // Caddy admin API endpoint
      serverId: "vite-dev",               // Caddy server identifier
      listen: [":443", ":80"],            // Ports Caddy listens on
      nameSource: "folder",               // "folder" or "pkg"
      tld: "localhost",                   // Top-level domain
      domain: "myapp.localhost",          // Override auto-naming (optional)
      failOnActiveDomain: true,           // Fail if domain has active route
      insertFirst: true,                  // Insert route at beginning
      verbose: true,                      // Enable detailed logging
    }),
  ],
});
*/
