=== Opedd Widget ===
Contributors: opedd
Tags: licensing, content licensing, ai, widget, opedd
Requires at least: 5.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: MIT

Embed Opedd content licensing widgets on your WordPress site. License your content to human readers and AI companies.

== Description ==

The Opedd Widget plugin lets publishers embed licensing widgets directly into their WordPress posts and pages. Visitors can purchase content licenses (for human republication or AI training) through the Opedd Protocol.

Features:

* **Shortcode** — Use `[opedd_widget]` to place widgets anywhere
* **Auto-embed** — Optionally add the widget to every post automatically
* **3 display modes** — Card (full), Compact (single row), Badge (minimal pill)
* **Customizable** — Theme, color, position, button text
* **Auto-detect** — Widget automatically matches articles by page URL
* **Shadow DOM** — Widget styles are isolated and won't conflict with your theme

== Installation ==

1. Upload `opedd-widget.php` to the `/wp-content/plugins/` directory
2. Activate the plugin through the 'Plugins' menu in WordPress
3. Go to Settings > Opedd Widget
4. Enter your Publisher ID from your Opedd dashboard
5. Configure display options
6. Use `[opedd_widget]` in posts/pages, or enable auto-embed

== Shortcode Examples ==

`[opedd_widget]` — Auto-detect article by page URL
`[opedd_widget asset_id="uuid"]` — Specific article
`[opedd_widget mode="badge"]` — Badge display mode
`[opedd_widget theme="dark" color="#ff6600"]` — Custom styling
`[opedd_widget position="bottom-right"]` — Fixed overlay

== Changelog ==

= 1.0.0 =
* Initial release
* Shortcode support with all widget options
* Auto-embed on posts
* Settings page with Publisher ID, display mode, theme, color, position
