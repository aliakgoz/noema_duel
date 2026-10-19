# Noema Duel 1.0.6 — Eğitim detay paneli

Eğit düğmesinden açılan panel eğitim başlayınca kapanmaz. Eğitim sırasında maç duraklar; modelin gerçek Worker ilerleme bildirimlerinden son tur loss’u ve tur geçmişi alınır. Tamamlanan tur, toplam tur, eğitim örneği ve gerçek geçen süre görünür. İlk tur bitmeden loss — olarak gösterilir. Bir tur için tek nokta, birden çok tur için yalnızca ölçülen noktaları bağlayan grafik çizilir.

Eğitim tamamlanınca sonuçlar panelde kalır. Paneli kapatıp yeniden açmak ilerlemeyi, geçmişi veya maçı değiştirmez. İptalde yarım denemenin ölçümleri korunan modelin kayıtlı loss’undan ayrı etiketlenir. Model dosyası değiştirilince önceki modele ait loss temizlenir. Varsayılan tek tur, 1–500 tur sınırı, gerçek GRU ağırlıkları/Worker eğitimi ve maç sonucu korunur.

Genişletilmiş detay paneli sahanın üzerinde kaydırılabilir; kapalı panel arenada alan kaplamaz. Yapışkan kapatma başlığı ve sağdaki Eğit düğmesi erişilebilir kalır. Fiziksel Android cihazı bağlı olmadığından cihaz FPS veya kurulum ölçümü yapılmadı.

TypeScript kontrolü geçti. Gerçek Worker eğitimi ve gerçek kullanıcı gösterimleriyle tarayıcı senaryosu `e2e/duel-training-details.mjs`; mevcut eğitim senaryolarının açık panel beklentileri uyarlandı.

Android paketi `studio.noema.duel`, sürüm 1.0.6 / kod7. Güncel çıktı `releases/NOEMA-Duel-1.0.6-android.apk`.

Gerçek Chrome ve gerçek eğitim Worker'ıyla 11 tarayıcı kontrolü geçti; çalışma zamanı ve konsol hatası yok. 70 kullanıcı gösterimiyle varsayılan tek turda 70, sekiz ek turdan sonra 630 model adımı ölçüldü. Son loss 4,458296721341483 → 0,3684972084451133; sekiz noktanın tamamı gerçek Worker mesajlarıyla birebir eşleşti. 500 turluk eğitim iptal edilince önceki 630 adımlık model, loss ve örnekler korundu. Ek kontrol, denemenin loss’u ile korunan model loss’unun ayrı gösterildiğini doğruladı.

390×844, 844×390, 604×268 ve 320×568 boyutlarında açık detaylar, kaydırma ve kapatma denetlendi. Paneli kapatıp açmak veya eğitim sırasında simülasyonu ilerletmeye çalışmak maç zamanını/canları değiştirmedi. Raporlar `artifacts/duel/training-details.json` ve `artifacts/duel/training-details-retained.json`. GitHub önizlemesi `docs/screenshots/training-details.png` dosyasındadır.

Web/TypeScript ve Android APK derlemeleri tamamlandı. APK 5.122.714 bayt; SHA-256 `ecc13a90058564e70421e65aac510146d4f38c8066ca33cab3c4d23d5ecd5749`. İmza, önceki Duel ile aynı sertifika, sürüm/kod, kimlik, ZIP hizalaması, yerel tam ekran eklentisi, gerçek öğrenme Worker'ı ve derlemedeki 20 dosyanın eşleşmesi doğrulandı. Rapor `artifacts/duel/apk-verification-1.0.6.json`, hash `releases/SHA256SUMS.txt` içindedir.
