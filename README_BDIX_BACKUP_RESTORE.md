# 🚀 BDIX FreePBX + WireGuard + E-commerce IVR Full Backup & Restore Guide

এই ফোল্ডারে আপনার BDIX VPS (`103.169.160.153`)-এর সম্পূর্ণ সিস্টেমের ফুল ব্যাকআপ ফাইলটি সংরক্ষিত আছে:
- **ফাইল নাম:** `bdix_freepbx_wireguard_backup_20261018_022217.tar.gz`
- **সাইজ:** ~১৯৩ MB
- **ব্যাকআপ তৈরির তারিখ:** ১৮ অক্টোবর ২০২৬

---

## 📦 এই ব্যাকআপ ফাইলের ভেতর কী কী সংরক্ষিত আছে?

1. **FreePBX MySQL/MariaDB Full Database (`asterisk`, `asteriskcdrdb`):**
   - আপনার সকল SIP ট্রাঙ্ক (ICC Talk `09639139179`, Sarker Comm `09649979999` ইত্যাদি)।
   - সকল এক্সটেনশন (`101`, `102`, `103`, এবং WebRTC কলিংয়ের জন্য `webrtc_agent`) এবং তাদের সিক্রেট/পাসওয়ার্ড।
   - ইনবাউন্ড ও আউটবাউন্ড রাউটিং রুলস, ট্রাঙ্ক ডায়ালপ্ল্যান রুলস ও প্রিফিক্স।
   - সম্পূর্ণ কল হিস্টোরি (CDR Reports)।
2. **Asterisk Configuration & WebRTC Certificates:**
   - `/etc/asterisk/` ফোল্ডারের সব কনফিগারেশন।
   - কাস্টম ফাস্ট ডায়ালপ্ল্যান: `extensions_custom.conf` (`[from-webrtc-fast]`, `[ecommerce-order-verify]`)।
   - WebRTC PJSIP কনফিগারেশন: `pjsip.endpoint_custom.conf`।
   - WebRTC এনক্রিপশনের DTLS SSL সার্টিফিকেট ও চাবি (`/etc/asterisk/keys/`)।
3. **WireGuard VPN:**
   - সম্পূর্ণ WireGuard কনফিগারেশন, সার্ভার ও ক্লায়েন্ট প্রাইভেট/পাবলিক কী (`/etc/wireguard/`)।
4. **Custom Audio Prompts:**
   - বাংলা ই-কমার্স অর্ডার ভেরিফিকেশন সাউন্ডস (`/var/lib/asterisk/sounds/ecommerce-ivr/` - intro, confirmed, cancelled, invalid)।
   - সিস্টেম সাউন্ডস ও প্রম্পটস।
5. **E-commerce IVR Agent & Daemon:**
   - সুরক্ষিত নোডজেএস সার্ভিস: `/opt/pbx-ivr-agent/` (port 7088)।
   - ডায়ালপ্ল্যান রেজাল্ট ওয়েবহুক রিপোর্টার: `/usr/local/bin/ivr-callback.sh`।
   - ব্যাকগ্রাউন্ড সিস্টেম সার্ভিস: `/etc/systemd/system/pbx-ivr-agent.service`।
6. **1-Click Auto-Restore Script:**
   - আর্কাইভের ভেতর `restore.sh` স্ক্রিপ্ট অন্তর্ভুক্ত করা আছে।

---

## 🛠️ নতুন VPS-এ হুবহু রিস্টোর করার স্টেপ-বাই-স্টেপ গাইড

ভবিষ্যতে যদি নতুন কোনো সার্ভারে এই ব্যাকআপটি রিস্টোর করতে চান, নিচের ধাপগুলো অনুসরণ করুন:

### ধাপ ১: নতুন VPS প্রস্তুত করুন
নতুন VPS-এ Debian / Ubuntu অথবা FreePBX-এর যেকোনো ডিস্ট্রো ইনস্টল করা থাকতে হবে। সার্ভারে SSH অ্যাক্সেস নিশ্চিত করুন।

