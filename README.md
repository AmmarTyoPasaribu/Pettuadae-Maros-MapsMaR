# Pettuadae, Maros — open world 3D

Game open world 3D berbasis browser (Three.js + Vite) dengan latar Kelurahan Pettuadae, Kecamatan Turikale, Kabupaten Maros, Sulawesi Selatan.
Peta dibangun dari data sungguhan:

- **Jalan, sungai, denah bangunan, nama tempat**: OpenStreetMap (414 jalan, 4.327 bangunan, Sungai Maros, Jembatan Maros, 160+ tempat bernama).
- **Ketinggian tanah**: AWS Terrain Tiles (SRTM). Kota berada di 5–9 m, ada bukit kecil di dalam kelokan Sungai Maros. Jalan, rumah, pohon, kendaraan dan orang semuanya mengikuti ketinggian ini.
- **Warna atap tiap bangunan dan posisi pohon**: diturunkan dari citra satelit (Esri World Imagery). Hanya warna/posisi yang disimpan, bukan gambarnya.
- **Toko & tempat usaha**: 453 tempat asli dari Overture Maps (rumah makan, warkop, toko, bank, jasa…).
- **Landmark yang dimodel khusus**: Masjid Al Markaz Al Islami Maros, Kantor Bupati Maros, pasar, museum, masjid, sekolah.
- **Kantor BPS Kabupaten Maros bisa dimasuki** (`src/game/maros/bps.js`): pintu kaca geser otomatis, ruang Pelayanan Statistik Terpadu, ruang staf, tangga ke lantai 2, parkir dan tiang bendera. Fasad dan tata ruang dalam masih perkiraan (belum ada foto).

## Fitur

| Fitur | Keterangan |
|---|---|
| Medan sungguhan | Tanjakan dan turunan dari data elevasi, alur sungai dengan tebing, tanggul jalan, jembatan dengan punggung, tiang penyangga dan pagar, kolam |
| Air & berenang | Air beriak dan memantulkan langit, mengalir searah sungai. Berenang di air dalam (Shift lebih cepat), kendaraan yang masuk air tenggelam |
| Kendaraan | Motor matic, MPV, pickup, pete-pete, mobil sport, **sepeda** (kayuh, bel), mobil polisi. Naik/turun dengan F, ambil kendaraan traffic |
| Senjata | Pistol (12 peluru, R isi ulang) dan tangan kosong. Klik kanan membidik (kamera bahu), klik kiri menembak. Kendaraan rusak berasap, terbakar, lalu meledak |
| Polisi | Bintang buronan 0–5. Mobil polisi bersirene mengejar lewat jalan, polisi turun mengejar, menembak (bintang 2+) dan menangkap (BUSTED). Bintang hilang kalau lolos dari pandangan |
| Warga | 44 pejalan kaki, warga nongkrong di warung (duduk ngopi, ngobrol), panik saat ada tembakan |
| Hewan | Ayam di halaman (ayam jago berkokok pagi), kucing, kambing di lorong, sapi Bali di sawah, bebek di sungai, kawanan burung |
| Warung | E di dekat rumah makan, warkop atau gerobak: beli makan Rp15.000, darah +45 |
| Detail kampung | Pagar rumah (besi, tembok, bambu), toren air, AC, gapura lorong merah-putih, polisi tidur, tong sampah, gerobak dagangan, bangku warung, umbul-umbul, petak sawah |
| Cuaca | Cerah, berawan, hujan, badai petir. Awan bergerak, hujan, jalan basah mengilap, kabut, kilat |
| Suara | Semua prosedural: musik menu (petikan kecapi, suling), radio mobil (pop daerah, dangdut, lo-fi; B ganti), mesin, sirene, tembakan, ledakan, langkah, cipratan, burung, jangkrik, katak, hujan, guntur, suara hewan |
| Antarmuka | Layar loading bertahap dengan tips, menu utama sinematik (Pengaturan, Kontrol, Tentang), HUD ala GTA (uang, jam & cuaca, senjata & peluru, bintang, minimap + darah/stamina, speedometer), WASTED / BUSTED |
| Pengaturan | Kualitas grafik (Otomatis menyesuaikan FPS), volume utama/musik/efek/suasana, sensitivitas mouse, balik sumbu Y, FPS |
| Lainnya | Peta besar + GPS (A*), misi antar ke tempat asli, siang/malam, nama jalan, simpan otomatis |

## Kontrol

| Tombol | Aksi |
|---|---|
| W A S D | Jalan · gas, rem, belok |
| Shift | Sprint / berenang cepat / kayuh cepat |
| Space | Lompat · rem tangan |
| F | Naik / turun / ambil kendaraan |
| E | Beli makan di warung |
| Klik kanan / kiri | Bidik / tembak atau pukul |
| 1 · 2 · roda mouse | Ganti senjata |
| R | Isi peluru |
| M | Peta & waypoint GPS |
| B | Ganti stasiun radio |
| H | Klakson / bel sepeda |
| T | Percepat waktu |
| P / Esc | Jeda |

Layar sentuh: joystick kiri/kanan dan tombol AKSI, LOMPAT, LARI, PETA, TEMBAK (bidik otomatis), SENJATA.

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
    node scripts/fetch-elevation.mjs      # ketinggian tanah (AWS Terrain Tiles, dihaluskan)

Atribusi wajib (tampil di layar judul): © kontributor OpenStreetMap (ODbL); tempat: Overture Maps Foundation; citra: Esri, Maxar, Earthstar Geographics; elevasi: AWS Terrain Tiles (Mapzen, SRTM).

## Struktur

| File | Tanggung jawab |
|---|---|
| `src/core/` | Engine render, audio & musik prosedural, input, UI/menu, tekstur prosedural, model manusia & kendaraan |
| `src/game/openworld.js` | Game loop: kamera, kontrol, kendaraan, senjata, polisi, misi, GPS, HUD, cuaca, simpan |
| `src/game/vehicles.js` | Fisika kendaraan: lereng, melayang di puncak, tenggelam, tabrakan |
| `src/game/player.js` | Jalan kaki, stamina, berenang, naik motor/sepeda |
| `src/game/combat.js` | Senjata, hitscan, tracer, partikel, ledakan |
| `src/game/police.js` | Bintang buronan, mobil polisi, polisi jalan kaki |
| `src/game/weather.js` | Awan, hujan, badai, kilat |
| `src/game/maros/elevation.js` | Grid ketinggian 4 m: alur sungai, kolam, tanggul jalan, dek jembatan |
| `src/game/maros/ground.js` | Mesh tanah dengan LOD dan warna per tutupan lahan |
| `src/game/maros/water.js` | Material air (riak bergerak, Fresnel) |
| `src/game/maros/terrain.js` | Jalan + marka, trotoar, jembatan, pohon (bergoyang), tiang listrik, lampu |
| `src/game/maros/buildings.js` | Rumah, ruko + papan nama, rumah panggung, kantor, sekolah, landmark |
| `src/game/maros/props.js` | Pagar, toren, AC, gapura, polisi tidur, tong sampah, gerobak, umbul-umbul |
| `src/game/maros/animals.js` | Ayam, kucing, kambing, sapi, bebek, burung |
| `src/game/maros/traffic.js` · `peds.js` | Lalu lintas AI dan pejalan kaki |
| `src/game/maros/minimap.js` · `route.js` | Minimap, peta layar penuh, GPS |

Uji otomatis: buka `/?debug`, lalu `window.__city` mengekspos state dan `tick(dt, t)` untuk simulasi cepat tanpa render.

Dibuat oleh **Ammar Tyo Pasaribu**.
