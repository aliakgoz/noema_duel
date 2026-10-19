# Noema Duel 1.0.0 — Bağımsız uygulama

Android uygulama kimliği ve namespace `studio.noema.duel`, launcher `studio.noema.duel.MainActivity`, sürüm1.0.0/kod1. Önceki Noema `studio.noema.robot` kimliğinde kalır. Paketler farklı olduğu için bu APK eski Noema'yı güncellemez; uygulamalar ve özel verileri ayrıdır. Capacitor, Android kaynakları ve iOS bundle kimliği yeni uygulamaya göre düzenlendi.

## Son davranış

- Joystick yalnızca hareketi yönetir; analog hız ve bırakınca durma korunur.
- Sahaya dokunmak dokunulan noktaya doğru tek atış yapar. Ayrı ateş düğmesi ve güç kaydırıcısı yoktur. Basılı tutma/sürükleme tekrar atış yapmaz.
- Atışlar düz ve her zaman %100 güçtedir: hız18m/sn, ilk temas hasarı26. Oyuncu, rakip ve öğrenilmiş model aynı kuralı kullanır. Yerçekimi/eğik atış kaldırıldı.
- Atış aralığı1,25sn, sekmeler dahil menzil45m. Bekleme sırasında yalnızca son dokunulan hedef için bir atış saklanır. Duraklatma, odak kaybı ve ekran dönüşü bekleyen atışı iptal eder.
- Mavi/mor/mercan tema, dikey/yatay tam ekran, siper taşıma,240 can ve30×18 saha korunur.
- GRU77.926 parametreli mimariyi korur. Hareket, nişan, ateş ve siper öğrenilir. Eski güç nöronu dosya uyumluluğu için yedektir; eğitim kaybına katılmaz, ham değeri ne olursa olsun uygulanan güç1'dir. Varsayılan eğitim1 turdur.
- Arena öncelikli uygulama düzeni: 390×844 normal görünümde saha, başlat/duraklat ve joystick ilk ekrana sığar. Eğitim/ayarlar kapalı başlayan paneldedir; GRU ayrıntıları beyin simgesinde, masaüstü önizlemesi korunur. Atölye / Online Arena / Sıralama mobil alt sekmelerde ayrıdır; sayfa değişince maç duraklar, örnekler ve model korunur.
- Tenis/tribün görseli kaldırıldı. Araştırma kampüsü, sallanan ağaçlar ve yapraklar, düşen yapraklar, flamalar, dönen kameralar, uzak şehir pencereleri, otomatik veya seçilebilir güneş/bulut/yağmur, bulut gölgesi ve ıslak zemin eklendi. Ses açılınca gerçek Web Audio ile rüzgâr/hışırtı/yağmur üretilir; gizliyken, başka sayfada ve eğitimde susturulur.
- Online değerlendirme gerçek GRU'yu sunucuda üç farklı arenada çalıştırır; günlük sıralama ayrı dosyada kalıcıdır. Can bitiren kazanır,120sn sürede bitmeyen maç beraberedir. APK'nın online sayfaları erişilebilir sunucu adresi gerektirir; bu çalışma herkese açık servis yayımlamaz.

## Doğrulama

