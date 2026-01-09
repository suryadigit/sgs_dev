<?php
/**
 * ============================================
 * SGS BACKEND INTEGRATION FOR WORDPRESS/SLICEWP
 * ============================================
 * 
 * Tambahkan kode ini ke functions.php theme Anda
 * atau buat sebagai plugin terpisah.
 * 
 * Endpoints:
 * - POST /sgs/v1/create-affiliate
 * - POST /sgs/v1/create-commission  
 * - GET  /sgs/v1/get-commissions
 * - GET  /sgs/v1/check-cookie
 * - POST /sgs/v1/set-affiliate-parent
 */

// ============================================
// API: CREATE SLICEWP AFFILIATE
// ============================================
add_action('rest_api_init', function() {
    register_rest_route('sgs/v1', '/create-affiliate', array(
        'methods' => 'POST',
        'callback' => 'sgs_create_slicewp_affiliate',
        'permission_callback' => function() {
            return current_user_can('edit_users');
        }
    ));
});

function sgs_create_slicewp_affiliate($request) {
    global $wpdb;
    
    $user_id = intval($request->get_param('user_id'));
    $email = sanitize_email($request->get_param('email'));
    
    if (!$user_id || !$email) {
        return new WP_Error('missing_params', 'user_id and email are required', array('status' => 400));
    }
    
    // Cek apakah sudah ada affiliate untuk user ini
    $existing = $wpdb->get_var($wpdb->prepare(
        "SELECT id FROM {$wpdb->prefix}slicewp_affiliates WHERE user_id = %d",
        $user_id
    ));
    
    if ($existing) {
        return array(
            'success' => true,
            'message' => 'Affiliate already exists',
            'affiliate_id' => intval($existing),
            'user_id' => $user_id
        );
    }
    
    // Insert ke tabel SliceWP
    $result = $wpdb->insert(
        $wpdb->prefix . 'slicewp_affiliates',
        array(
            'user_id' => $user_id,
            'date_created' => current_time('mysql'),
            'date_modified' => current_time('mysql'),
            'payment_email' => $email,
            'status' => 'active'
        ),
        array('%d', '%s', '%s', '%s', '%s')
    );
    
    if ($result) {
        return array(
            'success' => true,
            'affiliate_id' => $wpdb->insert_id,
            'user_id' => $user_id,
            'email' => $email,
            'status' => 'active'
        );
    }
    
    return new WP_Error('insert_failed', 'Failed to create affiliate: ' . $wpdb->last_error, array('status' => 500));
}

// ============================================
// API: CREATE COMMISSION
// ============================================
add_action('rest_api_init', function() {
    register_rest_route('sgs/v1', '/create-commission', array(
        'methods' => 'POST',
        'callback' => 'sgs_create_commission',
        'permission_callback' => function() {
            return current_user_can('edit_users');
        }
    ));
});

function sgs_create_commission($request) {
    global $wpdb;
    
    $affiliate_id = intval($request->get_param('affiliate_id'));
    $order_id = sanitize_text_field($request->get_param('order_id'));
    $amount = floatval($request->get_param('amount'));
    $order_total = floatval($request->get_param('order_total'));
    $level = intval($request->get_param('level')) ?: 1;
    
    if (!$affiliate_id || !$order_id || !$amount) {
        return new WP_Error('missing', 'affiliate_id, order_id, amount required', array('status' => 400));
    }
    
    // Check if exists (dengan level untuk support multi-level)
    $existing = $wpdb->get_var($wpdb->prepare(
        "SELECT id FROM {$wpdb->prefix}slicewp_commissions 
         WHERE affiliate_id = %d AND reference = %s",
        $affiliate_id, $order_id . '-L' . $level
    ));
    
    if ($existing) {
        return array(
            'success' => true, 
            'message' => 'Commission already exists', 
            'commission_id' => intval($existing),
            'affiliate_id' => $affiliate_id
        );
    }
    
    // Insert commission
    $result = $wpdb->insert(
        $wpdb->prefix . 'slicewp_commissions',
        array(
            'affiliate_id' => $affiliate_id,
            'visit_id' => 0,
            'date_created' => current_time('mysql'),
            'date_modified' => current_time('mysql'),
            'type' => 'sale',
            'status' => 'unpaid',
            'reference' => $order_id . '-L' . $level, // Tambah level untuk tracking
            'reference_amount' => $order_total,
            'origin' => 'sgs_backend',
            'amount' => $amount,
            'currency' => 'IDR'
        ),
        array('%d', '%d', '%s', '%s', '%s', '%s', '%s', '%f', '%s', '%f', '%s')
    );
    
    if ($result) {
        return array(
            'success' => true, 
            'commission_id' => $wpdb->insert_id, 
            'affiliate_id' => $affiliate_id, 
            'amount' => $amount,
            'level' => $level,
            'reference' => $order_id . '-L' . $level
        );
    }
    
    return new WP_Error('insert_failed', 'Failed to create commission: ' . $wpdb->last_error, array('status' => 500));
}

