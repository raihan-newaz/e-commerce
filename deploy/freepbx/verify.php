<?php
// Read-only integration checks. Never served by the web module.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require '/etc/freepbx.conf';
require ($argv[1] ?? '/var/www/html/admin/modules/nixops/Nixops.class.php');
$pbx = \FreePBX::Create();
$module = new \FreePBX\modules\Nixops($pbx);
$checks = [];
function check($condition, $name) { if (!$condition) throw new RuntimeException('FAILED: ' . $name); }
$_SESSION['nixops_token'] = str_repeat('a', 64);
$_SERVER['HTTP_X_NIXOPS_TOKEN'] = $_SESSION['nixops_token'];
$_REQUEST = ['command' => 'live'];
unset($_SESSION['AMP_user']);
$denied = $module->ajaxHandler();
check(!$denied['success'] && http_response_code() === 403, 'session required even on localhost');
$checks[] = 'unauthenticated_denied';
$_SESSION['AMP_user'] = new class { public function checkSection($section) { return $section === 'nixops'; } };
$_SERVER['HTTP_X_NIXOPS_TOKEN'] = 'wrong';
check(!$module->ajaxHandler()['success'], 'CSRF token required');
$checks[] = 'csrf_denied';
$_SERVER['HTTP_X_NIXOPS_TOKEN'] = $_SESSION['nixops_token'];
foreach (['live', 'reports', 'queues', 'backup'] as $command) {
    http_response_code(200);
    $_REQUEST = ['command' => $command];
    $result = $module->ajaxHandler();
    check($result['success'], $command . ' data');
    if ($command === 'live') check(strlen($result['data']['queueStatus']) > 5, 'AMI status populated');
    if ($command === 'reports') check(isset($result['data']['summary']['total']), 'CDR summary populated');
    if ($command === 'backup') check(($result['data']['status'] ?? '') === 'ok', 'verified snapshot exists');
    $checks[] = $command . '_ok';
}
foreach ([['from' => '2026-02-31'], ['from' => '2020-01-01', 'to' => '2026-01-01'], ['status' => "ANSWERED' OR 1=1"], ['search' => "'; DROP TABLE cdr;--"]] as $invalid) {
    $_REQUEST = ['command' => 'reports', ...$invalid];
    check(!$module->ajaxHandler()['success'], 'invalid filter rejected');
}
$checks[] = 'invalid_filters_denied';
$_SESSION['AMP_user'] = new class { public function checkSection($section) { return false; } };
$_REQUEST = ['command' => 'reports'];
check(!$module->ajaxHandler()['success'], 'module permission required');
$checks[] = 'permissions_denied';
http_response_code(200);
echo json_encode(['success' => true, 'checks' => $checks]) . PHP_EOL;
exit(0);
