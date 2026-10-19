# NOEMA Duel doğrulaması — 17 Ekim 2026

- Üretim: `npm run build` başarılı; TypeScript, Vite paketi, eğitim Worker'ı ve çevrimdışı önbellek üretildi.
- Birim / regresyon: 10 dosyada 80 / 80 test başarılı. `npm test` test dosyalarını seri çalıştırır; yoğun sayısal eğitim testlerinin aynı anda çalışıp bu makinedeki süre sınırlarını aşması önlenir.
- Motorun 25 testi: yarı saha sınırları, seken / geçirgen malzemeler, hızlı atışın engeli atlamaması, bir karede birden çok sekme, taşınabilir siper, siperin kırılması, etkileşim darbeleri, manuel / öğrenilen komutlarda otomatik taktik uygulanmaması, sağlıkla zafer / beraberlik, duraklatma, sabit fizik adımları ve farklı rakip taktikleri.
- Öğrenmenin 6 testi: gerçek ağ parametreleri, JSON doğrulama, eğitim dışında bırakılan durumlarda hareket / nişan / güç / ateş öğrenmesi, nadir siper örneklerinin korunması, sonlu girdiler ve iptal.
- Gerçek tarayıcı: `e2e/duel.mjs`, `BASE_URL=http://127.0.0.1:5174` ile 14 kontrolü geçti; JavaScript veya konsol hatası yok.
- Gerçek öğretim: klavye hareketi ve ateşten 21 örnek kaydedildi. Ayrı Worker 2.100 örnek güncellemesi yaptı. Eğitim hatası 0,1136; model daha sonra gösterilen hareketi ve ateşi üretti. Öğrenilen robot oynarken kendi çıktıları eğitim etiketi olarak kaydedilmedi.
- Kayıt: ağırlıklar ve gösterimler IndexedDB'den gerçek sayfa yenilemesinden sonra geri geldi; üç kortta model korundu.
- Görünüm: 1440 px masaüstü, 390 / 768 px dokunmatik arayüzlerde yatay taşma yok. Başlatma, duraklatma ve sıfırlama çalışıyor. Perspektif / üstten kamera ve atış çizgileri doğrulandı.
- Tam ekran: 390 × 844 ve 604 × 268 görünümde gerçek dokunma olaylarıyla hareket, ateş, güç ayarı ve çıkış doğrulandı; kontroller görünüm içinde kalıyor. Başlat düğmesi odaktayken klavye hareketi de çalışıyor. Rapor: `artifacts/duel/controls.json`.
- Çevrimdışı üretim: servis worker ile önbelleğe alınan paket bağlantı kesilip yeniden açıldı. Gerçek hareket / ateş girdilerinden 17 örnek kaydedildi; önbellekteki üretim eğitim Worker'ı modeli eğitti ve **Robotumu izle** öğrenilen robot maçını çevrimdışı başlattı. Tarayıcı / konsol hatası ve başarısız ağ isteği yok. Rapor: `artifacts/duel/offline.json`.
- Ekran görüntüleri ve ayrıntılı rapor: `artifacts/duel/duel.json`, `desktop-ready.png`, `desktop-trained.png`, `desktop-learned-match.png`, `mobile-390-ready.png`, `mobile-768-ready.png`.

Küçük bir gösterim seti her kortta kazanmayı garanti etmez. Kapalı döngü denemesinde öğrenilen robot hareket etti ve ateş etti; rakip isabetleri sağlık azalttı. Bu deneme 45 simülasyon saniyesi boyunca izlendi, her iki robot da kendi sahasında kaldı. Maç sadece can bitince sonuçlanır; belirli sürede kazanma zorlaması yoktur.

Android / iOS paketleri bu değişiklik için yeniden derlenmedi. Tarayıcıdaki dokunmatik kontroller doğrulandı; fiziksel telefon performans ölçümü yapılmadı.