// ============================================
// API: GET COMMISSIONS (untuk verifikasi sync)
// ============================================
add_action('rest_api_init', function() {
    register_rest_route('sgs/v1', '/get-commissions', array(
        'methods' => 'GET',
        'callback' => 'sgs_get_commissions',
        'permission_callback' => function() {
            return current_user_can('edit_users');
        }
    ));
});

function sgs_get_commissions($request) {
    global $wpdb;
    
    $affiliate_id = intval($request->get_param('affiliate_id'));
    $per_page = intval($request->get_param('per_page')) ?: 20;
    $page = intval($request->get_param('page')) ?: 1;
    $offset = ($page - 1) * $per_page;
    
    // Base query
    $where = "WHERE 1=1";
    $params = array();
    
    if ($affiliate_id) {
        $where .= " AND c.affiliate_id = %d";
        $params[] = $affiliate_id;
    }
    
    // Get commissions with affiliate info
    $query = "SELECT 
        c.id,
        c.affiliate_id,
        c.amount,
        c.reference,
        c.reference_amount,
        c.status,
        c.type,
        c.origin,
        c.date_created,
        a.user_id,
        a.payment_email,
        u.display_name as affiliate_name
    FROM {$wpdb->prefix}slicewp_commissions c
    LEFT JOIN {$wpdb->prefix}slicewp_affiliates a ON c.affiliate_id = a.id
    LEFT JOIN {$wpdb->prefix}users u ON a.user_id = u.ID
    $where
    ORDER BY c.date_created DESC
    LIMIT %d OFFSET %d";
    
    $params[] = $per_page;
    $params[] = $offset;
    
    $commissions = $wpdb->get_results($wpdb->prepare($query, $params));
    
    // Get total count
    $count_query = "SELECT COUNT(*) FROM {$wpdb->prefix}slicewp_commissions c $where";
    if ($affiliate_id) {
        $total = $wpdb->get_var($wpdb->prepare($count_query, $affiliate_id));
    } else {
        $total = $wpdb->get_var($count_query);
    }
    
    // Get summary
    $summary_query = "SELECT 
        COUNT(*) as total_count,
        SUM(amount) as total_amount,
        SUM(CASE WHEN status = 'unpaid' THEN amount ELSE 0 END) as unpaid_amount,
        SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as paid_amount
    FROM {$wpdb->prefix}slicewp_commissions c $where";
    
    if ($affiliate_id) {
        $summary = $wpdb->get_row($wpdb->prepare($summary_query, $affiliate_id));
    } else {
        $summary = $wpdb->get_row($summary_query);
    }
    
    return array(
        'success' => true,
        'data' => $commissions,
        'pagination' => array(
            'total' => intval($total),
            'per_page' => $per_page,
            'current_page' => $page,
            'total_pages' => ceil($total / $per_page)
        ),
        'summary' => array(
            'total_count' => intval($summary->total_count),
            'total_amount' => floatval($summary->total_amount),
            'unpaid_amount' => floatval($summary->unpaid_amount),
            'paid_amount' => floatval($summary->paid_amount)
        )
    );
}

// ============================================
// API: SET AFFILIATE PARENT (untuk multi-level)
// ============================================
add_action('rest_api_init', function() {
    register_rest_route('sgs/v1', '/set-affiliate-parent', array(
        'methods' => 'POST',
        'callback' => 'sgs_set_affiliate_parent',
        'permission_callback' => function() {
            return current_user_can('edit_users');
        }
    ));
});

