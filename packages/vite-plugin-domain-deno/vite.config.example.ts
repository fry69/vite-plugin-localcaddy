// Example Vite configuration for Deno with vite-plugin-domain
//
// To use this configuration:
// 1. Make sure Caddy is running with admin API on http://127.0.0.1:2019
// 2. Run with: deno task dev --allow-read --allow-net --allow-write
//
// Note: This example assumes you're using Vite via npm in a Deno project

import { defineConfig } from "npm:vite@^5.0.0";
import domain from "./src/mod.ts"; // Or: "jsr:@your-scope/vite-plugin-domain-deno"

export default defineConfig({
  plugins: [
    domain({
      // Use default options - domain will be derived from folder name
      // Result: {folder-name}.local
      verbose: true, // Enable to see what's happening
    }),
  ],

  server: {
    // Required for .local domains to work with Vite
    allowedHosts: [".local"],

    // Optional: You can specify a port, or let Vite choose
    // port: 5173,
  },
});

// Example with custom domain
/*
export default defineConfig({
  plugins: [
    domain({
      domain: "myapp.local",        // Explicit domain
      tld: "local",                 // Or use "localhost"
      nameSource: "pkg",            // Use package.json name
      adminUrl: "http://127.0.0.1:2019",
      serverId: "vite-dev",
      listen: [":443", ":80"],
      failOnActiveDomain: true,
      insertFirst: true,
      verbose: true,
    }),
  ],
  server: {
    allowedHosts: [".local"],
  },
});
*/
