<?php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require '/etc/freepbx.conf';
$module = \FreePBX::Nixops();
$_SESSION['AMP_user'] = new class { public function checkSection($section) { return $section === 'nixops'; } };
$_SESSION['nixops_token'] = str_repeat('b', 64);
$_SERVER['HTTP_X_NIXOPS_TOKEN'] = $_SESSION['nixops_token'];
if (($argv[1] ?? '') === 'csv') {
    $_REQUEST = ['command' => 'export'];
} else {
    $id = false;
    $rows = \FreePBX::Cdr()->cdrdb->query("SELECT uniqueid,calldate,recordingfile FROM cdr WHERE recordingfile<>'' ORDER BY calldate DESC LIMIT 100")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $row) {
        $date = new DateTimeImmutable($row['calldate']);
        foreach (['/var/spool/asterisk/monitor/' . $row['recordingfile'], '/var/spool/asterisk/monitor/' . $date->format('Y/m/d') . '/' . $row['recordingfile']] as $file) {
            if (is_file($file) && filesize($file) > 44) { $id = $row['uniqueid']; break 2; }
        }
    }
    if (!$id) { fwrite(STDERR, 'No recording fixture'); exit(2); }
    $_REQUEST = ['command' => 'recording', 'id' => $id];
}
http_response_code(200);
$module->ajaxCustomHandler();
exit(0);
