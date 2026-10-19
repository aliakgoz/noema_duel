# NOEMA 1.2.0 GRU doğrulaması

17 Ekim 2026. Gerçek model: 160→96→GRU96→64→6; 77.926 parametre, 96 geçici bellek hücresi. Önceden eğitilmiş deney ağırlıkları pakete konmaz. Kullanıcı isteğiyle yeni `profile-gru96-v3` kaydı sıfırdan başlar; sonraki eğitimler kalıcıdır.

## Sayısal ve motor kontrolleri

43/43 test geçti (6 dosya, 53,60 saniye): gerçek gradyanların sayısal kontrolü, geçmiş ipucunu hatırlamayı öğrenme, pencereler arasında ileri bellek, kayıt/yükleme, Worker ve doğrudan eğitim eşitliği, sıralı gösterimlerin doğru çeşitlendirilmesi, sunucu değerlendirmesi, 56 odanın motor kuralları ve beyin bağlantılarının hesap doğruluğu. Ayrıntı: `artifacts/gru-tests.log`.

`scripts/verify-live-gru.ts`, bağımsız PyTorch deneyinden çıkan iki eğitilmiş GRU'nun ağırlıklarını yalnız doğrulama için JavaScript uygulamasına yükler. Üç tam bağlı oda dizisinin toplam 171 adımı her modelde eşleşti. En büyük logit farkı 2,86e-6; sınır 1e-4. Önizleme belleği değiştirmedi; kayıt/yükleme ağırlıkları tam korudu ve geçici bellek sıfırlandı. Rapor: `artifacts/gru-live-parity.json`.

## Beyin ve mobil arayüz

`artifacts/e2e/gru-brain.json`: dört gerçek tarayıcı kontrolü geçti. Fiziksel hamle başına yalnız bir GRU adımı, dondurulan görünüm, seçilen hücrenin beş gerçek değeri ve ağırlıkları, inceleme sırasında belleğin ilerlememesi, yeni denemede bellek/sekans sınırı ve 390×844 dokunmatik görünüm sınandı. JavaScript/konsol hatası yok. Masaüstü ve mobil görüntüler `gru-brain-desktop.png` ve `gru-brain-mobile.png`.

Geliştirme sunucusunun SDK/Python varlıklarını izlemesi ilk tarayıcı açılışını durdurdu; `.tools`, native paketler ve rapor dizinleri Vite izleyicisinden çıkarıldı. Aynı tarayıcı kontrolü yeniden çalıştırılarak geçti. İlk altyapı zaman aşımı `gru-brain-dev-server-timeout.json` olarak saklandı.

## Gerçek öğretim, kayıt ve çevrimdışı eğitim

`artifacts/e2e/learning-gru.json`: iki bağımsız tarayıcı profili eğitimsiz modelle başladı. Sağ-önce ve yukarı-önce çözümleri gerçek on tuşla gösterildi; sıraları korunan 100 çeşitlendirilmiş örnekle 120 tur Worker eğitimi yapıldı. GRU ağırlıkları gerçekten değişti. Her model öğretilen odayı ilk denemede, kendi tarzındaki ilk hareketle çözdü ve dört yeni yakın başlangıcı 4/4 tamamladı. Kaydetme/yeniden açma ve bölüm değiştirme sonrasında bütün ağırlıkların hash'i birebir korundu. Masaüstü eğitim süreleri 24,90 ve 35,68 saniye; eğitim sırasında arayüz zamanlayıcısı 600–684 ms içinde 11–12 kez çalıştı. İleri mekanikleri hiç gösterilmeyen üç ayrı odada iki model de 0/3 aldı; genel öğrenme başarısı iddia edilmez.

Son üretim paketi `noema-9c11f51db43ec29d` ile 17 tarayıcı kontrolü geçti: tam çevrimdışı yeniden açılış, manuel oyun ve gerçek Worker eğitimi dahil. Yeni GRU modelinin gerçek yetkili arena gönderimini kapsayan dört kontrol de geçti; sunucu 200 yanıtı verdi. İki hareketle eğitilen arena deneme modeli 0/8 çözdü; bu kontrol bağlantıyı ve gerçek sunucu hesaplamasını doğrular. Her iki raporda konsol/JavaScript hata listeleri boş. Raporlar: `artifacts/e2e/smoke-gru.json`, `artifacts/arena-ui-gru.json`.

## Paket kapsamı

Android derlemesi başarılı: sürüm 1.2.0, sürüm kodu 3. `NOEMA-1.2.0-android.apk` 5.132.068 bayt, `NOEMA-1.2.0-unsigned.aab` 2.227.052 bayt. APK imzası doğrulandı ve 1.1.0 APK'sıyla aynı sertifika kullanıldığı kontrol edildi. İki paketin de içindeki 21 web varlığının tamamı son `dist` dosyalarıyla SHA-256 düzeyinde eşleşti. Deney ağırlıkları pakette bulunmuyor. Rapor `artifacts/release-verification-gru.json`; tekrar kontrolü `scripts/verify-gru-release.py`; paket hash'leri `releases/SHA256SUMS.txt`.

iOS web varlıkları ve Xcode proje sürümü 1.2.0/3 olarak güncellendi. Üretim sunucusu yeni `noema-160-96-gru96-64-6-v3` sözleşmesi ve `noema-arena-v4-gru96` kuralıyla yanıt veriyor. Çalışan adres: `http://127.0.0.1:4173/`.

Android APK geliştirme sertifikalı, AAB imzasızdır. Fiziksel Android cihazı ve iPhone bağlı değildir; gerçek telefon ısınması/pil tüketimi veya mağaza yayını tamamlanmış sayılmaz. iOS kaynakları ve web varlıkları güncellenir; Windows'ta Xcode binary üretilmez.