### ধাপ ২: ব্যাকআপ ফাইলটি নতুন সার্ভারে আপলোড করুন
আপনার লোকাল পিসির PowerShell বা Terminal ওপেন করে নিচের কমান্ড দিন:
```powershell
scp bdix_freepbx_wireguard_backup_20261018_022217.tar.gz root@<NEW_VPS_IP>:/root/
```
*(এখানে `<NEW_VPS_IP>`-এর জায়গায় আপনার নতুন সার্ভারের আইপি দিন)*

---

### ধাপ ৩: নতুন সার্ভারে SSH দিয়ে লগইন করুন
```bash
ssh root@<NEW_VPS_IP>
```

---

### ধাপ ৪: ব্যাকআপ ফাইলটি আনপ্যাক (Extract) করুন
```bash
cd /root
tar -xzf bdix_freepbx_wireguard_backup_20261018_022217.tar.gz
```
এই কমান্ড দিলে `/root/bdix_full_backup` নামে একটি ফোল্ডার তৈরি হবে।

---

### ধাপ ৫: ১-ক্লিক রিস্টোর স্ক্রিপ্টটি চালান
```bash
cd /root/bdix_full_backup
chmod +x restore.sh
./restore.sh
```

---

## ⚡ রিস্টোর স্ক্রিপ্ট চালানোর পর কী ঘটবে?
স্ক্রিপ্টটি স্বয়ংক্রিয়ভাবে নিচের কাজগুলো সম্পন্ন করবে:
1. WireGuard VPN প্যাকেজ ইনস্টল করে আপনার আগের সব VPN কী ও টানেল ইন্টারফেস চালু করবে।
2. Asterisk-এর সমস্ত কনফিগ ও WebRTC DTLS সার্টিফিকেট যথাস্থানে বসিয়ে পারমিশন ফিক্স করবে।
3. বাংলা IVR সাউন্ড ও প্রম্পট ফাইলগুলো রিস্টোর করবে।
4. FreePBX ডাটাবেজ ইমপোর্ট করবে (ফলে সব ট্রাঙ্ক ও এক্সটেনশন মুহূর্তেই রিস্টোর হবে)।
5. PBX IVR Agent সার্ভিস রিস্টোর করে systemd-তে ব্যাকগ্রাউন্ডে স্টার্ট করবে।
6. Asterisk সার্ভিস গ্রেসফুলি রিস্টার্ট করবে।

---

## 🔍 রিস্টোর সম্পন্ন হওয়ার পর ভেরিফিকেশন চেক

সবকিছু ঠিকঠাক কাজ করছে কি না তা নিশ্চিত হতে নিচের ৩টি কমান্ড চালিয়ে দেখতে পারেন:

1. **ট্রাঙ্ক রেজিস্ট্রেশন চেক:**
   ```bash
   asterisk -rx "pjsip show registrations"
   ```
   *(এখানে ICC Talk এবং Sarker Comm ট্রাঙ্ক Registered দেখাবে)*

2. **WebRTC এন্ডপয়েন্ট চেক:**
   ```bash
   asterisk -rx "pjsip show endpoint webrtc_agent"
   ```

3. **WireGuard VPN স্ট্যাটাস চেক:**
   ```bash
   wg show
   ```

4. **IVR সার্ভিস স্ট্যাটাস চেক:**
   ```bash
   systemctl status pbx-ivr-agent
   ```

---

## ⚠️ গুরুত্বপূর্ণ নোট (নতুন সার্ভারের আইপি পরিবর্তন হলে):
- যদি নতুন VPS-এর পাবলিক আইপি পরিবর্তন হয়, তবে ই-কমার্স অ্যাডমিন প্যানেলে **Settings -> PBX IVR Settings**-এ গিয়ে **PBX Server URL** ফিল্ডে নতুন আইপি অ্যাড্রেসটি দিয়ে সেভ করুন:
  - `http://<NEW_VPS_IP>:7088`
- ট্রাঙ্ক প্রোভাইডার (ICC Talk / Sarker Comm)-এর সাথে যদি আইপি হোয়াইটলিস্ট করা থাকে, তবে প্রোভাইডারকে নতুন সার্ভারের আইপি জানিয়ে আপডেট করে নিতে হবে।