function sgs_set_affiliate_parent($request) {
    global $wpdb;
    
    $affiliate_id = intval($request->get_param('affiliate_id'));
    $parent_affiliate_id = intval($request->get_param('parent_affiliate_id'));
    
    if (!$affiliate_id) {
        return new WP_Error('missing', 'affiliate_id required', array('status' => 400));
    }
    
    // Update affiliate meta untuk simpan parent
    // SliceWP tidak punya kolom parent secara default, jadi kita pakai meta
    $meta_key = 'sgs_parent_affiliate_id';
    
    // Cek existing meta
    $existing = $wpdb->get_var($wpdb->prepare(
        "SELECT meta_id FROM {$wpdb->prefix}slicewp_affiliatemeta 
         WHERE affiliate_id = %d AND meta_key = %s",
        $affiliate_id, $meta_key
    ));
    
    if ($existing) {
        $wpdb->update(
            $wpdb->prefix . 'slicewp_affiliatemeta',
            array('meta_value' => $parent_affiliate_id),
            array('meta_id' => $existing),
            array('%d'),
            array('%d')
        );
    } else {
        $wpdb->insert(
            $wpdb->prefix . 'slicewp_affiliatemeta',
            array(
                'affiliate_id' => $affiliate_id,
                'meta_key' => $meta_key,
                'meta_value' => $parent_affiliate_id
            ),
            array('%d', '%s', '%s')
        );
    }
    
    return array(
        'success' => true,
        'affiliate_id' => $affiliate_id,
        'parent_affiliate_id' => $parent_affiliate_id
    );
}

// ============================================
// API: CHECK COOKIE (untuk debugging)
// ============================================
add_action('rest_api_init', function() {
    register_rest_route('sgs/v1', '/check-cookie', array(
        'methods' => 'GET',
        'callback' => function() {
            return array(
                'cookie_set' => isset($_COOKIE['slicewp_ref']),
                'affiliate_id' => isset($_COOKIE['slicewp_ref']) ? intval($_COOKIE['slicewp_ref']) : null,
                'slicewp_aff' => isset($_COOKIE['slicewp_aff']) ? intval($_COOKIE['slicewp_aff']) : null
            );
        },
        'permission_callback' => '__return_true'
    ));
});

// ============================================
// API: HEALTH CHECK
// ============================================
add_action('rest_api_init', function() {
    register_rest_route('sgs/v1', '/health', array(
        'methods' => 'GET',
        'callback' => function() {
            global $wpdb;
            
            // Check SliceWP tables exist
            $affiliates_table = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}slicewp_affiliates'");
            $commissions_table = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}slicewp_commissions'");
            
            // Count records
            $affiliates_count = $affiliates_table ? $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}slicewp_affiliates") : 0;
            $commissions_count = $commissions_table ? $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}slicewp_commissions") : 0;
            
            return array(
                'success' => true,
                'message' => 'SGS Integration is working!',
                'wordpress_version' => get_bloginfo('version'),
                'slicewp_tables' => array(
                    'affiliates' => $affiliates_table ? 'exists' : 'missing',
                    'commissions' => $commissions_table ? 'exists' : 'missing'
                ),
                'counts' => array(
                    'affiliates' => intval($affiliates_count),
                    'commissions' => intval($commissions_count)
                ),
                'timestamp' => current_time('mysql')
            );
        },
        'permission_callback' => '__return_true'
    ));
});

// ============================================
// REFERRAL COOKIE HANDLER
// ============================================
add_action('init', 'sgs_set_referral_cookie', 1);
function sgs_set_referral_cookie() {
    if (isset($_GET['ref']) && !empty($_GET['ref'])) {
        $affiliate_id = intval($_GET['ref']);
        
        if ($affiliate_id > 0) {
            $expire = time() + (30 * 24 * 60 * 60); // 30 hari
            setcookie('slicewp_ref', $affiliate_id, $expire, '/');
            $_COOKIE['slicewp_ref'] = $affiliate_id;
        }
    }
}

// Tambahkan affiliate ID ke order saat checkout
add_action('woocommerce_checkout_create_order', 'sgs_add_referral_to_order', 10, 2);
function sgs_add_referral_to_order($order, $data) {
    if (isset($_COOKIE['slicewp_ref']) && !empty($_COOKIE['slicewp_ref'])) {
        $affiliate_id = intval($_COOKIE['slicewp_ref']);
        
        if ($affiliate_id > 0) {
            $order->update_meta_data('_slicewp_affiliate_id', $affiliate_id);
        }
    }
}

