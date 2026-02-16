<?php
/**
 * Plugin Name: Opedd Widget
 * Plugin URI: https://opedd.com/docs/wordpress
 * Description: Embed Opedd content licensing widgets on your WordPress site. License your content to human readers and AI companies via the Opedd Protocol.
 * Version: 1.0.0
 * Author: Opedd
 * Author URI: https://opedd.com
 * License: MIT
 * Text Domain: opedd-widget
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OPEDD_VERSION', '1.0.0' );
define( 'OPEDD_WIDGET_URL', 'https://djdzcciayennqchjgybx.supabase.co/functions/v1/widget' );

// ============================================================
// Settings page
// ============================================================

add_action( 'admin_menu', 'opedd_add_settings_page' );
add_action( 'admin_init', 'opedd_register_settings' );

function opedd_add_settings_page() {
	add_options_page(
		'Opedd Widget Settings',
		'Opedd Widget',
		'manage_options',
		'opedd-widget',
		'opedd_render_settings_page'
	);
}

function opedd_register_settings() {
	register_setting( 'opedd_settings', 'opedd_publisher_id', array(
		'type'              => 'string',
		'sanitize_callback' => 'sanitize_text_field',
		'default'           => '',
	) );
	register_setting( 'opedd_settings', 'opedd_default_mode', array(
		'type'              => 'string',
		'sanitize_callback' => 'sanitize_text_field',
		'default'           => 'card',
	) );
	register_setting( 'opedd_settings', 'opedd_default_theme', array(
		'type'              => 'string',
		'sanitize_callback' => 'sanitize_text_field',
		'default'           => 'light',
	) );
	register_setting( 'opedd_settings', 'opedd_default_color', array(
		'type'              => 'string',
		'sanitize_callback' => 'sanitize_hex_color',
		'default'           => '#4A26ED',
	) );
	register_setting( 'opedd_settings', 'opedd_default_position', array(
		'type'              => 'string',
		'sanitize_callback' => 'sanitize_text_field',
		'default'           => 'inline',
	) );
	register_setting( 'opedd_settings', 'opedd_button_text', array(
		'type'              => 'string',
		'sanitize_callback' => 'sanitize_text_field',
		'default'           => 'License this content',
	) );
	register_setting( 'opedd_settings', 'opedd_frontend_url', array(
		'type'              => 'string',
		'sanitize_callback' => 'esc_url_raw',
		'default'           => 'https://opedd.com',
	) );
	register_setting( 'opedd_settings', 'opedd_auto_embed', array(
		'type'              => 'boolean',
		'sanitize_callback' => 'rest_sanitize_boolean',
		'default'           => false,
	) );
}

function opedd_render_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	?>
	<div class="wrap">
		<h1>Opedd Widget Settings</h1>
		<p>Configure how the Opedd licensing widget appears on your site. Get your Publisher ID from your <a href="https://opedd.com/settings" target="_blank">Opedd dashboard</a>.</p>

		<form method="post" action="options.php">
			<?php settings_fields( 'opedd_settings' ); ?>
			<table class="form-table">
				<tr>
					<th scope="row"><label for="opedd_publisher_id">Publisher ID</label></th>
					<td>
						<input type="text" id="opedd_publisher_id" name="opedd_publisher_id"
							value="<?php echo esc_attr( get_option( 'opedd_publisher_id' ) ); ?>"
							class="regular-text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
						<p class="description">Your Opedd publisher UUID. Found in Settings on your Opedd dashboard.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="opedd_default_mode">Display Mode</label></th>
					<td>
						<select id="opedd_default_mode" name="opedd_default_mode">
							<?php $mode = get_option( 'opedd_default_mode', 'card' ); ?>
							<option value="card" <?php selected( $mode, 'card' ); ?>>Card (full widget)</option>
							<option value="compact" <?php selected( $mode, 'compact' ); ?>>Compact (single row)</option>
							<option value="badge" <?php selected( $mode, 'badge' ); ?>>Badge (minimal pill)</option>
						</select>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="opedd_default_theme">Theme</label></th>
					<td>
						<select id="opedd_default_theme" name="opedd_default_theme">
							<?php $theme = get_option( 'opedd_default_theme', 'light' ); ?>
							<option value="light" <?php selected( $theme, 'light' ); ?>>Light</option>
							<option value="dark" <?php selected( $theme, 'dark' ); ?>>Dark</option>
						</select>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="opedd_default_color">Brand Color</label></th>
					<td>
						<input type="color" id="opedd_default_color" name="opedd_default_color"
							value="<?php echo esc_attr( get_option( 'opedd_default_color', '#4A26ED' ) ); ?>" />
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="opedd_default_position">Position</label></th>
					<td>
						<select id="opedd_default_position" name="opedd_default_position">
							<?php $pos = get_option( 'opedd_default_position', 'inline' ); ?>
							<option value="inline" <?php selected( $pos, 'inline' ); ?>>Inline (in content)</option>
							<option value="bottom-right" <?php selected( $pos, 'bottom-right' ); ?>>Fixed bottom-right</option>
							<option value="bottom-left" <?php selected( $pos, 'bottom-left' ); ?>>Fixed bottom-left</option>
						</select>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="opedd_button_text">Button Text</label></th>
					<td>
						<input type="text" id="opedd_button_text" name="opedd_button_text"
							value="<?php echo esc_attr( get_option( 'opedd_button_text', 'License this content' ) ); ?>"
							class="regular-text" />
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="opedd_frontend_url">Frontend URL</label></th>
					<td>
						<input type="url" id="opedd_frontend_url" name="opedd_frontend_url"
							value="<?php echo esc_attr( get_option( 'opedd_frontend_url', 'https://opedd.com' ) ); ?>"
							class="regular-text" />
						<p class="description">Your Opedd frontend URL for checkout links.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="opedd_auto_embed">Auto-embed on posts</label></th>
					<td>
						<input type="checkbox" id="opedd_auto_embed" name="opedd_auto_embed" value="1"
							<?php checked( get_option( 'opedd_auto_embed' ), true ); ?> />
						<label for="opedd_auto_embed">Automatically add widget at the end of every post (uses publisher auto-detect by URL)</label>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<hr />
		<h2>Shortcode Usage</h2>
		<p>Use the <code>[opedd_widget]</code> shortcode in any post or page:</p>
		<table class="widefat" style="max-width: 700px;">
			<thead>
				<tr><th>Example</th><th>Description</th></tr>
			</thead>
			<tbody>
				<tr>
					<td><code>[opedd_widget]</code></td>
					<td>Auto-detect article by page URL (requires Publisher ID above)</td>
				</tr>
				<tr>
					<td><code>[opedd_widget asset_id="xxx"]</code></td>
					<td>Show widget for a specific article/asset</td>
				</tr>
				<tr>
					<td><code>[opedd_widget mode="badge"]</code></td>
					<td>Override display mode (card, compact, badge)</td>
				</tr>
				<tr>
					<td><code>[opedd_widget theme="dark" color="#ff6600"]</code></td>
					<td>Custom theme and color</td>
				</tr>
				<tr>
					<td><code>[opedd_widget position="bottom-right"]</code></td>
					<td>Fixed position overlay</td>
				</tr>
			</tbody>
		</table>
	</div>
	<?php
}

// ============================================================
// Shortcode: [opedd_widget]
// ============================================================

add_shortcode( 'opedd_widget', 'opedd_widget_shortcode' );

function opedd_widget_shortcode( $atts ) {
	$atts = shortcode_atts( array(
		'asset_id'     => '',
		'publisher_id' => '',
		'mode'         => '',
		'theme'        => '',
		'color'        => '',
		'position'     => '',
		'text'         => '',
		'frontend_url' => '',
		'radius'       => '',
	), $atts, 'opedd_widget' );

	// Build data attributes
	$data_attrs = array();

	// Asset ID or publisher ID
	$asset_id = sanitize_text_field( $atts['asset_id'] );
	if ( $asset_id ) {
		$data_attrs[] = 'data-asset-id="' . esc_attr( $asset_id ) . '"';
	} else {
		$publisher_id = sanitize_text_field( $atts['publisher_id'] );
		if ( ! $publisher_id ) {
			$publisher_id = get_option( 'opedd_publisher_id' );
		}
		if ( $publisher_id ) {
			$data_attrs[] = 'data-publisher-id="' . esc_attr( $publisher_id ) . '"';
		} else {
			return '<!-- Opedd Widget: No asset_id or publisher_id configured -->';
		}
	}

	// Mode
	$mode = sanitize_text_field( $atts['mode'] ) ?: get_option( 'opedd_default_mode', 'card' );
	if ( $mode && $mode !== 'card' ) {
		$data_attrs[] = 'data-mode="' . esc_attr( $mode ) . '"';
	}

	// Theme
	$theme = sanitize_text_field( $atts['theme'] ) ?: get_option( 'opedd_default_theme', 'light' );
	if ( $theme && $theme !== 'light' ) {
		$data_attrs[] = 'data-theme="' . esc_attr( $theme ) . '"';
	}

	// Color
	$color = sanitize_text_field( $atts['color'] ) ?: get_option( 'opedd_default_color', '#4A26ED' );
	if ( $color && $color !== '#4A26ED' ) {
		$data_attrs[] = 'data-color="' . esc_attr( $color ) . '"';
	}

	// Position
	$position = sanitize_text_field( $atts['position'] ) ?: get_option( 'opedd_default_position', 'inline' );
	if ( $position && $position !== 'inline' ) {
		$data_attrs[] = 'data-position="' . esc_attr( $position ) . '"';
	}

	// Button text
	$text = sanitize_text_field( $atts['text'] ) ?: get_option( 'opedd_button_text', 'License this content' );
	if ( $text && $text !== 'License this content' ) {
		$data_attrs[] = 'data-text="' . esc_attr( $text ) . '"';
	}

	// Frontend URL
	$frontend_url = esc_url( $atts['frontend_url'] ) ?: get_option( 'opedd_frontend_url', 'https://opedd.com' );
	if ( $frontend_url ) {
		$data_attrs[] = 'data-frontend-url="' . esc_attr( $frontend_url ) . '"';
	}

	// Radius
	$radius = sanitize_text_field( $atts['radius'] );
	if ( $radius ) {
		$data_attrs[] = 'data-radius="' . esc_attr( $radius ) . '"';
	}

	$attrs_str = implode( ' ', $data_attrs );

	return '<script src="' . esc_url( OPEDD_WIDGET_URL ) . '" ' . $attrs_str . '></script>';
}

// ============================================================
// Auto-embed on single posts
// ============================================================

add_filter( 'the_content', 'opedd_auto_embed_widget' );

function opedd_auto_embed_widget( $content ) {
	if ( ! is_singular( 'post' ) ) {
		return $content;
	}

	if ( ! get_option( 'opedd_auto_embed' ) ) {
		return $content;
	}

	$publisher_id = get_option( 'opedd_publisher_id' );
	if ( ! $publisher_id ) {
		return $content;
	}

	$mode     = get_option( 'opedd_default_mode', 'card' );
	$theme    = get_option( 'opedd_default_theme', 'light' );
	$color    = get_option( 'opedd_default_color', '#4A26ED' );
	$position = get_option( 'opedd_default_position', 'inline' );
	$text     = get_option( 'opedd_button_text', 'License this content' );
	$frontend = get_option( 'opedd_frontend_url', 'https://opedd.com' );

	$data_attrs = 'data-publisher-id="' . esc_attr( $publisher_id ) . '"';
	$data_attrs .= ' data-frontend-url="' . esc_attr( $frontend ) . '"';

	if ( $mode !== 'card' )  $data_attrs .= ' data-mode="' . esc_attr( $mode ) . '"';
	if ( $theme !== 'light' ) $data_attrs .= ' data-theme="' . esc_attr( $theme ) . '"';
	if ( $color !== '#4A26ED' ) $data_attrs .= ' data-color="' . esc_attr( $color ) . '"';
	if ( $position !== 'inline' ) $data_attrs .= ' data-position="' . esc_attr( $position ) . '"';
	if ( $text !== 'License this content' ) $data_attrs .= ' data-text="' . esc_attr( $text ) . '"';

	$widget = '<div class="opedd-auto-widget" style="margin-top:2em;">'
		. '<script src="' . esc_url( OPEDD_WIDGET_URL ) . '" ' . $data_attrs . '></script>'
		. '</div>';

	return $content . $widget;
}
