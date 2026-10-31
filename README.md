# Pettuadae, Maros — open world 3D

Game open world 3D berbasis browser (Three.js + Vite) dengan latar Kelurahan Pettuadae, Kecamatan Turikale, Kabupaten Maros, Sulawesi Selatan.
Peta dibangun dari data sungguhan:

- **Jalan, sungai, denah bangunan, nama tempat**: OpenStreetMap (414 jalan, 4.327 bangunan, Sungai Maros, Jembatan Maros, 160+ tempat bernama).
- **Warna atap tiap bangunan dan posisi pohon**: diturunkan dari citra satelit (Esri World Imagery). Hanya warna/posisi yang disimpan, bukan gambarnya.
- **Landmark yang dimodel khusus**: Masjid Al Markaz Al Islami Maros (kubah putih + menara), Kantor Bupati Maros (atap limas merah + rotunda), pasar, museum, masjid-masjid kecil, sekolah dengan tiang bendera.
- **Kantor BPS Kabupaten Maros bisa dimasuki** (`src/game/maros/bps.js`): pintu kaca geser otomatis, ruang Pelayanan Statistik Terpadu (meja layanan, antrean, ruang tunggu, perpustakaan), ruang staf, toilet, tangga ke lantai 2 (ruang rapat, ruang kepala), parkir dan tiang bendera. Denah, jumlah lantai, atap datar dan posisi parkir dari OSM + citra satelit; fasad dan tata ruang dalam masih perkiraan (belum ada foto).

## Fitur

| Fitur | Keterangan |
|---|---|
| Jalan kaki | Jog, sprint dengan stamina (Shift), jalan pelan (Alt), lompat (Space) |
| Kendaraan | Motor matic, MPV, pickup, pete-pete, mobil sport. Naik/turun dengan F |
| Ambil kendaraan | F di dekat kendaraan traffic yang pelan: sopirnya kabur |
| Lalu lintas | 40 kendaraan AI di lajur kiri mengikuti jalan asli, 44 pejalan kaki |
| Peta besar | M: geser, zoom, nama jalan, ikon tempat. Klik untuk waypoint |
| GPS | Rute A* di jaringan jalan, tampil di jalan, minimap dan peta |
| Misi antar | Antar kendaraan ke tempat bernama asli sebelum waktu habis |
| Siang/malam | 1 hari = 24 menit, T untuk mempercepat. Jendela, papan toko, lampu jalan menyala malam |
| Nama jalan | Muncul saat masuk jalan baru, seperti GTA |
| Simpan | Uang, jam, dan posisi tersimpan otomatis (localStorage) |
| Grafik | Menu pause: Otomatis (resolusi menyesuaikan FPS) / Tinggi / Sedang / Rendah |
| Jalan | Lebar diukur dari citra satelit; jalan terpisah (Jl. Jenderal Sudirman) dengan median, trotoar + kerb, marka lajur, pagar jembatan, papan nama jalan |
| Toko & tempat | 453 tempat asli dari Overture Maps (rumah makan, kafe/warkop, toko, bank, jasa...) dengan papan nama di bangunannya; tempat tanpa bangunan jadi kios |
| Animasi | Buka pintu sopir (setir kanan) saat naik/turun mobil, naik motor, sopir kabur saat kendaraan diambil, idle napas |

## Jalankan

```bash
npm install
npm run dev
```

Deploy ke Vercel: push ke GitHub, import di Vercel (preset Vite, `vercel.json` sudah ada).

## Data

Data mentah sudah ada di repo, tidak perlu diunduh ulang. Untuk memperbarui atau memindah lokasi:

    node scripts/fetch-osm.mjs -5.01425 119.57761 1300 src/game/maros/data/pettuadae.json
    node scripts/sample-imagery.mjs
    node scripts/measure-roads.mjs        # lebar jalan dari citra (butuh cache tile dari sample-imagery)
    pip install duckdb && python scripts/fetch-places.py   # toko/restoran/kafe dari Overture Maps

Atribusi tempat: Overture Maps Foundation (Places).

Atribusi wajib (sudah tampil di layar judul): © kontributor OpenStreetMap (ODbL); citra: Esri, Maxar, Earthstar Geographics.

## Struktur

| File | Tanggung jawab |
|---|---|
| `src/core/` | Engine render, audio, input, UI, tekstur prosedural, model manusia & kendaraan |
| `src/game/openworld.js` | Game loop: kamera, kontrol, kendaraan, carjack, damage, misi, GPS, HUD, simpan |
| `src/game/vehicles.js` | Fisika kendaraan (mobil & motor) dan tabrakan |
| `src/game/player.js` | Karakter jalan kaki, stamina, pose naik motor |
| `src/game/maros/osm.js` | Olah data OSM: graf jalan, indeks spasial, analisis denah |
| `src/game/maros/buildings.js` | Rumah, ruko + papan nama, rumah panggung, kantor, sekolah, landmark |
| `src/game/maros/terrain.js` | Tanah, sawah, sungai, jalan + marka, pohon, tiang listrik, lampu |
| `src/game/maros/traffic.js` | Lalu lintas AI di graf jalan |
| `src/game/maros/peds.js` | Pejalan kaki |
| `src/game/maros/minimap.js` | Minimap radar + peta layar penuh |
| `src/game/maros/route.js` | Routing GPS (A*) |

Uji otomatis: buka `/?debug`, lalu `window.__city` mengekspos state dan `tick(dt, t)` untuk simulasi cepat tanpa render.
