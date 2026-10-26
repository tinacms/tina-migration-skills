<?php
/**
 * Plugin Name: Tina test content model
 * Description: Custom post types and taxonomy for the wordpress-to-tinacms test site.
 *
 * `event` uses the block editor (show_in_rest: true).
 * `team_member` uses the classic editor (show_in_rest: false) and has no body,
 * so the admin tour exercises both editor paths.
 */

add_action( 'init', function () {
	register_post_type( 'event', array(
		'labels'       => array(
			'name'          => 'Events',
			'singular_name' => 'Event',
			'add_new_item'  => 'Add New Event',
		),
		'public'       => true,
		'show_in_rest' => true,
		'has_archive'  => true,
		'menu_icon'    => 'dashicons-calendar-alt',
		'supports'     => array( 'title', 'editor', 'excerpt', 'thumbnail' ),
	) );

	register_post_type( 'team_member', array(
		'labels'       => array(
			'name'          => 'Team',
			'singular_name' => 'Team Member',
			'add_new_item'  => 'Add New Team Member',
		),
		'public'       => true,
		'show_in_rest' => false,
		'menu_icon'    => 'dashicons-groups',
		'supports'     => array( 'title', 'thumbnail' ),
	) );

	register_taxonomy( 'event_type', array( 'event' ), array(
		'labels'            => array(
			'name'          => 'Event Types',
			'singular_name' => 'Event Type',
		),
		'hierarchical'      => true,
		'show_in_rest'      => true,
		'show_admin_column' => true,
	) );
} );
