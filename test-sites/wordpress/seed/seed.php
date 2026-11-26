<?php
/**
 * Seed content for the wordpress-to-tinacms test site.
 * Run with: wp eval-file /seed/seed.php
 */

if ( get_option( 'tina_test_seeded' ) ) {
	WP_CLI::success( 'Already seeded — skipping.' );
	return;
}

// ACF field groups — same code path as ACF → Tools → Import, so they land in the DB like UI-created groups.
$groups = json_decode( file_get_contents( '/seed/acf-field-groups.json' ), true );
foreach ( $groups as $group ) {
	acf_import_field_group( $group );
}

// One placeholder image for featured images / headshots.
require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
$tmp = wp_tempnam( 'tina-placeholder.png' );
$img = imagecreatetruecolor( 800, 450 );
imagefill( $img, 0, 0, imagecolorallocate( $img, 204, 65, 65 ) );
imagepng( $img, $tmp );
$image_id = media_handle_sideload( array( 'name' => 'tina-placeholder.png', 'tmp_name' => $tmp ), 0, 'Placeholder' );

// Taxonomy terms.
$news     = wp_insert_term( 'News', 'category' )['term_id'];
$releases = wp_insert_term( 'Releases', 'category' )['term_id'];
$conf     = wp_insert_term( 'Conference', 'event_type' )['term_id'];
$meetup   = wp_insert_term( 'Meetup', 'event_type' )['term_id'];

function tina_yoast( $id, $title, $desc, $noindex = false ) {
	update_post_meta( $id, '_yoast_wpseo_title', $title );
	update_post_meta( $id, '_yoast_wpseo_metadesc', $desc );
	if ( $noindex ) {
		update_post_meta( $id, '_yoast_wpseo_meta-robots-noindex', '1' );
	}
}

// Posts.
$post1 = wp_insert_post( array(
	'post_type'     => 'post',
	'post_status'   => 'publish',
	'post_title'    => 'Hello from the test site',
	'post_excerpt'  => 'A short excerpt for the first post.',
	'post_content'  => "<!-- wp:paragraph -->\n<p>This post exists so the migration has <strong>something</strong> to move.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">A heading</h2>\n<!-- /wp:heading -->\n\n<!-- wp:list -->\n<ul class=\"wp-block-list\"><li>One</li><li>Two</li></ul>\n<!-- /wp:list -->",
	'post_category' => array( $news ),
	'tags_input'    => array( 'tinacms', 'astro' ),
) );
set_post_thumbnail( $post1, $image_id );
tina_yoast( $post1, 'Hello from the test site | Tina WP Test', 'The first post on the test site.' );

wp_insert_post( array(
	'post_type'     => 'post',
	'post_status'   => 'publish',
	'post_title'    => 'Release notes 1.0',
	'post_content'  => "<!-- wp:paragraph -->\n<p>Version 1.0 is out.</p>\n<!-- /wp:paragraph -->",
	'post_category' => array( $releases ),
	'tags_input'    => array( 'release' ),
) );

wp_insert_post( array(
	'post_type'   => 'post',
	'post_status' => 'draft',
	'post_title'  => 'Unfinished draft',
	'post_content' => '<p>Drafts should be skipped unless the user asks.</p>',
) );

// Pages.
$about = wp_insert_post( array(
	'post_type'    => 'page',
	'post_status'  => 'publish',
	'post_title'   => 'About us',
	'post_content' => "<!-- wp:paragraph -->\n<p>We build things.</p>\n<!-- /wp:paragraph -->",
) );
update_field( 'field_tina_hero_heading', 'About the team', $about );
update_field( 'field_tina_hero_subheading', 'Thirty years of building software.', $about );
update_field( 'field_tina_hero_cta', array( 'title' => 'Get in touch', 'url' => 'https://example.test/contact', 'target' => '' ), $about );
update_field( 'field_tina_hero_background', $image_id, $about );
update_field( 'field_tina_hero_colour', '#333333', $about );
tina_yoast( $about, 'About us | Tina WP Test', 'Who we are and what we do.' );

$thanks = wp_insert_post( array(
	'post_type'    => 'page',
	'post_status'  => 'publish',
	'post_title'   => 'Thank you',
	'post_content' => '<p>Thanks for your enquiry.</p>',
) );
tina_yoast( $thanks, '', '', true );

// Team members (classic editor, no body).
$team = array();
foreach ( array(
	array( 'Ada Lovelace', 'Principal Engineer', array( 'dotnet', 'ai' ) ),
	array( 'Grace Hopper', 'Solution Architect', array( 'azure', 'react' ) ),
) as list( $name, $role, $skills ) ) {
	$id = wp_insert_post( array( 'post_type' => 'team_member', 'post_status' => 'publish', 'post_title' => $name ) );
	update_field( 'field_tina_team_role', $role, $id );
	update_field( 'field_tina_team_bio', "$name is a $role.", $id );
	update_field( 'field_tina_team_headshot', $image_id, $id );
	update_field( 'field_tina_team_email', strtolower( strtok( $name, ' ' ) ) . '@example.test', $id );
	update_field( 'field_tina_team_skills', $skills, $id );
	update_field( 'field_tina_team_started', '20150601', $id );
	update_field( 'field_tina_team_pin', '1234', $id );
	$team[] = $id;
}

// Events (block editor + ACF + custom taxonomy).
foreach ( array(
	array( 'TinaCMS Conf 2026', $conf, 'hybrid', '2026-11-20 09:00:00', 'Main Hall', 0, false ),
	array( 'Astro Meetup Sydney', $meetup, 'in-person', '2026-12-03 18:00:00', 'Level 1, 81 Military Rd', 0, true ),
) as list( $title, $type, $format, $start, $venue, $price, $free ) ) {
	$id = wp_insert_post( array(
		'post_type'    => 'event',
		'post_status'  => 'publish',
		'post_title'   => $title,
		'post_excerpt' => "Join us for $title.",
		'post_content' => "<!-- wp:paragraph -->\n<p>Event description for $title.</p>\n<!-- /wp:paragraph -->",
	) );
	wp_set_object_terms( $id, array( $type ), 'event_type' );
	set_post_thumbnail( $id, $image_id );
	update_field( 'field_tina_event_start', $start, $id );
	update_field( 'field_tina_event_format', $format, $id );
	update_field( 'field_tina_event_venue', $venue, $id );
	update_field( 'field_tina_event_location', array( 'field_tina_event_address' => '81 Military Rd', 'field_tina_event_city' => 'Neutral Bay' ), $id );
	update_field( 'field_tina_event_tickets', 'https://example.test/tickets', $id );
	update_field( 'field_tina_event_price', $price, $id );
	update_field( 'field_tina_event_free', $free, $id );
	update_field( 'field_tina_event_speakers', $team, $id );
	update_field( 'field_tina_event_agenda', '<ul><li>Welcome</li><li>Talks</li><li>Drinks</li></ul>', $id );
	tina_yoast( $id, "$title | Events", "Details for $title." );
}

update_option( 'tina_test_seeded', 1 );
WP_CLI::success( 'Seeded test content.' );
