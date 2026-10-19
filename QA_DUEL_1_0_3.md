# Noema Duel 1.0.3 — Canlı model kontrolleri

Robotumu izle modunda hareket isteği analog joystick, yön etiketi, yüzde ve X/Z değerleriyle görünür. Ateş ve Al / bırak göstergeleri aynı anda etkinleşebilir. Gösterge modelin son çıktısını yeniden hesaplamaz; fizik motoruna gerçekten gönderilmiş komutu okur. Engelde sıfır hıza düşmek, hareket isteğini gizlemez.

İstenen ateş ile gerçekten çıkan mermi ayrılır. Gerçek atış ve siper değişimleri 0,25 simülasyon saniyesi işaretlenir; atış bekleme süresi ve siper taşıma bilgisi görünür. Taşınan kutunun parçalanması, bırakma işlemi olarak işaretlenmez ve eski alma işaretini temizler. Duraklama ve maç sonunda son gerçek komut korunur. Yeni maçta gösterge sıfırlanır; Kontrolü devral ile manuel joystick geri gelir.

Gösterge normal ve dikey tam ekranda alt satırda, yatay tam ekranda alt köşelerde bulunur. Etkileşimli öğe içermez ve pointer-events:none kullanır. Eğitim paneli sağdaki Eğit düğmesinden açılır; kalıcı eğitim satırı geri getirilmedi.

Dar dikey ekranda düello kontrol satırı da kompaktlaştırıldı: Robotu izle / Devral kısa etiketleri kullanılır, HIZ etiketi gizlenir ve aralıklar küçülür. 359px ve altında isteğe bağlı hız seçimi gizlenir; ses ve temel maç düğmeleri görünür kalır.

TypeScript kontrolü geçti. Mevcut Duel testlerinin 53'ü geçti: 39 fizik/yaşam döngüsü, 11 gerçek GRU öğrenme, 3 online protokol testi. GRU mimarisi, parametreler, kayıt anahtarı, eğitim algoritması ve oyun kuralları değiştirilmedi. Loss açıklaması: [DUEL_LEARNING.md](DUEL_LEARNING.md).

Tarayıcı senaryosu `e2e/duel-model-controls.mjs`, gerçek Chrome/WebGL ve doğrulamadan geçen GRU model dosyalarını kullanır. Modelin sıfır olmayan sürekli hareketi, merkez ölü bölgesi, çapraz normalizasyonu, duvarda hareket isteği, atış bekleme süresi, siper komutunun yükselen kenarı, gerçek siper alma, duraklama, biten maç ve kontrol devralma denetlenir. Tam ekran/dar ekran boyutları ve örneklerden/modelden veri kaybı da kontrol edilir. Sonuç raporu `artifacts/duel/model-controls.json`.

Android kimliği `studio.noema.duel`, sürüm 1.0.3, sürüm kodu 4. Fiziksel Android cihazı bağlı olmadığından cihaz FPS, kurulum ve sensör ölçümü yapılmadı.

Son Chrome çalıştırmasında 22/22 kontrol geçti; uygulama ve konsol hatası yok. 320×568 ve 390×844 başlangıç satırları; robotu izlerken normal/tam ekran 320×568, 390×844, 568×320, 604×268, 844×390 ve 1440×1000 yerleşimleri denetlendi. Görünür ses/hız kontrollerinin sınırları ve dokunulabilirliği de kontrol edildi. Önizlemeler: `artifacts/duel/model-controls-landscape.png`, `artifacts/duel/model-controls-portrait.png`.

Son web ve Android derlemeleri tamamlandı. APK `releases/NOEMA-Duel-1.0.3-android.apk`, 5.122.532 bayt; SHA-256 `7f5bc36cb926c77e82d7eb20050d6bc66cfaf70094032688632d20792c065242`. İmza, önceki Duel ile aynı sertifika, sürüm/kod, paket kimliği, ZIP hizalaması, öğrenme Worker'ı ve derlemedeki 20 dosyanın eşleşmesi doğrulandı. Rapor: `artifacts/duel/apk-verification-1.0.3.json`. Kontrol edilen APK son dar ekran CSS düzeltmesini içerir. AAB ve APK hash'leri `releases/SHA256SUMS.txt` içine yazıldı.
