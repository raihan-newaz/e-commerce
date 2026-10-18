<?php
namespace FreePBX\modules;
require_once __DIR__ . '/Operations.php';

class Nixops extends \FreePBX_Helpers implements \BMO {
    use NixopsOperations;
    private $pbx;
    public function __construct($freepbx = null) { $this->pbx = $freepbx; }
    public function install() {}
    public function uninstall() {}
    public function doConfigPageInit($page) {}
    public function ajaxRequest($command, &$settings) {
        $settings['authenticate'] = true;
        $settings['allowremote'] = false;
        return in_array($command, ['live', 'reports', 'queues', 'backup', 'health', 'recording', 'export', 'capabilities', 'settings', 'saveSettings', 'roles', 'saveRole', 'audit', 'followups', 'saveFollowup', 'customer', 'retention', 'quarantine', 'restoreRecording'], true);
    }
    private function authorize() {
        // FreePBX's AJAX dispatcher skips auth on localhost. Enforce it here too.
        $user = $_SESSION['AMP_user'] ?? null;
        if (!$user || !$user->checkSection('nixops')) { http_response_code(403); throw new \RuntimeException('Access denied'); }
        $token = $_SERVER['HTTP_X_NIXOPS_TOKEN'] ?? '';
        if (empty($_SESSION['nixops_token']) || !hash_equals($_SESSION['nixops_token'], $token)) {
            http_response_code(403); throw new \RuntimeException('Refresh this page to renew your session');
        }
        header('Cache-Control: no-store, private');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
    }
    private function command($command) {
        // Commands are constants in this class, never supplied by a browser.
        $result = $this->pbx->astman->Command($command);
        if (($result['Response'] ?? '') === 'Error') throw new \RuntimeException('Asterisk status is unavailable');
        return (string)($result['data'] ?? '');
    }
    public function live() {
        $channels = [];
        foreach (explode("\n", $this->command('core show channels concise')) as $line) {
            $f = explode('!', trim($line));
            if (count($f) < 11) continue;
            $channels[] = ['channel' => $f[0], 'extension' => $f[2], 'state' => $f[4], 'application' => $f[5], 'caller' => $f[7], 'seconds' => (int)$f[10]];
        }
        $endpoints = [];
        foreach (explode("\n", $this->command('pjsip show endpoints')) as $line) {
            if (preg_match('/^\s*Endpoint:\s+([^<\s]\S*)\s+(.*?)\s+(\d+) of/', $line, $m)) {
                $endpoints[] = ['name' => $m[1], 'state' => trim($m[2]), 'channels' => (int)$m[3]];
            }
        }
        $trunks = [];
        foreach (explode("\n", $this->command('pjsip show registrations')) as $line) {
            if (preg_match('/^\s*(\S+)\s+\S+\s+(Registered|Unregistered|Rejected)\b/', $line, $m)) {
                $trunks[] = ['name' => explode('/', $m[1])[0], 'state' => $m[2]];
            }
        }
        return ['channels' => $channels, 'endpoints' => $endpoints, 'trunks' => $trunks, 'queueStatus' => $this->command('queue show'), 'at' => date(DATE_ATOM)];
    }
    public function timezone() { return $this->pbx->Config->get('CDRUSEGMT') ? 'UTC' : 'Asia/Dhaka'; }
    private function range() {
        $tz = new \DateTimeZone($this->timezone());
        $today = (new \DateTimeImmutable('now', $tz))->format('Y-m-d');
        $from = (string)($_REQUEST['from'] ?? $today);
        $to = (string)($_REQUEST['to'] ?? $today);
        $a = \DateTimeImmutable::createFromFormat('!Y-m-d', $from, $tz);
        $b = \DateTimeImmutable::createFromFormat('!Y-m-d', $to, $tz);
        if (!$a || !$b || $a->format('Y-m-d') !== $from || $b->format('Y-m-d') !== $to || $b < $a || $a->diff($b)->days > 30) {
            throw new \InvalidArgumentException('Choose a date range of at most 31 days');
        }
        return [$a, $b->modify('+1 day')];
    }
    private function database() { return $this->pbx->Cdr->cdrdb; }
    private function table() {
        $name = $this->pbx->Config->get('CDRDBTABLENAME') ?: 'cdr';
        if (!preg_match('/^[A-Za-z0-9_]+$/D', $name)) throw new \RuntimeException('Unsupported CDR table');
        return '`' . $name . '`';
    }
    private function filter() {
        [$from, $to] = $this->range();
        $where = 'calldate >= :from AND calldate < :to';
        $params = ['from' => $from->format('Y-m-d H:i:s'), 'to' => $to->format('Y-m-d H:i:s')];
        $search = trim((string)($_REQUEST['search'] ?? ''));
        if (strlen($search) > 80 || !preg_match('/^[\p{L}\p{N} +*#@.\/_-]*$/uD', $search)) throw new \InvalidArgumentException('Invalid search');
        if ($search !== '') {
            $where .= ' AND (src LIKE :src OR dst LIKE :dst)';
            // Escape LIKE metacharacters; all values are still bound parameters.
            $value = '%' . strtr($search, ['\\' => '\\\\', '%' => '\\%', '_' => '\\_']) . '%';
            $params['src'] = $value; $params['dst'] = $value;
        }
        $status = (string)($_REQUEST['status'] ?? '');
        if (!in_array($status, ['', 'ANSWERED', 'NO ANSWER', 'BUSY', 'FAILED', 'CONGESTION'], true)) throw new \InvalidArgumentException('Invalid call status');
        if ($status !== '') { $where .= ' AND disposition = :status'; $params['status'] = $status; }
        $recorded = (string)($_REQUEST['recorded'] ?? '');
        if (!in_array($recorded, ['', '1'], true)) throw new \InvalidArgumentException('Invalid recording filter');
        if ($recorded === '1') $where .= " AND recordingfile<>''";
        return [$where, $params];
    }
    private function query($sql, $params) {
        $statement = $this->database()->prepare($sql);
        $statement->execute($params);
        return $statement->fetchAll(\PDO::FETCH_ASSOC);
    }
    public function reports($export = false) {
        [$where, $params] = $this->filter();
        $table = $this->table();
        $page = filter_var($_REQUEST['page'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 20000]]);
        if (!$page) throw new \InvalidArgumentException('Invalid page');
        $limit = $export ? 5000 : 50;
        $offset = $export ? 0 : ($page - 1) * $limit;
        $rows = $this->query("SELECT calldate,src,dst,duration,billsec,disposition,uniqueid,recordingfile FROM $table WHERE $where ORDER BY calldate DESC,sequence DESC LIMIT $limit OFFSET $offset", $params);
        foreach ($rows as &$row) {
            $row['recorded'] = !empty($row['recordingfile']); unset($row['recordingfile']);
            $row['duration'] = (int)$row['duration']; $row['billsec'] = (int)$row['billsec'];
        }
        unset($row);
        $summary = $this->query("SELECT COUNT(*) AS total,COALESCE(SUM(disposition='ANSWERED'),0) AS answered,COALESCE(SUM(disposition<>'ANSWERED'),0) AS unanswered,COALESCE(SUM(billsec),0) AS talkSeconds,COALESCE(SUM(recordingfile<>''),0) AS recordings FROM $table WHERE $where", $params)[0];
        $daily = $this->query("SELECT DATE(calldate) AS day,COUNT(*) AS total,COALESCE(SUM(disposition='ANSWERED'),0) AS answered FROM $table WHERE $where GROUP BY DATE(calldate) ORDER BY day", $params);
        $hourly = $this->query("SELECT HOUR(calldate) AS hour,COUNT(*) AS total,SUM(disposition='ANSWERED') AS answered FROM $table WHERE $where GROUP BY HOUR(calldate) ORDER BY hour", $params);
        $destinations = $this->query("SELECT dst,COUNT(*) AS total,SUM(disposition='ANSWERED') AS answered,SUM(billsec) AS talkSeconds FROM $table WHERE $where GROUP BY dst ORDER BY total DESC,dst LIMIT 10", $params);
        return ['rows' => $rows, 'summary' => array_map('intval', $summary), 'daily' => $daily, 'hourly' => $hourly, 'destinations' => $destinations, 'page' => $page, 'pageSize' => $limit, 'timezone' => $this->timezone(), 'truncated' => $export && (int)$summary['total'] > $limit];
    }
    public function queues() {
        [$from, $to] = $this->range();
        $file = '/var/log/asterisk/queue_log';
        if (!is_readable($file)) return ['queues' => [], 'available' => false, 'partial' => false];
        $f = fopen($file, 'rb');
        $size = filesize($file); $max = 8 * 1024 * 1024; $partial = $size > $max;
        if ($partial) { fseek($f, -$max, SEEK_END); fgets($f); }
        $queues = []; $first = null;
        while (($line = fgets($f)) !== false) {
            $v = explode('|', trim($line));
            if (count($v) < 5 || !ctype_digit($v[0])) continue;
            $timestamp = (int)$v[0]; $first = $first ?? $timestamp;
            if ($timestamp < $from->getTimestamp() || $timestamp >= $to->getTimestamp() || $v[2] === 'NONE') continue;
            $q = $v[2];
            $queues[$q] = $queues[$q] ?? ['name' => $q, 'entered' => 0, 'answered' => 0, 'abandoned' => 0, 'completed' => 0, 'waitSeconds' => 0, 'talkSeconds' => 0];
            if ($v[4] === 'ENTERQUEUE') $queues[$q]['entered']++;
            if ($v[4] === 'CONNECT') { $queues[$q]['answered']++; $queues[$q]['waitSeconds'] += (int)($v[5] ?? 0); }
            if ($v[4] === 'ABANDON') $queues[$q]['abandoned']++;
            if (in_array($v[4], ['COMPLETECALLER', 'COMPLETEAGENT'], true)) { $queues[$q]['completed']++; $queues[$q]['talkSeconds'] += (int)($v[6] ?? 0); }
        }
        fclose($f);
        return ['queues' => array_values($queues), 'available' => true, 'partial' => $partial && $first > $from->getTimestamp(), 'timezone' => $this->timezone()];
    }
    public function backup() {
        $file = '/var/lib/nixops/backup-status.json';
        if (!is_readable($file)) return ['available' => false];
        $data = json_decode(file_get_contents($file), true);
        return is_array($data) ? $data : ['available' => false];
    }
    public function health() {
        $config = $this->config()['values'];
        $volumes = [];
        foreach (['Recordings' => '/var/spool/asterisk/monitor', 'System' => '/'] as $label => $path) {
            $total = @disk_total_space($path); $free = @disk_free_space($path);
            $volumes[] = ['name' => $label, 'available' => $total !== false && $free !== false && $total > 0,
                'total' => $total ?: 0, 'free' => $free ?: 0];
        }
        $backup = $this->backup();
        $last = isset($backup['lastSuccess']) ? strtotime($backup['lastSuccess']) : false;
        $age = $last ? max(0, time() - $last) : null;
        return ['volumes' => $volumes, 'load' => sys_getloadavg() ?: [], 'backupAgeSeconds' => $age,
            'backupHealthy' => ($backup['status'] ?? '') === 'ok' && $age !== null && $age < $config['backupHours'] * 3600,
            'diskWarning' => $config['diskWarning'], 'backupHours' => $config['backupHours'],
            'at' => date(DATE_ATOM)];
    }
    private function recording() {
        $this->permit('media');
        $id = (string)($_REQUEST['id'] ?? '');
        if (!preg_match('/^[A-Za-z0-9._-]{1,150}$/D', $id)) throw new \InvalidArgumentException('Invalid recording ID');
        $rows = $this->query('SELECT calldate,recordingfile FROM ' . $this->table() . " WHERE uniqueid=:id AND recordingfile<>'' LIMIT 1", ['id' => $id]);
        if (!$rows) throw new \RuntimeException('Recording is unavailable');
        $row = $rows[0];
        $root = realpath('/var/spool/asterisk/monitor');
        $name = $row['recordingfile'];
        $date = new \DateTimeImmutable($row['calldate']);
        $candidates = [$root . '/' . $name, $root . '/' . $date->format('Y/m/d') . '/' . $name];
        if (str_starts_with($name, '/')) $candidates[] = $name;
        $found = false;
        foreach ($candidates as $candidate) {
            $real = realpath($candidate);
            if ($root && $real && str_starts_with($real, $root . '/') && is_file($real) && is_readable($real)) { $found = $real; break; }
        }
        if (!$found || filesize($found) > 100 * 1024 * 1024) throw new \RuntimeException('Recording is unavailable or exceeds the 100 MB playback limit');
        $types = ['wav' => 'audio/wav', 'mp3' => 'audio/mpeg', 'ogg' => 'audio/ogg', 'gsm' => 'audio/gsm'];
        $extension = strtolower(pathinfo($found, PATHINFO_EXTENSION));
        if (!isset($types[$extension])) throw new \RuntimeException('Unsupported recording format');
        $this->auditEvent('recording.accessed', $id);
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: ' . $types[$extension]);
        header('Content-Length: ' . filesize($found));
        header('Content-Disposition: attachment; filename="call-' . $id . '.' . $extension . '"');
        readfile($found);
    }
    private function csv() {
        $this->permit('media');
        $data = $this->reports(true);
        $this->auditEvent('report.exported');
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="pbx-call-records.csv"');
        $out = fopen('php://output', 'wb');
        fputcsv($out, ['Date (' . $data['timezone'] . ')', 'Source', 'Destination', 'Duration seconds', 'Talk seconds', 'Status', 'Call ID']);
        foreach ($data['rows'] as $row) {
            $values = array_map(static function ($v) { $v = (string)$v; return preg_match('/^[=+@\-\t\r]/', $v) ? "'" . $v : $v; }, [$row['calldate'], $row['src'], $row['dst'], $row['duration'], $row['billsec'], $row['disposition'], $row['uniqueid']]);
            fputcsv($out, $values);
        }
        fclose($out);
    }
    public function ajaxCustomHandler() {
        if (!in_array($_REQUEST['command'] ?? '', ['recording', 'export'], true)) return false;
        try {
            $this->authorize();
            if ($_REQUEST['command'] === 'recording') $this->recording(); else $this->csv();
        } catch (\Throwable $e) {
            if (http_response_code() < 400) http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['success' => false, 'message' => $e instanceof \InvalidArgumentException ? $e->getMessage() : 'Requested file is unavailable or access was denied']);
        }
        return true;
    }
    public function ajaxHandler() {
        try {
            $this->authorize();
            $command = $_REQUEST['command'] ?? '';
            if (!in_array($command, ['live', 'reports', 'queues', 'backup', 'health', 'capabilities', 'settings', 'saveSettings', 'roles', 'saveRole', 'audit', 'followups', 'saveFollowup', 'customer', 'retention', 'quarantine', 'restoreRecording'], true)) throw new \InvalidArgumentException('Unknown operation');
            return ['success' => true, 'data' => $this->$command()];
        } catch (\Throwable $e) {
            if (http_response_code() < 400) http_response_code(400);
            return ['success' => false, 'message' => $e instanceof \InvalidArgumentException ? $e->getMessage() : 'PBX data is unavailable or access was denied'];
        }
    }
}
