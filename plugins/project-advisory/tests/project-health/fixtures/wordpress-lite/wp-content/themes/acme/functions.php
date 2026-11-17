<?php
add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('acme', get_stylesheet_uri());
});
