# Noema Duel 1.0.4 — Serbest başlangıçlı joystick

Manuel modda arenanın sol yarısının tamamı hareket alanıdır. İlk dokunuşun tam ekran koordinatı nötr başlangıç olur; sürükleme analog X/Z komutunu üretir. Yüzde 12 merkez ölü bölgesi, orantılı hız ve birim daireye sınırlama korunur. Joystick yalnızca aktif dokunuş boyunca görünür. Ekran kenarında başlangıç mantığı değiştirilmez; görsel daire saha sınırında kırpılabilir.

İlk hareket parmağı kendi pointer capture'ını tutar; sağ yarıya veya saha dışına sürüklendiğinde hareketi yönetmeyi sürdürür. İkinci sol dokunuş ilk parmağı devralmaz ve ateş etmez. Sağ yarıdan başlayan başka parmak, mevcut tek dokunuş/tek atış davranışını kullanır; hareketi sonlandırmaz. Kamera, hava, eğitim, duraklatma ve çıkış düğmeleri hareket alanının üzerinde kalır.

Bırakma, pointercancel/lostcapture, odağın kaybı, gizlenme, yeniden boyutlandırma, ekran dönüşü ve dışarıdan kontrol sıfırlama hareketi nötrler. Duraklama, biten maç, yeni maç, sekme değişimi ve eğitim/model/yardım panelini açma, yakalanmış hareketi de sonlandırır. Kontrolü devralınca manuel alan geri gelir; robotu izlerken mevcut canlı model göstergesi korunur.

Sabit joystick sütunu alttan kaldırıldı; siper ve atış hazır olma kontrolleri sağda kalır. Sağdaki dokunma ile ateş etme açıklaması güncellendi. Model mimarisi, girdi/çıktı sözleşmesi, örnek kaydı, kayıt anahtarı, öğrenme ve fizik değiştirilmedi; önceki öğrenilmiş model kullanılabilir.

TypeScript kontrolü geçti. Yeni tarayıcı senaryosu: `e2e/duel-floating-joystick.mjs`. Dokunma regresyonu: `e2e/duel-tap.mjs`. Sonuçlar ve önizlemeler `artifacts/duel` altında tutulur. Fiziksel Android cihazı bağlı olmadığından cihaz FPS, kurulum ve sensör ölçümü yapılmadı.

Android kimliği `studio.noema.duel`, sürüm 1.0.4, sürüm kodu 5. APK `releases/NOEMA-Duel-1.0.4-android.apk`.

`e2e/duel-tap.mjs` regresyonunda 18/18 kontrol geçti; tarayıcı veya konsol hatası yok. Gerçek analog hareket, iki parmakla hareket/atış, atış yönü ve bekleme sırası, duraklama/dönüşte sıfırlama, yatay/kompakt görünüm, sabit 18 m/sn atış/45 m menzil ve GRU gösterimlerinin kalıcı kaydı korundu. Rapor: `artifacts/duel/mobile-tap.json`. Eski sabit joystick varsayımlarını kullanan dört tarayıcı senaryosu yeni hareket alanına uyarlandı ve sözdizimi kontrolleri geçti.

Yeni serbest joystick senaryosunda 21/21 kontrol geçti; uygulama ve konsol hatası yok. Gerçek CDP dokunuşlarıyla dört ayrı sol başlangıç ve kenar noktası, tam nötr başlangıç, analog hız/çapraz sınırlama, orta çizgiyi geçen parmağın sahipliği, ikinci sol dokunuşun etkisizliği, eş zamanlı sağ atış ve doğru dünya yönü, sağ parmağın sola sürüklenmesi, iptal/odak/duraklama/eğitim/dönüş sıfırlamaları denetlendi. Gerçek GRU dosyasıyla robotu izleme ve kontrol devralma, kalıcı gösterim kaydı, normal görünüm ve Fullscreen API olmayan görünüm de geçti. Rapor: `artifacts/duel/floating-joystick.json`.

Boyutlar: yerel tarayıcı tam ekranında 390×844, 844×390, 604×268, 568×320, 320×568; normal görünümde 390px ve 320px genişlik; Fullscreen API olmadan 604×268. Etkin joystick önizlemeleri `artifacts/duel/floating-joystick-portrait.png` ve `artifacts/duel/floating-joystick-landscape.png` altında.

Web ve Android derlemeleri tamamlandı. Son APK 5.120.290 bayt; SHA-256 `a9a275f956989cb06ebff05ef86abdc6212679525c9148493913725845cf9ada`. APK imzası, önceki Duel ile aynı sertifika, uygulama kimliği, sürüm/kod, ZIP hizalaması, yerel tam ekran eklentisi, gerçek öğrenme Worker'ı ve derlemedeki 20 dosyanın birebir eşleşmesi doğrulandı. Doğrulayıcıdaki eski sabit joystick etiket beklentisi, yeni hareket alanı ve başlangıç koordinatı işaretlerini de denetleyecek şekilde uyarlandı; diğer kontroller korundu. Rapor: `artifacts/duel/apk-verification-1.0.4.json`. APK ve AAB hash'leri `releases/SHA256SUMS.txt` dosyasındadır.
