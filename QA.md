# NOEMA 1.1.0 doğrulama kaydı

Bu sürüm 56 oda, hareketli hava olayları, yeni bulmaca mekanikleri ve gerçek model aktarım denemelerini içerir. Otomatik kontrollerin kapsamı aşağıdadır; gerçek telefon ölçümü olarak sunulmaz.

## Yeniden çalıştırma

```powershell
$env:Path = (Resolve-Path '.tools/node-v24.22.0-win-x64').Path + ';' + $env:Path
npm.cmd test
npm.cmd run build
# Ayrı terminalde npm.cmd run dev:
node e2e/learning.mjs
node --import tsx e2e/transfer.mjs
node e2e/mechanisms.mjs
# Ayrı terminalde npm.cmd start:
$env:BASE_URL = 'http://127.0.0.1:4173'
node e2e/atmosphere.mjs
$env:OFFLINE_TEST = '1'
node e2e/smoke.mjs
node --import tsx e2e/arena.mjs
```

Tarayıcı kontrolleri sistem Chrome'u ve `--no-proxy-server` seçeneğini kullanır. Yazılımsal WebGL aynı makinede pahalı olduğundan tarayıcı testleri sırayla çalıştırılır. Ekran görüntüleri ve JSON raporları `artifacts/` içindedir.

## Motor ve değerlendirme

35 testin tamamı ve strict TypeScript kontrolü geçti. 56 odanın çözüm sertifikaları gerçek motorla oynatıldı. En uzun sertifika 62 karar; arena bütçesi oda başına 160 karar. Buzda kayma, itilen/taşınan kutular, yön değiştiren bantlar, bant döngülerinin sınırlanması, sıralı anahtarlar, yanlış sıranın sıfırlanması ve AND/OR/ters kapılar kontrol edilir.

Yakın başlangıç 1–3 güvenli kare kayar. Benzer oda tam bir iç engeli değiştirir. Üretilen düzenler tekrar oynatılarak çözülebilirlikleri doğrulanır. 56 oda × 8 dönüşüm × 2 varyant türü = 896 üretim denemesi hatasız tamamlandı. Bu doğrulama çözücüsü modelin eylemlerini üretmez.

Aktarım değerlendirmesi aynı odanın yanı sıra üç benzersiz yakın başlangıç ve üç benzersiz harita değişikliğini sabit modelle sınar. Fiziksel olarak aynı düzenler tekrar puanlanmaz. Yeterli farklı düzen bulunamazsa gerçek sayı gösterilir. Süre ve karar bütçeleri vardır; bekle eylemini sürekli seçen bir modelin gerçekten başarısız olduğu test edilir.

Arena gerçek ağırlıkları sunucu Worker'ında çalıştırır; istemci puanını okumaz. Günlük koşullar bütün oyuncular için aynıdır. Yeni model/kurallar eski günlük sonuçlarla karışmaz; önceki kayıtlar saklanır. Oturum, CORS, boyut/sayı doğrulaması, sınırlı Worker kuyruğu ve kayıt kalıcılığı test edilir.

## Gerçek öğrenme ve süreklilik

`artifacts/e2e/learning.json`: iki bağımsız tarayıcı bağlamında sağ-önce ve yukarı-önce çözümleri klavyeyle gösterildi. Her biri 10 insan örneğinden 190 geometrik/boş geçmişli eğitim örneği oluşturdu; 95 tur gerçek geri yayılım yapıldı. Her iki model ilk denemede odasını 10 hamlede tamamladı. İlk eylemler öğretim tarzına göre sağ ve yukarı oldu. Dört görülmemiş yakın başlangıçta her biri 4/4 başarı elde etti. Yeniden açma ve başka bölüme geçip geri dönme sonrasında model hash'i birebir aynı kaldı, önceki örnekler korundu.

