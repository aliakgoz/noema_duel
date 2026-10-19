# NOEMA Duel 2.0.1 — Mobil kontroller, 17 Ekim 2026

Yuvarlak joystick dört yön düğmesinin yerini aldı. Merkezde %12 ölü bölge, kesintisiz yön/hız ve daire dışında parmak yakalama vardır. Bırakma, iptal, odak kaybı ve ekran dönüşünde kontroller sıfırlanır. Klavye ile joystick girdileri aynı motor girdisinde birleştirilir; ateş kaynakları birbirinden bağımsızdır. Telefonda sahaya dokunmak nişan alır, ayrı Ateş düğmesi atış yapar. Eğitim örnekleri gerçek analog değerleri kaydeder.

Arayüz, eğitim paneli, model görünümü, kontroller ve kort mavi/mor/mercan paletine geçti. Tam ekran dikeyde alt kontrol alanını, yatayda köşelerdeki kontrolleri kullanır. Maç ve GRU korunur; dönmek yeni maç başlatmaz. Android için sistem çubuklarını gizleyen, tam ekranda FULL_SENSOR yönünü kullanan ve çıkışta önceki yön ayarını geri yükleyen `ArenaFullscreenPlugin` eklendi.

## Doğrulama

- TypeScript ve üretim web derlemesi geçti. Android yerel Java kodu derlendi.
- `scripts/build-android.ps1` ile APK/AAB üretildi. APK `releases/NOEMA-Duel-2.0.1-android.apk`, sürüm2.0.1/kod7, 5.094.150 bayt. SHA256: `836eb7af548f47d3b7f6695290867f7cc9f27ddb161189ccdefd5d62ccce7732`.
- APK imzası, önceki sürümle aynı sertifika, ZIP/hizalama, paket kimliği,20 güncel web varlığının hash eşitliği, gerçek eğitim Worker'ı, joystick işaretleri ve DEX içindeki native tam ekran eklentisi doğrulandı. Rapor: `artifacts/duel/apk-verification-2.0.1.json`. Paket kimliği ve IndexedDB anahtarı değişmediği için model/örnek kayıtları korunur.
- Gerçek WebGL ve Chrome dokunma olaylarıyla **16 kontrol geçti**, tarayıcı/console hatası yok. Rapor: `artifacts/duel/mobile-joystick.json`; test: `e2e/duel-mobile.mjs`.
- Joystick merkez, kısmi ve tam hız, çapraz yön, parmak yakalama ve bırakma doğrulandı. Kısmi sürükleme yaklaşık **2,90 m/sn**, tam sürükleme **4,8 m/sn** gerçek robot hızı verdi.
- Üç parmakla hareket + ateş + nişan birlikte çalıştı. Nişan veya ateş parmağını kaldırmak diğer parmağın hareketini iptal etmedi. Sistem dokunma iptali hepsini durdurdu. Analog gösterimler gerçek örnek kaydında korundu.
- Aynı maçta **390×844 → 844×390 → 604×268 → 390×844** dönüşü, dönüşte basılı girdilerin bırakılması ve sonrasında tekrar ateş etme geçti. Canvas yatayda ekranı doldurdu; kontrol alanları görünür ve dokunulabilir kaldı.
- GRU penceresi tam ekranda erişilebilir; Escape ile pencereyi kapatmak tam ekranı korur. Duraklatma/devam/çıkış çalışır.
- Normal 360/390px yerleşim ve tam ekran API'si bulunmayan tarayıcı için 604×268 görünümü geçti.
- Görsel inceleme: `artifacts/duel/mobile-joystick-portrait.png`, `mobile-joystick-landscape.png`, `mobile-joystick-compact.png`, `mobile-joystick-normal.png`.

Fiziksel Android cihaz/emülatör bağlı değildi. Native sistem çubukları ve sensör davranışı cihaz üzerinde denenmedi; yerel kod derlemesi, tarayıcı dokunma/dönüş davranışı ve APK paket doğrulaması ayrı kanıtlardır.
