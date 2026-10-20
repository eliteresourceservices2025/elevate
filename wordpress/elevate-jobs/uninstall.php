<?php
/**
 * Runs when the plugin is deleted: removes its setting and its saved job lists.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$elevate_jobs_base = get_option( 'elevate_jobs_base_url', '' );
if ( is_string( $elevate_jobs_base ) && '' !== $elevate_jobs_base ) {
	$elevate_jobs_key = 'elevate_jobs_' . md5( $elevate_jobs_base );
	delete_transient( $elevate_jobs_key );
	delete_transient( $elevate_jobs_key . '_stale' );
}
delete_option( 'elevate_jobs_base_url' );