Eğitim Atölye sayfasında, gerçek Worker üzerinde yaklaşık 20,14 ve 29,82 saniye sürdü. Aynı anda arayüz zamanlayıcısı 600 ms içinde 12 kez çalıştı. Bunlar yazılımsal WebGL kullanan masaüstü ölçümleridir; telefon eğitim süresi veya pil tüketimi garantisi değildir. Eğitim sırasında sahne ve beyin animasyonu sabit kalır; tamamlanınca hareket sürer. Worker eğitiminde gereksiz ana iş parçacığı zamanlayıcı beklemeleri kaldırıldı; doğrudan eğitim yolunun arayüzü serbest bırakma davranışı korundu. İki zamanlama yolunun aynı ağırlıkları ürettiği doğrulandı.

`artifacts/transfer-benchmark.json`: iki tarzın her biri dört yakın başlangıcı ve rotanın dışındaki bir duvar değişikliğini çözdü (5/5). Bu, basit ilk odanın aktarımıdır. İleri mekanikler içeren üç görülmemiş odada ilk oda öğretimiyle 0/3 sonucu alındı. Eğitim uyumu bütün odaları çözme garantisi değildir; rota dışı duvar denemesi engelden kaçınmayı öğrendiği iddiası olarak kullanılmaz.

160→64→64→6 ağda 14.854 parametre bulunur. Sayısal gradyan, model doğrulaması, iptal, eski 128 girişli modelin kararları birebir korunarak yükseltilmesi ve eski örneklerin metadata kaybetmeden taşınması test edilir. Bölüm değişimi modeli sıfırlamaz. Yeni eğitim önceki ağırlıklardan ve seçili eski örneklerden devam eder.

Beyin görünümündeki etkinlikler ve bağlantı katkıları gerçek hesaptan alınır. Dondurulan görünüm ağırlıkları da saklar. Yeni model yüklenince veya eğitim tamamlanınca önceki modelin tekrar kareleri temizlenir; eski etkinlik yeni ağırlıkla açıklanmaz.

## Görsel ve mobil kontroller

`artifacts/e2e/atmosphere.json`: varsayılan yakın başlangıç, gerçek yedi koşullu Worker değerlendirmesi, yağmur ayarı, yedi bölüm/56 oda, 25/33/41/48/49/56. odaların WebGL çizimi ve azaltılmış hareketli 390×844 mobil aktarım denetimleri geçti. Yakalanmamış JavaScript hatası yok.

`artifacts/weather-performance.json`: kumaş deformasyonu, dallar/yapraklar, yağmur ve halkalar gerçek WebGL ile gözlendi. Görsel animasyon oyun durumunu değiştirmedi. Açık hava 165, yağmur 167 çizim çağrısı kullandı. Altı oda geçişinde bellek aynı oda için sabit kaldı; dispose sonrası geometri/doku sayaçları sıfıra indi. Ses bağlamı kullanıcı etkileşiminden önce açılmadı, gerçek etkileşimle açıldı. Bunlar fiziksel GPU/telefon FPS ölçümü değildir.

Mobil profil 30 FPS hedefi, DPR 1,35, daha küçük gölge/yağmur bütçeleri kullanır. Azaltılmış harekette kumaş/ağaç hareketi ve uçan parçacıklar durur; hava rengi ve durum etiketleri korunur. Hava olayları bulmaca ve rekabet kurallarını değiştirmez.

## Yayın sınırları

Android APK geliştirme sertifikasıyla kurulabilir; release AAB imzasızdır. iOS proje kaynakları ve web varlıkları hazırlanır; Windows'ta Xcode derlemesi yapılmaz. Fiziksel telefonda pil/ısınma, iPhone testi, mağaza imzalama ve canlı HTTPS arena dağıtımı tamamlanmış sayılmaz.
Düğme/kapı görsel düzeltmesi: basılı düğmenin tüm üst yüzeyi, dış halkası ve çevre işaretleri mint ışıkla aktifleşir. Kasa düğmeyi örtse bile dış işaretler görünür. Kapı paneli üst kasaya çekilir; açık geçitte panel görünmez, durum ışığı ve AÇIK/KAPALI plakası değişir. Materyaller her mekanizma için ayrıdır. Gerçek iki anahtarlı kapı, kasa-basınç ve mobil azaltılmış hareket kontrolleri `artifacts/e2e/mechanisms.json` içinde geçti; yakalanmamış hata yok.

