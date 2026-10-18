<?php
// Isolated state and synthetic audio; production CDR is only read.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require '/etc/freepbx.conf';
$source=$argv[1]??'/root/nixops-stage';
$test=sys_get_temp_dir().'/nixops-test-'.bin2hex(random_bytes(8));mkdir($test,0700);mkdir($test.'/state',0700);mkdir($test.'/monitor',0700);mkdir($test.'/quarantine',0700);
$cleanup=function($path) use (&$cleanup,$test) { if(!str_starts_with($path,$test.'/')&&$path!==$test)throw new RuntimeException('Unsafe cleanup');if(is_dir($path)&&!is_link($path)){foreach(scandir($path) as $item)if($item!=='.'&&$item!=='..')$cleanup($path.'/'.$item);rmdir($path);}else unlink($path); };
function expect($ok,$name){if(!$ok)throw new RuntimeException('FAILED '.$name);}
try {
    foreach(['Nixops.class.php','Operations.php'] as $file){$code=file_get_contents($source.'/'.$file);$code=str_replace(['/var/lib/nixops-console','/var/spool/asterisk/monitor','/var/spool/asterisk/nixops-quarantine'],[$test.'/state',$test.'/monitor',$test.'/quarantine'],$code);file_put_contents($test.'/'.$file,$code);}
    require $test.'/Nixops.class.php';$module=new \FreePBX\modules\Nixops(\FreePBX::Create());
    $admin=new class {public $username='test-admin';public function checkSection($s){return true;}};
    $viewer=new class {public $username='test-viewer';public function checkSection($s){return $s==='nixops';}};
    $_SESSION['AMP_user']=$admin;$_SESSION['nixops_token']=str_repeat('a',64);$_SERVER['HTTP_X_NIXOPS_TOKEN']=$_SESSION['nixops_token'];
    $call=function($command,$values=[],$post=false)use($module){http_response_code(200);$_SERVER['REQUEST_METHOD']=$post?'POST':'GET';$_POST=$post?$values:[];$_REQUEST=['command'=>$command,...$values];return $module->ajaxHandler();};
    $settings=$call('settings');expect($settings['success'],'admin settings');$values=$settings['data']['values']+['version'=>0];
    expect(!$call('saveSettings',$values)['success']&&http_response_code()===405,'mutations require POST');
    expect($call('saveSettings',$values,true)['success'],'save settings');expect(!$call('saveSettings',$values,true)['success'],'settings version conflict');
    foreach(['http://example.com','https://example.com/admin/orders','https://evil.nix.bd/admin/orders','https://user:secret@nix.bd/admin/orders','https://nix.bd/admin/orders?leak=1','javascript:alert(1)'] as $url)expect(!$call('saveSettings',[...$values,'version'=>1,'ordersUrl'=>$url],true)['success'],'unsafe orders URL');
    $_SESSION['AMP_user']=$viewer;
    foreach(['settings','roles','audit','retention'] as $command)expect(!$call($command)['success']&&http_response_code()===403,'viewer denied '.$command);
    expect(!$call('saveFollowup',[],true)['success']&&http_response_code()===403,'viewer cannot mutate');
    $_REQUEST=['command'=>'export'];ob_start();$module->ajaxCustomHandler();$denied=json_decode(ob_get_clean(),true);expect(!$denied['success']&&http_response_code()===403,'viewer cannot export');
    $db=new PDO('sqlite:'.$test.'/state/operations.sqlite');$db->exec("INSERT INTO roles VALUES ('test-viewer','operator')");
    expect($call('capabilities')['data']['followup']&&!$call('capabilities')['data']['media'],'operator capability split');
    $id=str_repeat('c',64);$s=$db->prepare('INSERT INTO followups(id,phone,call_id,call_time,updated) VALUES(?,?,?,?,?)');$s->execute([$id,'1001','test-call','2026-10-18 00:00:00',gmdate(DATE_ATOM)]);
    $edit=['id'=>$id,'version'=>1,'status'=>'in_progress','owner'=>'test-operator','note'=>'Callback requested'];
    expect($call('saveFollowup',$edit,true)['success'],'operator update');expect(!$call('saveFollowup',$edit,true)['success'],'followup conflict');
    expect($call('followups',['followupStatus'=>'in_progress'])['data']['rows'][0]['note']==='Callback requested','persisted notes');
    expect(!$call('customer',['phone'=>"' OR 1=1"])['success'],'invalid phone');
    $result=$call('customer',['phone'=>'1001']);expect($result['success']&&str_contains($result['data']['ordersUrl'],'search=1001'),'customer history link');
    $_SESSION['AMP_user']=$admin;
    file_put_contents($test.'/monitor/old.wav',str_repeat('x',128));touch($test.'/monitor/old.wav',time()-100*86400);
    file_put_contents($test.'/monitor/recent.wav',str_repeat('y',128));symlink('/etc/passwd',$test.'/monitor/link.wav');
    $preview=$call('retention');expect($preview['success']&&count($preview['data']['files'])===1,'retention age and symlink guard');$file=$preview['data']['files'][0];
    expect(!$call('quarantine',['id'=>$file['id'],'token'=>'invalid'],true)['success'],'preview token guard');
    $move=$call('quarantine',['id'=>$file['id'],'token'=>$preview['data']['token']],true);expect($move['success']&&!file_exists($test.'/monitor/old.wav'),'quarantine move');
    expect($call('restoreRecording',['id'=>$file['id']],true)['success']&&file_get_contents($test.'/monitor/old.wav')===str_repeat('x',128),'restore intact');
    expect(!$call('restoreRecording',['id'=>$file['id']],true)['success'],'repeat restore rejected');
    expect(count($call('audit')['data'])>=5,'audit captured');
    $integrity=shell_exec('/usr/bin/sqlite3 '.escapeshellarg($test.'/state/operations.sqlite').' "PRAGMA integrity_check;"');expect(trim((string)$integrity)==='ok','database integrity');
    echo json_encode(['success'=>true,'checks'=>['admin_settings','post_required','optimistic_conflicts','unsafe_urls_denied','viewer_denied','operator_scope','followup_persistence','customer_lookup','retention_boundary','symlink_guard','quarantine_restore','audit','sqlite_integrity']]).PHP_EOL;
} finally { $cleanup($test); }
