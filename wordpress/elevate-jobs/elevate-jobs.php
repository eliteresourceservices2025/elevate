<?php
/**
 * Plugin Name: ELEVATE Jobs
 * Description: Shows the open jobs from ELEVATE (Elite Resource Services) on your site with the [elevate_jobs] shortcode. The list is read from ELEVATE's public job feed, so a job opened or closed in ELEVATE shows here within a few minutes. Applying happens on ELEVATE: no applicant data ever passes through WordPress.
 * Version: 1.0.0
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * Author: Elite Resource Services
 * License: GPL-2.0-or-later
 * Text Domain: elevate-jobs
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Not loaded from WordPress.
}

define( 'ELEVATE_JOBS_OPTION', 'elevate_jobs_base_url' );
define( 'ELEVATE_JOBS_FRESH_SECONDS', 120 );   // How long a fetched list is used without asking ELEVATE again.
define( 'ELEVATE_JOBS_STALE_SECONDS', DAY_IN_SECONDS ); // How long the last good list is kept for when ELEVATE cannot be reached.

/**
 * The ELEVATE address from the settings, or an empty string: https only (http is accepted for localhost, for testing), no path,
 * no trailing slash.
 */
function elevate_jobs_base_url() {
	$value = get_option( ELEVATE_JOBS_OPTION, '' );
	return elevate_jobs_clean_base_url( is_string( $value ) ? $value : '' );
}

function elevate_jobs_clean_base_url( $raw ) {
	$raw   = trim( (string) $raw );
	$parts = wp_parse_url( $raw );
	if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
		return '';
	}
	$local = in_array( $parts['host'], array( 'localhost', '127.0.0.1' ), true );
	if ( 'https' !== $parts['scheme'] && ! ( 'http' === $parts['scheme'] && $local ) ) {
		return '';
	}
	$port = isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '';
	return $parts['scheme'] . '://' . $parts['host'] . $port;
}

/** Settings page: where ELEVATE is. */
function elevate_jobs_register_settings() {
	register_setting(
		'elevate_jobs',
		ELEVATE_JOBS_OPTION,
		array(
			'type'              => 'string',
			'sanitize_callback' => 'elevate_jobs_clean_base_url',
			'default'           => '',
		)
	);
}
add_action( 'admin_init', 'elevate_jobs_register_settings' );

function elevate_jobs_menu() {
	add_options_page( 'ELEVATE Jobs', 'ELEVATE Jobs', 'manage_options', 'elevate-jobs', 'elevate_jobs_settings_page' );
}
add_action( 'admin_menu', 'elevate_jobs_menu' );

function elevate_jobs_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	?>
	<div class="wrap">
		<h1>ELEVATE Jobs</h1>
		<form method="post" action="options.php">
			<?php settings_fields( 'elevate_jobs' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="elevate_jobs_base_url">ELEVATE address</label></th>
					<td>
						<input type="url" id="elevate_jobs_base_url" name="<?php echo esc_attr( ELEVATE_JOBS_OPTION ); ?>" value="<?php echo esc_attr( elevate_jobs_base_url() ); ?>" class="regular-text" placeholder="https://elevate.example.com" />
						<p class="description">The web address of your ELEVATE site, starting with https:// and without anything after the domain.</p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
		<h2>How to use it</h2>
		<p>Put <code>[elevate_jobs]</code> on any page or post. Options: <code>[elevate_jobs limit="5" summary="no"]</code> (show at most 5 jobs, without the short description).</p>
	</div>
	<?php
}

/**
 * The open jobs: from the saved copy when it is fresh, otherwise from ELEVATE; when ELEVATE cannot be reached, the last good copy.
 * Returns an array of jobs, or null when there is nothing to show.
 */
function elevate_jobs_fetch( $base ) {
	$key   = 'elevate_jobs_' . md5( $base );
	$fresh = get_transient( $key );
	if ( is_array( $fresh ) ) {
		return $fresh;
	}
	$response = wp_remote_get(
		$base . '/api/careers/jobs',
		array(
			'timeout'     => 8,
			'redirection' => 2,
			'headers'     => array( 'Accept' => 'application/json' ),
		)
	);
	if ( ! is_wp_error( $response ) && 200 === (int) wp_remote_retrieve_response_code( $response ) ) {
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( is_array( $data ) && isset( $data['jobs'] ) && is_array( $data['jobs'] ) ) {
			set_transient( $key, $data['jobs'], ELEVATE_JOBS_FRESH_SECONDS );
			set_transient( $key . '_stale', $data['jobs'], ELEVATE_JOBS_STALE_SECONDS );
			return $data['jobs'];
		}
	}
	$stale = get_transient( $key . '_stale' );
	return is_array( $stale ) ? $stale : null;
}