// ============================================
// WEBHOOK: ORDER COMPLETE -> SGS BACKEND
// ============================================
add_action('woocommerce_order_status_completed', 'sgs_notify_order_complete', 10, 1);
add_action('woocommerce_order_status_processing', 'sgs_notify_order_complete', 10, 1);

function sgs_notify_order_complete($order_id) {
    $order = wc_get_order($order_id);
    if (!$order) return;

    // Cek apakah sudah pernah kirim webhook
    $webhook_sent = $order->get_meta('_sgs_webhook_sent');
    if ($webhook_sent === 'yes') return;

    $email = $order->get_billing_email();
    $order_total = $order->get_total();

    global $wpdb;
    $affiliate_id = null;

    // Cek dari SliceWP commissions table (sesuaikan format reference jika perlu)
    $commission = $wpdb->get_row($wpdb->prepare(
        "SELECT affiliate_id FROM {$wpdb->prefix}slicewp_commissions WHERE reference = %s LIMIT 1",
        $order_id
    ));
    if ($commission) {
        $affiliate_id = $commission->affiliate_id;
    }

    if (!$affiliate_id) {
        $affiliate_id = $order->get_meta('_slicewp_affiliate_id') ?: null;
    }
    if (!$affiliate_id && isset($_COOKIE['slicewp_aff'])) {
        $affiliate_id = intval($_COOKIE['slicewp_aff']);
    }
    if (!$affiliate_id && isset($_COOKIE['slicewp_ref'])) {
        $affiliate_id = intval($_COOKIE['slicewp_ref']);
    }

    error_log('SGS Webhook - Order: ' . $order_id . ', Affiliate ID: ' . ($affiliate_id ?: 'NULL'));

    // SUPPORT MULTIPLE CLASS PRODUCT IDs
    $is_class_purchase = false;
    $class_product_ids = array(61, 90); 

    foreach ($order->get_items() as $item) {
        if (in_array($item->get_product_id(), $class_product_ids, true)) {
            $is_class_purchase = true;
            break;
        }
    }

    // Build line_items
    $line_items = array();
    foreach ($order->get_items() as $item) {
        $line_items[] = array(
            'product_id' => $item->get_product_id(),
            'name' => $item->get_name(),
            'quantity' => $item->get_quantity(),
            'total' => $item->get_total()
        );
    }

    // Kirim ke SGS
    $sgs_webhook_url = 'https://uncarpentered-unsymbolically-chanelle.ngrok-free.dev/api/webhook/woocommerce/order-complete';
    $sgs_webhook_secret = 'sgs-wc-webhook-secret-2024';

    $payload = array(
        'order_id' => $order_id,
        'email' => $email,
        'order_total' => $order_total,
        'affiliate_id' => $affiliate_id,
        'is_class_purchase' => $is_class_purchase,
        'status' => $order->get_status(),
        'timestamp' => current_time('mysql'),
        'line_items' => $line_items
    );

    $body = wp_json_encode($payload);
    $signature = hash_hmac('sha256', $body, $sgs_webhook_secret);

    $response = wp_remote_post($sgs_webhook_url, array(
        'body' => $body,
        'headers' => array(
            'Content-Type' => 'application/json',
            'X-WC-Webhook-Signature' => $signature
        ),
        'timeout' => 30
    ));

    // Debug log response
    if (is_wp_error($response)) {
        error_log('SGS Webhook FAILED (WP_Error): ' . $response->get_error_message());
        return;
    }

    $code = wp_remote_retrieve_response_code($response);
    $resp_body = wp_remote_retrieve_body($response);
    error_log('SGS Webhook RESPONSE [' . $code . ']: ' . $resp_body);

    // Hanya tandai _sgs_webhook_sent jika SGS memproses payload
    $processed = false;
    if ($code === 200) {
        $json = json_decode($resp_body, true);
        if (isset($json['processed']) && $json['processed'] === true) {
            $processed = true;
        }
    }

    if ($processed) {
        $order->update_meta_data('_sgs_webhook_sent', 'yes');
        $order->update_meta_data('_sgs_affiliate_id_used', $affiliate_id);
        $order->save();
        error_log('SGS Webhook SUCCESS: Order ' . $order_id);
    } else {
        error_log('SGS Webhook NOT PROCESSED: Order ' . $order_id . ' (response code: ' . $code . ')');
    }
}