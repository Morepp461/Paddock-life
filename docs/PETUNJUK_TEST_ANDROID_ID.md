# Panduan Test Android Paddock Life

Dokumen ini untuk APK **debug/development**, bukan rilis Play Store. APK terbaru dibuat dari kode main; build dan CI sukses, tetapi belum diuji secara fisik di perangkat oleh tim pengembang. Lakukan pengujian di save baru terlebih dahulu.

## 1. Instalasi dan startup
1. Buka **Actions → Android Debug APK** di repositori GitHub, pilih run terbaru pada branch main, lalu unduh artifact **paddock-life-debug-apk**.
2. Ekstrak ZIP dan instal APK di perangkat Android. Jika Android meminta izin instalasi dari sumber tersebut, gunakan izin untuk aplikasi pengunduh/file manager yang memang kamu gunakan.
3. Pastikan aplikasi terbuka dalam orientasi landscape, tidak terpotong di tepi layar, dan data katalog selesai dimuat.
4. Pada layar New Career, pastikan daftar negara, nama tim, tier, dan jalur karier tampil tanpa error.

## 2. Buat career dan uji penyimpanan
1. Isi Manager Name dan pilih negara serta difficulty.
2. Uji **Take over** dengan tim Tier 1–5; Tier 6 memang tidak tersedia di Career Mode.
3. Di save terpisah, uji **Found a team** untuk Tier 5, 4, lalu 3. Pilih pengganti AI team yang berkekuatan Lemah atau Menengah pada tier yang sama.
4. Isi World Seed dengan teks tetap, misalnya test-run-001. Catat seed yang kamu pakai untuk laporan bug.
5. Setelah dashboard terbuka, kembali ke Main Menu, lanjutkan save tadi, lalu tutup paksa dan buka aplikasi lagi. Pastikan save tetap terdaftar dan bisa dilanjutkan.

## 3. Uji race weekend
1. Pilih compound ban yang legal untuk kondisi lintasan yang ditampilkan.
2. Pada dry race Tier 1–3, layar development build meminta dua compound berbeda, planned pit lap, dan **QA total pit-loss override** bernilai positif. Override ini hanya input uji sementara, **bukan nilai pit-loss resmi**. Catat nilainya saat melaporkan hasil.
3. Jalankan race weekend. Periksa hasil qualifying, starting grid, hasil sprint bila round tersebut memang punya sprint, hasil race utama, poin, klasemen driver/konstruktor dan finance ledger.
4. Setelah hasil tampil, kembali ke dashboard dan pastikan round berubah menjadi completed. Tombol race tidak boleh menyelesaikan round yang sama dua kali.
5. Uji minimal satu round sprint dan satu round tanpa sprint bila jadwal tier yang dipilih memilikinya.

## 4. Uji operasi tim
1. **Drivers / Transfer Market:** verifikasi roster utama, asking salary, target tier, umur, ketersediaan kursi, dan hasil negosiasi kontrak. Uji penawaran release clause hanya di save uji karena transaksi memindahkan driver dan saldo antar tim.
2. **Youth Loan:** di awal season, pinjam satu driver Academy ke tim yang memenuhi syarat di divisi lebih rendah; pastikan driver tidak terhitung dua kali di grid.
3. **Sponsors:** terima satu penawaran dan tolak penawaran lain. Keluar dari career, buka lagi, lalu cek status masih tersimpan.
4. **Development:** mulai satu proyek yang memenuhi syarat fasilitas/budget, lanjutkan race untuk menambah progres, dan uji pembatalan serta refund dalam save terpisah.
5. **Facilities:** naikkan Driver Academy dan Training Facilities jika saldo cukup. Pastikan level dan ledger berubah bersama; TrainingQuality harus mengikuti 0.6 + 0.05 × level.
6. **Staff:** rekrut free-agent staff dengan saldo cukup, lalu jalankan race untuk memastikan payroll masuk ke ledger.
7. **Finance:** cek cash, debt, budget dan transaksi sebelum/sesudah race dan upgrade fasilitas.

## 5. Uji tutup season dan lanjut season
Selesaikan round yang dijadwalkan untuk tier pemain, lalu gunakan tombol penyelesaian season. Proses divisi lain bila diminta dashboard sampai world transition selesai. Pastikan settlement tidak bisa dibayarkan dua kali, kalender season berikutnya berbeda sesuai seed, dashboard tetap menunjuk ke tim pemain yang benar, dan career bisa disimpan/dilanjutkan setelah rollover.

## 6. Hal yang memang belum dianggap lulus
- Race flow belum sepenuhnya mengorkestrasi pit engine, insiden, kegagalan komponen, Markov weather transitions, safety car/VSC dan red-flag recovery.
- Temperatur sirkuit masih menggunakan placeholder 25°C karena pool sirkuit sumber tidak menyediakan field suhu lintasan.
- Pertumbuhan statistik driver per season belum otomatis diterapkan ke statistik persisten; formula dan age factors sudah diuji, tetapi sumber tidak menetapkan perhitungan Overall/PotentialRemaining yang lengkap.
- Role/salary mapping untuk retired-driver staff candidates belum ditentukan sumber.
- Cloud sync, authentication, rewarded ads server-authoritative, dan validasi pembelian belum siap. Jangan melakukan transaksi monetisasi nyata.

## 7. Laporan bug
Untuk setiap masalah, catat: model perangkat, versi Android, save seed, tier, round, langkah persis sebelum bug, hasil yang diharapkan, hasil aktual, dan teks error. Screenshot boleh menyertakan UI, tetapi jangan mengirim kredensial atau data pribadi. Jika crash, jelaskan apakah terjadi saat startup, create career, race, settlement, atau resume save.
