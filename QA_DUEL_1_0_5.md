# Noema Duel 1.0.5 — Görünmez hareket kontrolü

Sol yarının tamamındaki mevcut analog hareket işlevi korunur. Manuel joystick her durumda görünmez; etkin dokunuş veya sürükleme sırasında da daire, düğme veya ipucu çizilmez. Ölçüm için kullanılan gizli elemanların boyutları aynı kaldığından merkez ölü bölgesi ve sürükleme mesafesi değişmez. Pointer capture, çoklu dokunma, sağdan atış ve hareketi sıfırlama mantığı değiştirilmedi. Robotu izlerken modelin karar göstergesi korunur.

Mevcut `e2e/duel-floating-joystick.mjs` ve `e2e/duel-tap.mjs` görünmez etkin kontrol beklentisine uyarlandı; sözdizimi kontrolleri geçti. Görsel değişiklik için mevcut 21 kontrol içeren floating senaryosu kullanılır. Fiziksel Android cihazı bağlı değildir.

APK sürümü 1.0.5 / kod6, kimlik `studio.noema.duel`. `scripts/build-android.ps1 -ApkOnly` ile yalnızca güncel APK üretilir; varsayılan komut APK ve AAB üretmeye devam eder. Bu sürümde AAB üretilmez ve eski AAB yeni sürüm adıyla kopyalanmaz.

Mevcut floating senaryosunda 21/21 kontrol geçti; tarayıcı ve konsol hatası yok. Basılı ve sürüklenen durumda görselin gizli olması, ipucu bulunmaması, sol yarının farklı noktalarından gerçek hareket, iki parmakla gerçek atış, bırakma/iptal/dönüş sıfırlamaları, örneklerin kalıcı kaydı, GRU izleme/devralma ve tam ekran yedeği doğrulandı. 390×844, 844×390, 604×268, 568×320 ve 320×568 boyutları denetlendi. Rapor `artifacts/duel/floating-joystick.json`; yeni önizlemeler `artifacts/duel/invisible-controls-portrait.png`, `artifacts/duel/invisible-controls-landscape.png` ve `artifacts/duel/invisible-controls-fallback.png`.

Web/TypeScript ve Android APK derlemeleri tamamlandı. `releases/NOEMA-Duel-1.0.5-android.apk` 5.119.934 bayt, SHA-256 `d8f9e90578c5eb9d728ab847aae3605739d73e60b3637c2ef48995ad7c877e40`. İmza, önceki Duel ile aynı sertifika, sürüm/kod, kimlik, ZIP hizalaması, yerel tam ekran eklentisi, gerçek öğrenme Worker'ı ve derlemedeki 20 dosyanın eşleşmesi doğrulandı. Rapor: `artifacts/duel/apk-verification-1.0.5.json`. Hash `releases/SHA256SUMS.txt` dosyasına yazıldı.