/** A job from the feed is shown only if it is complete and its link goes to the ELEVATE address (never to some other site). */
function elevate_jobs_valid( $job, $base ) {
	return is_array( $job )
		&& isset( $job['title'], $job['url'] )
		&& is_string( $job['title'] )
		&& is_string( $job['url'] )
		&& 0 === strpos( $job['url'], $base . '/' );
}

function elevate_jobs_shortcode( $atts ) {
	$atts = shortcode_atts(
		array(
			'limit'   => '20',
			'summary' => 'yes',
		),
		$atts,
		'elevate_jobs'
	);
	$base = elevate_jobs_base_url();
	if ( '' === $base ) {
		return current_user_can( 'manage_options' ) ? '<p>ELEVATE Jobs: set the ELEVATE address under Settings, ELEVATE Jobs.</p>' : '';
	}
	$limit = max( 1, min( 50, (int) $atts['limit'] ) );
	$jobs  = elevate_jobs_fetch( $base );
	if ( null === $jobs ) {
		return '<p class="elevate-jobs-unavailable">Open positions are listed at <a href="' . esc_url( $base . '/careers' ) . '" rel="noopener">' . esc_html( $base . '/careers' ) . '</a>.</p>';
	}
	$jobs = array_slice( array_values( array_filter( $jobs, function ( $job ) use ( $base ) {
		return elevate_jobs_valid( $job, $base );
	} ) ), 0, $limit );
	if ( empty( $jobs ) ) {
		return '<p class="elevate-jobs-empty">There are no open positions right now. Please check back soon.</p>';
	}

	$show_summary = 'no' !== strtolower( (string) $atts['summary'] );
	$html         = '<ul class="elevate-jobs">';
	foreach ( $jobs as $job ) {
		$location = isset( $job['location'] ) && is_string( $job['location'] ) ? $job['location'] : '';
		$pay      = isset( $job['payNote'] ) && is_string( $job['payNote'] ) ? $job['payNote'] : '';
		$summary  = isset( $job['summary'] ) && is_string( $job['summary'] ) ? $job['summary'] : '';
		$meta     = trim( $location . ( '' !== $pay ? ' · ' . $pay : '' ) );

		$html .= '<li class="elevate-job">';
		$html .= '<h3 class="elevate-job-title"><a href="' . esc_url( $job['url'] ) . '" rel="noopener">' . esc_html( $job['title'] ) . '</a></h3>';
		if ( '' !== $meta ) {
			$html .= '<p class="elevate-job-meta">' . esc_html( $meta ) . '</p>';
		}
		if ( $show_summary && '' !== $summary ) {
			$html .= '<p class="elevate-job-summary">' . esc_html( $summary ) . '</p>';
		}
		$html .= '<p class="elevate-job-apply"><a class="elevate-job-button" href="' . esc_url( $job['url'] ) . '" rel="noopener">Read more and apply</a></p>';
		$html .= '</li>';
	}
	$html .= '</ul>';
	return $html;
}
add_shortcode( 'elevate_jobs', 'elevate_jobs_shortcode' );

/** A little default styling, easy to override from the theme. */
function elevate_jobs_styles() {
	wp_register_style( 'elevate-jobs', false, array(), '1.0.0' );
	wp_enqueue_style( 'elevate-jobs' );
	wp_add_inline_style(
		'elevate-jobs',
		'.elevate-jobs{list-style:none;margin:0;padding:0}'
		. '.elevate-job{margin:0 0 1.25rem;padding:1rem 1.25rem;border:1px solid rgba(0,0,0,.12);border-radius:12px}'
		. '.elevate-job-title{margin:0 0 .25rem}'
		. '.elevate-job-meta{margin:0 0 .5rem;opacity:.75}'
		. '.elevate-job-button{display:inline-block;padding:.45rem .9rem;border-radius:8px;background:#6C1ABA;color:#fff;text-decoration:none}'
		. '.elevate-job-button:hover,.elevate-job-button:focus{background:#5a1599;color:#fff}'
	);
}
add_action( 'wp_enqueue_scripts', 'elevate_jobs_styles' );
