<?php
namespace FreePBX\modules;

trait NixopsOperations {
    private $opsDb;
    private function state() {
        if ($this->opsDb) return $this->opsDb;
        $path = '/var/lib/nixops-console';
        if (!is_dir($path) || !is_writable($path)) throw new \RuntimeException('Console state directory unavailable');
        $old = umask(0077);
        try {
            $db = new \PDO('sqlite:' . $path . '/operations.sqlite');
            $db->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
            $db->exec('PRAGMA busy_timeout=5000');
            $db->exec('CREATE TABLE IF NOT EXISTS followups (id TEXT PRIMARY KEY, phone TEXT NOT NULL, call_id TEXT NOT NULL, call_time TEXT NOT NULL, owner TEXT NOT NULL DEFAULT "", status TEXT NOT NULL DEFAULT "open", note TEXT NOT NULL DEFAULT "", version INTEGER NOT NULL DEFAULT 1, updated TEXT NOT NULL)');
            $db->exec('CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL)');
            $db->exec('CREATE TABLE IF NOT EXISTS roles (username TEXT PRIMARY KEY, role TEXT NOT NULL)');
            $db->exec('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, version INTEGER NOT NULL)');
            $db->exec('CREATE TABLE IF NOT EXISTS quarantine (id TEXT PRIMARY KEY, original TEXT NOT NULL, stored TEXT NOT NULL, bytes INTEGER NOT NULL, at TEXT NOT NULL, restored INTEGER NOT NULL DEFAULT 0)');
            $this->opsDb = $db;
            return $db;
        } finally { umask($old); }
    }
    private function actor() { return (string)($_SESSION['AMP_user']->username ?? 'unknown'); }
    private function role() {
        if ($_SESSION['AMP_user']->checkSection('*')) return 'admin';
        $s = $this->state()->prepare('SELECT role FROM roles WHERE username=?'); $s->execute([$this->actor()]);
        return $s->fetchColumn() ?: 'viewer';
    }
    private function permit($capability) {
        $roles = ['followup' => ['admin','supervisor','operator'], 'media' => ['admin','supervisor'], 'manage' => ['admin']];
        if (!in_array($this->role(), $roles[$capability], true)) { http_response_code(403); throw new \RuntimeException('Permission denied'); }
    }
    private function mutation($capability) {
        $this->permit($capability);
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); throw new \InvalidArgumentException('Use POST for changes'); }
    }
    private function auditKey() {
        $file='/var/lib/nixops-console/audit.key';
        if(!is_file($file)) { $handle=@fopen($file,'x');if($handle){fwrite($handle,random_bytes(32));fflush($handle);if(function_exists('fsync'))fsync($handle);fclose($handle);chmod($file,0600);} }
        $key=@file_get_contents($file);if($key===false||strlen($key)!==32)throw new \RuntimeException('Audit key unavailable');return $key;
    }
    private function auditEvent($action, $target = '') {
        $s = $this->state()->prepare('INSERT INTO audit(at,actor,action,target) VALUES(?,?,?,?)');
        $s->execute([gmdate(DATE_ATOM), $this->actor(), $action, substr($target, 0, 200)]);
    }
    private function defaults() {
        return ['retentionDays'=>90,'diskWarning'=>85,'backupHours'=>36,'alertChannel'=>'none','email'=>'','telegramChat'=>'',
            'offsiteType'=>'none','offsiteProfile'=>'','offsitePath'=>'','offsiteKeepDays'=>30,'ordersUrl'=>'https://nix.bd/admin/orders'];
    }
    private function config() {
        $row = $this->state()->query('SELECT value,version FROM settings WHERE id=1')->fetch(\PDO::FETCH_ASSOC);
        return ['values' => array_merge($this->defaults(), $row ? json_decode($row['value'], true, 16, JSON_THROW_ON_ERROR) : []), 'version' => $row ? (int)$row['version'] : 0];
    }
    public function capabilities() {
        $role = $this->role();
        return ['role'=>$role,'actor'=>$this->actor(),'media'=>in_array($role,['admin','supervisor'],true),'followup'=>$role!=='viewer','manage'=>$role==='admin'];
    }
    public function settings() {
        $this->permit('manage');
        return $this->config() + ['alertDelivery'=>'Not connected — destination credentials and delivery verification required', 'offsiteDelivery'=>'Not connected — remote storage and restore verification required'];
    }
    public function saveSettings() {
        $this->mutation('manage'); $values = $this->defaults();
        foreach (['retentionDays'=>[7,3650], 'diskWarning'=>[50,99], 'backupHours'=>[6,168], 'offsiteKeepDays'=>[7,3650]] as $key=>$bounds) {
            $value = filter_var($_POST[$key] ?? null, FILTER_VALIDATE_INT);
            if ($value === false || $value < $bounds[0] || $value > $bounds[1]) throw new \InvalidArgumentException('Invalid ' . $key);
            $values[$key] = $value;
        }
        foreach (['alertChannel'=>['none','email','telegram'], 'offsiteType'=>['none','sftp','s3']] as $key=>$allowed) {
            $value = (string)($_POST[$key] ?? '');
            if (!in_array($value,$allowed,true)) throw new \InvalidArgumentException('Invalid ' . $key);
            $values[$key] = $value;
        }
        foreach (['email','telegramChat','offsiteProfile','offsitePath','ordersUrl'] as $key) {
            $value = trim((string)($_POST[$key] ?? ''));
            if (strlen($value)>250 || preg_match('/[\x00-\x1f\x7f]/',$value)) throw new \InvalidArgumentException('Invalid ' . $key);
            $values[$key]=$value;
        }
        if ($values['email']!=='' && !filter_var($values['email'],FILTER_VALIDATE_EMAIL)) throw new \InvalidArgumentException('Invalid email');
        if (!preg_match('/^-?[0-9]*$/D',$values['telegramChat'])) throw new \InvalidArgumentException('Invalid Telegram chat ID');
        if (!preg_match('/^[A-Za-z0-9_-]*$/D',$values['offsiteProfile'])) throw new \InvalidArgumentException('Use a profile name, not credentials');
        $url = parse_url($values['ordersUrl']);
        if ($values['ordersUrl']!=='' && (!$url || ($url['scheme']??'')!=='https' || !in_array(strtolower($url['host']??''),['nix.bd','my.nix.bd'],true) || !in_array($url['path']??'',['/admin/orders','/admin/orders/'],true) || isset($url['port']) || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment']))) throw new \InvalidArgumentException('Orders URL must use the NIX HTTPS orders page without credentials or query');
        $version = filter_var($_POST['version']??null,FILTER_VALIDATE_INT);
        $db=$this->state(); $db->beginTransaction();
        try {
            $current=$this->config();
            if ($version!==$current['version']) throw new \InvalidArgumentException('Settings changed. Refresh before saving.');
            $s=$db->prepare('INSERT INTO settings(id,value,version) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,version=excluded.version');
            $s->execute([json_encode($values),$version+1]); $this->auditEvent('settings.updated'); $db->commit();
        } catch (\Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
        return $this->settings();
    }
    public function roles() { $this->permit('manage'); return $this->state()->query('SELECT username,role FROM roles ORDER BY username')->fetchAll(\PDO::FETCH_ASSOC); }
    public function saveRole() {
        $this->mutation('manage'); $username=trim((string)($_POST['username']??'')); $role=(string)($_POST['role']??'');
        if (!preg_match('/^[A-Za-z0-9@._-]{1,100}$/D',$username) || !in_array($role,['viewer','operator','supervisor'],true)) throw new \InvalidArgumentException('Invalid user or role');
        $user=new \ampuser($username);
        if (!$user->checkSection('nixops')) throw new \InvalidArgumentException('Grant this existing FreePBX user access to NIX PBX Console first');
        if ($user->checkSection('*')) throw new \InvalidArgumentException('Full FreePBX administrators already have admin access');
        $db=$this->state(); $db->beginTransaction();
        try {
            $s=$db->prepare('INSERT INTO roles(username,role) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET role=excluded.role');$s->execute([$username,$role]);
            $this->auditEvent('role.'.$role,$username);$db->commit();
        } catch (\Throwable $e) { if ($db->inTransaction()) $db->rollBack();throw $e; }
        return $this->roles();
    }
    public function audit() {
        $this->permit('manage'); $before=max(0,(int)($_REQUEST['before']??0));
        $s=$this->state()->prepare('SELECT * FROM audit WHERE (CAST(? AS INTEGER)=0 OR id<CAST(? AS INTEGER)) ORDER BY id DESC LIMIT 100');$s->execute([$before,$before]);return $s->fetchAll(\PDO::FETCH_ASSOC);
    }
    private function phone($input) {
        $phone=preg_replace('/[ ()-]/','',trim((string)$input));
        if (!preg_match('/^\+?[0-9]{3,20}$/D',$phone)) throw new \InvalidArgumentException('Enter a phone number or numeric extension');
        return $phone;
    }
    public function followups() {
        $status=(string)($_REQUEST['followupStatus']??'open');
        if (!in_array($status,['open','in_progress','done','dismissed','all'],true)) throw new \InvalidArgumentException('Invalid follow-up status');
        $s=$this->state()->prepare('SELECT * FROM followups WHERE (?="all" OR status=?) ORDER BY updated DESC LIMIT 200');$s->execute([$status,$status]);
        return ['rows'=>$s->fetchAll(\PDO::FETCH_ASSOC),'limit'=>200];
    }
    public function saveFollowup() {
        $this->mutation('followup');$db=$this->state();$id=(string)($_POST['id']??'');
        if ($id==='') {
            $call=(string)($_POST['callId']??'');$phone=$this->phone($_POST['phone']??'');
            if (!preg_match('/^[A-Za-z0-9._-]{1,150}$/D',$call)) throw new \InvalidArgumentException('Invalid call');
            $found=$this->query('SELECT calldate,src,dst FROM '.$this->table()." WHERE uniqueid=:id AND disposition<>'ANSWERED' ORDER BY calldate DESC LIMIT 20",['id'=>$call]);
            $match=null;
            foreach($found as $row) if(in_array($phone,[$row['src'],$row['dst']],true)) {$match=$row;break;}
            if (!$match) throw new \InvalidArgumentException('Choose a source or destination from an unanswered call');
            $id=hash('sha256',$call.'|'.$phone);$db->beginTransaction();
            try {
                $s=$db->prepare('INSERT OR IGNORE INTO followups(id,phone,call_id,call_time,updated) VALUES(?,?,?,?,?)');$s->execute([$id,$phone,$call,$match['calldate'],gmdate(DATE_ATOM)]);
                if($s->rowCount())$this->auditEvent('followup.created',$id);$db->commit();
            } catch(\Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
        } else {
            if(!preg_match('/^[a-f0-9]{64}$/D',$id))throw new \InvalidArgumentException('Invalid follow-up');
            $status=(string)($_POST['status']??'');$owner=trim((string)($_POST['owner']??''));$note=trim((string)($_POST['note']??''));$version=(int)($_POST['version']??0);
            if(!in_array($status,['open','in_progress','done','dismissed'],true)||strlen($owner)>100||strlen($note)>2000||preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f]/',$owner.$note))throw new \InvalidArgumentException('Invalid follow-up fields');
            $db->beginTransaction();
            try {
                $s=$db->prepare('UPDATE followups SET status=?,owner=?,note=?,updated=?,version=version+1 WHERE id=? AND version=?');$s->execute([$status,$owner,$note,gmdate(DATE_ATOM),$id,$version]);
                if(!$s->rowCount())throw new \InvalidArgumentException('This follow-up changed. Refresh before saving.');
                $this->auditEvent('followup.'.$status,$id);$db->commit();
            } catch(\Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
        }
        return ['id'=>$id];
    }
    public function customer() {
        $phone=$this->phone($_REQUEST['phone']??'');$variants=[$phone,ltrim($phone,'+')];
        $digits=ltrim($phone,'+');if(preg_match('/^(?:88)?(01[0-9]{9})$/D',$digits,$m))$variants=[$m[1],'88'.$m[1],'+88'.$m[1]];
        $params=[];$parts=[];foreach(array_unique($variants) as $i=>$value){$parts[]="src=:s$i OR dst=:d$i";$params['s'.$i]=$value;$params['d'.$i]=$value;}
        [$from,$to]=$this->range();$params['from']=$from->format('Y-m-d H:i:s');$params['to']=$to->format('Y-m-d H:i:s');
        $calls=$this->query('SELECT calldate,src,dst,disposition,billsec FROM '.$this->table().' WHERE ('.implode(' OR ',$parts).') AND calldate>=:from AND calldate<:to ORDER BY calldate DESC LIMIT 100',$params);
        $v=array_values(array_unique($variants));$s=$this->state()->prepare('SELECT * FROM followups WHERE phone IN ('.implode(',',array_fill(0,count($v),'?')).') ORDER BY updated DESC LIMIT 50');$s->execute($v);
        $base=$this->config()['values']['ordersUrl'];
        $this->auditEvent('customer.lookup',hash_hmac('sha256',$phone,$this->auditKey()));
        return ['calls'=>$calls,'followups'=>$s->fetchAll(\PDO::FETCH_ASSOC),'ordersUrl'=>$base!==''?$base.'?search='.rawurlencode($variants[0]):null];
    }
    public function retention() {
        $this->permit('manage');$days=$this->config()['values']['retentionDays'];$root=realpath('/var/spool/asterisk/monitor');
        if(!$root||!is_readable($root))throw new \RuntimeException('Recording directory unavailable');
        $cutoff=time()-$days*86400;$start=microtime(true);$count=0;$bytes=0;$files=[];$map=[];$partial=false;
        $iterator=new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root,\FilesystemIterator::SKIP_DOTS));
        foreach($iterator as $file){
            if(++$count>20000||microtime(true)-$start>3){$partial=true;break;}
            if($file->isLink()||!$file->isFile()||!preg_match('/\.(wav|mp3|ogg|gsm)$/i',$file->getFilename())||$file->getMTime()>=$cutoff)continue;
            $path=$file->getRealPath();if(!$path||!str_starts_with($path,$root.'/'))continue;
            $id=hash('sha256',$path.'|'.$file->getSize().'|'.$file->getMTime());$bytes+=$file->getSize();
            $files[]=['id'=>$id,'name'=>$file->getFilename(),'bytes'=>$file->getSize(),'modified'=>gmdate(DATE_ATOM,$file->getMTime())];
            $map[$id]=['path'=>$path,'bytes'=>$file->getSize(),'mtime'=>$file->getMTime()];
            if(count($files)>=100){$partial=true;break;}
        }
        $token=bin2hex(random_bytes(24));$_SESSION['nixops_retention']=['token'=>$token,'expires'=>time()+600,'files'=>$map];
        return ['days'=>$days,'files'=>$files,'bytes'=>$bytes,'partial'=>$partial,'token'=>$token,'quarantine'=>$this->state()->query('SELECT id,bytes,at FROM quarantine WHERE restored=0 ORDER BY at DESC LIMIT 100')->fetchAll(\PDO::FETCH_ASSOC)];
    }
    public function quarantine() {
        $this->mutation('manage');$preview=$_SESSION['nixops_retention']??[];$id=(string)($_POST['id']??'');
        if(($preview['expires']??0)<time()||!hash_equals($preview['token']??'',(string)($_POST['token']??''))||!isset($preview['files'][$id]))throw new \InvalidArgumentException('Preview expired. Refresh retention first.');
        $file=$preview['files'][$id];$path=$file['path'];$root=realpath('/var/spool/asterisk/monitor');$destination='/var/spool/asterisk/nixops-quarantine/'.$id;
        clearstatcache(true,$path);
        if(is_link($path)||realpath($path)!==$path||!str_starts_with($path,$root.'/')||!is_file($path)||filesize($path)!==$file['bytes']||filemtime($path)!==$file['mtime']||file_exists($destination))throw new \InvalidArgumentException('Recording changed. Refresh preview.');
        $db=$this->state();$db->beginTransaction();$moved=false;
        try {
            $s=$db->prepare('INSERT INTO quarantine(id,original,stored,bytes,at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET restored=0,at=excluded.at WHERE quarantine.restored=1');$s->execute([$id,$path,$destination,$file['bytes'],gmdate(DATE_ATOM)]);
            if(!$s->rowCount())throw new \InvalidArgumentException('Recording already quarantined');
            if(!rename($path,$destination))throw new \RuntimeException('Cannot quarantine recording');$moved=true;
            $this->auditEvent('recording.quarantined',$id);$db->commit();unset($_SESSION['nixops_retention']['files'][$id]);
        } catch(\Throwable $e){if($db->inTransaction())$db->rollBack();if($moved)rename($destination,$path);throw $e;}
        return ['saved'=>true];
    }
    public function restoreRecording() {
        $this->mutation('manage');$id=(string)($_POST['id']??'');$db=$this->state();$s=$db->prepare('SELECT * FROM quarantine WHERE id=? AND restored=0');$s->execute([$id]);$row=$s->fetch(\PDO::FETCH_ASSOC);
        $root=realpath('/var/spool/asterisk/monitor');
        $parent=$row?dirname($row['original']):'';
        if(!$row||!$root||!str_starts_with($row['original'],$root.'/')||!str_starts_with($parent,$root)||file_exists($row['original'])||is_link($row['original'])||realpath($row['stored'])!==$row['stored']||!str_starts_with($row['stored'],'/var/spool/asterisk/nixops-quarantine/'))throw new \InvalidArgumentException('Cannot safely restore this file; contact an administrator');
        if(!is_dir($parent)&&!mkdir($parent,0750,true)&&!is_dir($parent))throw new \RuntimeException('Restore folder unavailable');
        if(realpath($parent)!==$parent)throw new \InvalidArgumentException('Restore folder is not safe');
        $db->beginTransaction();$moved=false;
        try {
            if(!rename($row['stored'],$row['original']))throw new \RuntimeException('Restore unavailable');$moved=true;
            $s=$db->prepare('UPDATE quarantine SET restored=1 WHERE id=?');$s->execute([$id]);$this->auditEvent('recording.restored',$id);$db->commit();
        } catch(\Throwable $e){if($db->inTransaction())$db->rollBack();if($moved)rename($row['original'],$row['stored']);throw $e;}
        return ['saved'=>true];
    }
}