49–56. odalar aynı bölüm içindeki bağlı mekânlarda araç getirip geri dönmeyi gerektirir. Örneğin Yan Odadaki Kutu bölümünde kapı açılır, diğer odadan kasa alınır ve başlangıç odasındaki hedefe getirilir. Model aynı duruma tekrar tekrar dönerse izleme durur; oyuncu gerçek hatalı durumdan düzeltme gösterebilir. Mimari ve ezber analizi `MODEL_MIMARISI_ANALIZI.md` içindedir; önerilen 101.902 parametreli uzamsal/bellekli mimari analiz adayıdır, çalışan modelin yerine uygulanmış değildir.

Son arayüz regresyonu: 56. odanın uzun tuş dizisinde React güncelleme sınırı yeniden üretildi (`artifacts/e2e/atmosphere-update-depth-repro.json`). Kayıt zaten beklerken aynı kayıt durumu için yeni React güncellemesi kuyruğa eklenmesi engellendi; hava bilgisinde yalnız ekranda kullanılan evre değişiklikleri güncelleniyor. Aynı tam senaryo tekrarlandı; iki bağlı oda çözümü, 56 oda, yedi koşul ve mobil azaltılmış hareket dahil 13 kontrol hatasız geçti (`artifacts/e2e/atmosphere-final-source.json`). Bu düzenleme oyun/model kararlarını değiştirmez.

## Son paket kontrolü

Son üretim derlemesinde 17 tarayıcı kontrolü geçti (`artifacts/e2e/smoke.json`): çevrimdışı tam yeniden açılış, manuel oyun ve gerçek Worker eğitimi dahil. Gerçek arena arayüzündeki dört kontrol de geçti (`artifacts/arena-ui.json`); konuk oturumu ve yetkili gönderim gerçek sunucu model çalıştırmasıyla tamamlandı. Her iki raporda JavaScript ve konsol hata listeleri boş. Bu arena denemesinde iki hareketle eğitilen model 8 odadan 1'ini çözdü; bağlantı kontrolü genel oyun becerisi olarak sunulmaz.

Tarayıcılar kapatıldıktan sonra bütün testler tek Worker ile yeniden çalıştırıldı: 5 dosyada 35/35 test, 12,52 saniye. Son önbellek `noema-c3602ffe26a13b3c`. APK ve AAB içindeki 21 web dosyasının tamamı son `dist` çıktısıyla SHA-256 düzeyinde eşleşiyor; APK imzası doğrulandı (`artifacts/release-verification.json`).

## İzole GRU deneyi

`GRU_DENEYI.md`: beş mimari × iki tohum × 80 tur gerçekten eğitildi. Model başına 640 Adam güncellemesi, 264.480 geçerli eğitim adımı; 120 eğitim koşulu ve 101 ayrı test koşulu. Her model gerçek motor içinde kendi kararlarıyla 221 kez oynatıldı: toplam 2.210 deneme. Veri hash'i, temel oda ayrımı, fiziksel düzen benzersizliği, başlangıç gözlemleri, sonlu gradyanlar, parametre sayıları ve Python/JavaScript hesap eşitliği doğrulandı. Tam bağlı oda dizilerindeki 171 adımlık sayısal kontrolde sekiz modelin tamamı geçti; en büyük logit farkı 3,34e-6 < 1e-4.

Sonuçlarda yeni başlangıçlar ile ayrı odalar ayrılır. GRU 82/96 yeni başlangıç ve 5/14 ayrı oda denemesi; mevcut MLP 75/96 ve 2/14; 101.902 parametreli harita+GRU 77/96 ve 0/14 elde etti. Benzer parametreli MLP ayrı odalarda GRU ile aynı 5/14 sonucu aldı. 14 sayısı aynı yedi odanın iki tohumudur. Bu sonuçlar ezberin çözüldüğünü, telefon performansını veya yeni bağlı oda görevlerinde genel başarıyı göstermez. Canlı oyun kaynakları, model sözleşmesi ve yayın paketleri bu deneyde değiştirilmedi.