- Yeni fizik ve öğrenme testleri: **50 test geçti**. Eski güç girdileri verilse de aynı18m/sn/26 hasar,20m hedefe varış süresi,45m menzil, sekmeler,18 rakip senaryosu, gerçek GRU/BPTT, bellek, sürekli hareket/nişan öğrenimi ve yedek güç nöronunun etkisizliği denetlendi. Kayıt: `artifacts/duel/fixed-full-power-unit-tests.txt`.
- Dokunma testi `e2e/duel-tap.mjs`, gerçek Chrome dokunma olaylarını ve gerçek motorun `advanceSimulation` adımlarını kullanır. SwiftShader altında zamanlamayı tekrarlanabilir tutmak için geliştirme modunda saati test ilerletir; tuşlar, dokunuşlar, fizik ve öğrenme örnekleri gerçek uygulama akışıdır. Üretim paketinde bu test arayüzü yoktur.
- Mobilde **18 kontrol geçti**, tarayıcı ve console hatası yok. Dokunulan dünya noktasına doğru gerçek mermi hızı, basılı tutma/sürüklemede tek atış, iki parmakla hareket ve atış,1,25sn beklemede yalnızca son hedef, duraklatma/dönüşte iptal, sabit18m/sn düz uçuşun45m sınırında bitmesi ve gerçek öğretim örneklerine ateş/nişan ile sabit güç1 kaydı denetlendi. Rapor: `artifacts/duel/mobile-tap.json`.
- Tam ekran390×844,844×390,604×268 ve geri dikey dönüşte çalıştı; joystick/siper/duraklat/çıkış görünür ve dokunulabilir kaldı. Normal360/390px genişlikte taşma yok. GRU penceresi ve tam ekran API'si olmayan tarayıcı da denetlendi. Görseller: `artifacts/duel/mobile-tap-portrait.png`, `mobile-tap-landscape.png`, `mobile-tap-compact.png`, `mobile-tap-normal.png`.
- Son birleşik fizik/öğrenme/hava döngüsü çalıştırması **53 test geçti**:39 motor,11 GRU/BPTT ve3 hava saati testi. Tam eski akademi test kümesi bu çalıştırmaya dahil değildir.
- Yeni online servis **4 test**, eski arena servisinin regresyonu **4 test** geçti. Gerçek GRU değerlendirmesi, sunucunun puan hesaplaması, model/oturum doğrulama, diskte kalıcılık, günlük tohumlar, kuyruk zaman aşımı ve eski Noema sıralamasıyla ayrılık denetlendi.
- Gerçek tarayıcı online akışı geçti:20 klavye gösterimi → varsayılan1tur gerçek Worker eğitimi → kullanıcı düğmesiyle model gönderimi → sunucunun üç düellosu → Sıralama sayfasında aynı sonuç.360/390px görünümde taşma yok. Kısa hareket gösterimiyle eğitilen test modeli0 galibiyet/3 mağlubiyet aldı; başarı uydurulmadı. Rapor: `artifacts/duel/online.json`.
- Arena öncelikli mobil yerleşim ölçümü390×844: üst bar54px, arena y94–706px, saha354px, joystick paneli112px; eğitim çekmecesi ve alt sekmeler görünür. Geniş ekranda GRU önizlemesi korunur. Görseller: `artifacts/duel/shell-390.png`, `shell-1440.png`.
- Gerçek Chrome hava/ses/sekme testi **5 grup geçti**, hata yok. Güneşte yağmur0/güneş0,882; yağmurda yağış0,879/ıslaklık0,794/güneş0,095 ölçüldü. Gerçek AudioContext `running/audible` durumuna geçti; sayfa geçişinde sustu ve geri geldi. Maç, GRU ve gerçek kontrol örnekleri korundu. Duraklatılmış maçta hava düğmesinin erişimi de doğrulandı. Rapor: `artifacts/duel/atmosphere.json`.
- Native HTTPS doğrulaması **3 test geçti**. Android'de HTTP adresi ağa istek yapılmadan net hata verir; HTTPS geçerli endpointi okur. Web geliştirme HTTP kullanabilir. HTTPS sertifikalı erişilebilir sunucu gerekir.
- Son ağ/regresyon çalıştırması **11/11 geçti**. Eşzamanlı Gradle ve SwiftShader yükü altındaki ilk çalıştırmada doğrulama testinin5sn süresi doldu; yük bittikten sonra aynı kod ve aynı komutla tekrar çalıştırıldığında test346ms, toplam11 test7,68sn sürdü. Test süre sınırı veya uygulama davranışı gevşetilmedi.
- Son görsel kontrol: `artifacts/duel/final-visual-qa.json`;390×844 normal mobil,844×390 tam ekran ve1440×900 masaüstünde JavaScript/console hatası ve yatay taşma yok. Güncel görseller `final-mobile.png`, `final-landscape.png`, `final-desktop.png`.

Fiziksel Android cihaz/emülatör bağlı değildi; cihazda kurulum, sensör ve FPS ölçümü yapılmadı. Tarayıcı dokunma/dönüş davranışı, yerel kod derlemesi ve paket doğrulaması ayrı kontrollerdir.

## Son Android paketi

`releases/NOEMA-Duel-1.0.0-android.apk` güncel kaynaklarla üretildi; 5.392.065 bayt. SHA-256: `7f087dfc999e4a90557d4da8f55fdeccc0b78ccc3df47f16ca69f29a631ae7df`.

Paket doğrulaması geçti: uygulama adı NOEMA Duel, kimlik `studio.noema.duel`, sürüm1.0.0/kod1, launcher yeni namespace içinde, APK v2 imzası geçerli, ZIP hizası/CRC doğru ve20 web dosyasının tamamı güncel `dist` ile birebir aynı. Gerçek eğitim Worker'ı ve yerel tam ekran eklentisi paket içinde. Eski Noema APK'sının kimliği `studio.noema.robot` olduğundan ayrı kurulum doğrulandı. Rapor: `artifacts/duel/apk-verification-standalone.json`.

Kurulabilir APK geliştirme sertifikasıyla imzalı debug paketidir. `NOEMA-Duel-1.0.0-unsigned.aab`, mağaza imzası eklenmemiş release bundle'dır. Her iki dosyanın özeti `releases/SHA256SUMS.txt` içinde yer alır.
