# Noema Duel 1.0.2 — Sağ kenardan açılan eğitim

Sahayı kaplayan kalıcı eğitim satırı kaldırıldı. Sağdaki araçlarda küçük **Eğit** düğmesi bulunur; panel bütün görünümlerde kapalı başlar. Açıldığında tek tur seçici ve tek Robotuna öğret düğmesi gösterilir.1tur varsayılanı ve1–500 sınırı korunur. Panel kapalıyken saha üzerinde eğitim kutusu veya ayrılmış satır yoktur.

Panel normal ve dikey/yatay tam ekranda sağ araçların yanında açılır; küçük yatay ekranda araç sırasının altında açılır ve kendi içinde kaydırılabilir. X ve Escape paneli kapatır; Escape önce paneli kapatır, tam ekranı korur. Sahaya dış dokunuş paneli kapatır ve aynı dokunuş atış oluşturmaz. Sonraki saha dokunuşu normal atışı yapar. Açıp kapatmak oyunu, modeli ve tur sayısını sıfırlamaz; öğrenilmiş robot düellosuna devam eder.

Öğretme başladığında oyun duraklar ve panel kapanır. İlerleme küçük sağ düğmede gösterilir; düğmeye tekrar basarak ilerleme/iptal açılabilir. Yeni düello, robotu oynatma, sıfırlama ve sekme değişimi paneli kapatır. Maç bittiğinde de aynı düğmeden yeniden öğretilebilir. Robotu izle/Devral düğmeleri ana düello kontrollerinde kalır.

Tam ekran yardımcı işlevine yalnızca isteğe bağlı, önce geçici paneli kapatan Escape callback'i eklendi. Eski Noema'nın bu seçeneği kullanmayan tam ekran davranışı korunur. Fizik, GRU, eğitim algoritması, model/örnek anahtarı ve şehir kamerası değiştirilmedi.

Doğrulama: TypeScript kontrolü geçti. Gerçek Chrome senaryoları `e2e/duel-training-flyout.mjs`, dokunma regresyonu `e2e/duel-tap.mjs` altındadır. Fiziksel Android cihazı bağlı olmadığından cihaz FPS/kurulum/sensör ölçümü yapılmadı.

Android kimliği `studio.noema.duel`; sürüm1.0.2/kod3. Önceki Duel sürümlerini güncellemek üzere hazırlanır.

Gerçek Chrome doğrulamaları tamamlandı: eğitim panelinde 21, mobil dokunma kontrollerinde 18, otomatik tam ekranda 8 kontrol geçti; hata ve konsol hatası yok. 390×844, 844×390, 604×268 ve 568×320 boyutlarında açık/kapalı panel, kontrol yerleşimi ve dokunulabilir alanlar denetlendi. Gerçek kullanıcı hareketlerinden kaydedilen 26 örnekle GRU eğitimi yapıldı; model adımları 26→52→78 ilerledi. Uzun eğitimi iptal etmek eski modeli korudu. Gerçekten biten maçtan sonra yeniden eğitim yapıldı ve maç sonucu korundu.

`scripts/build-android.ps1` ile web ve Android derlemeleri tamamlandı. APK: `releases/NOEMA-Duel-1.0.2-android.apk`, 5.116.738 bayt. SHA-256: `4a6fc7156d9a3bfde2dd9962de831ea34c8aa3c65100e29da905a95396063651`. APK imzası, önceki Duel ile aynı sertifika, sürüm/kod, paket kimliği, ZIP hizalaması, gerçek öğrenme Worker'ı ve derlemedeki 20 dosyanın eşleşmesi doğrulandı. Bağımsız uygulama kimliği eski Noema ile çakışmaz. Ayrıntılı rapor: `artifacts/duel/apk-verification-1.0.2.json`.

Raporlar: `artifacts/duel/training-flyout.json`, `artifacts/duel/mobile-tap.json`, `artifacts/duel/auto-fullscreen.json`. Oynanan maçın önizlemesi: `artifacts/duel/training-flyout-active-landscape.png`.
