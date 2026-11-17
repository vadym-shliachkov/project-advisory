# Stack pack: WordPress

## Where to look

- Theme: `wp-content/themes/<theme>/` (`functions.php`, templates, and the `style.css` header for the theme name and version).
- Plugins: `wp-content/plugins/`; each plugin's version is in its main PHP file header.
- Core version: `wp-includes/version.php` (`$wp_version`) when core is in the repository.
- Config: `wp-config.php`. Never copy values from it; only note whether debug mode is on and whether the keys and salts look like defaults.

## Area notes

- security: `WP_DEBUG` set to true for production; `xmlrpc.php` reachable; outdated plugins and themes (`security.vulnerable-dependencies`); PHP below 8.1 (`security.eol-runtime`); `wp-config.php` committed with real credentials (`security.secret-in-repo`).
- hosting: backups (`hosting.no-backups`) and staging (`hosting.no-staging`) are often missing; check whether caching happens in a plugin or on the server.
- performance: page builders (Elementor, Divi, WPBakery) add heavy CSS and JavaScript (`performance.large-bundles`); many plugins load their assets on every page (`performance.render-blocking-resources`).
- architecture: business logic in theme templates instead of a plugin, and page-builder lock-in (`architecture.monolithic-theme`).
- privacy-legal: plugins that embed Google Fonts, YouTube or Maps (`privacy-legal.remote-google-fonts`, `privacy-legal.third-party-embeds`); consent plugins such as Complianz, Cookiebot or Borlabs.
- process-hygiene: the whole of WordPress core or `wp-content/uploads` committed (`process-hygiene.committed-build-artifacts`, `process-hygiene.large-binaries`).
