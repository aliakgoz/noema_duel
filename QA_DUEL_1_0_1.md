# Noema Duel 1.0.1 — Düello kontrolleri ve perspektif dünya

Öğretme düğmesi ve1–500 tur seçimi tek bir örnek olarak doğrudan arena paneline taşındı. Normal görünümde ve dikey/yatay tam ekranda görünür. Eğitim varsayılan1tur; önceki modelin ağırlıklarından birikmiş gösterimlerle devam eder. İlerleme, iptal ve sonuç aynı yerde gösterilir. Maç bitişi yeni eğitimi engellemez ve eğitim sonuç ekranını sıfırlamaz.

Robotumu izle / Kontrolü devral düello kontrollerindedir. Dar ekranda Robotu izle / Devral görünür. Oynatma gerçek GRU çıktılarıyla yeni maç başlatır; kontrolü devralmak mevcut maçı korur. Eğitim sürerken ana oynatma/yeniden başlatma düğmeleri ve tur düzenleme kilitlenir. Klavye girdisi de eğitimde engellenir.

Yeni düelloyu başlatmak ve Robotumu izle otomatik tam ekranı açar. Çıkış düğmesi ve Escape ile normal görünüme dönülebilir. Devam eden maç, kontrolü devralma ve duraklatıp devam etme kullanıcının çıkış kararını korur; yeni maç tekrar tam ekranı açar. Tarayıcı API desteği yoksa aynı davranış CSS tam ekranında çalışır.

Şehir düz kutu silueti yerine eğimli arazi üzerinde dört mahalle, çok cepheli yapılar, kademeli çatılar, çatı aygıtları, sokak lambaları ve akan trafikle yeniden kuruldu. Mobilde32/masaüstünde44 bina,6 mimari materyal grubu ve pencere/arazi/trafikle toplam9 şehir çizimi vardır. Tüm rastgelelik kozmetiktir. Açılı görünüm gerçek38° perspektif kamera kullanır; tepeden görünüm ortografik kalır. Kamera saha kenarları ile robot yüksekliğini ekran oranına göre matematiksel olarak kadraja sığdırır. Sis mesafesi kamera uzaklığına göre her atmosfer güncellemesinde ayarlanır.

Mobil ölçümde duvar/kutu geometrileri birleştirilince toplam çizim çağrısı800→295 oldu (%63,1 azalma); üçgen sayısı34.918 olarak korundu. Birleştirme yalnızca nesne oluşturulurken yapılır; kutuların taşıma/dönme/can ölçeği ile duvar fiziği değişmez. Gerçek Chrome/SwiftShader ölçümü: `artifacts/duel/static-batching-check.json`. Bu çizim çağrısı ölçümüdür, fiziksel telefon FPS testi değildir.

## Doğrulama

`e2e/duel-arena-training.mjs` gerçek Chrome, gerçek eğitim Worker'ı, gerçek fizik ve IndexedDB üzerinden çalışır. Eğitim paneli kapalıyken eğitim/tur/robotu oynatma kontrollerinin erişimini; varsayılan1tur ve1–500 sınırlarını; gerçek hareket/ateş gösterimleriyle eğitimi; aynı örneklerle devam eden ağırlıkları; uzun eğitimi iptal etmeyi; öğrenilmiş robotu izlemeyi ve maçı koruyan kontrol devralmayı; gerçek hasarla biten maçın ardından aynı ekrandan yeniden eğitimi ve kayıtların yeniden yüklenmesini denetler.

Dar yatay ekranda robotu izleme düğmesinin sağ siper kontrolüyle kısmi çakışmasını önlemek için alt orta kontrol grubu kalan boşluğa kaydırıldı. En dar yatay görünümde eğitim satırı da sağdaki kamera/hava araçlarından uzaklaştırılır. Kontrollerin merkezde dokunulabilirliği yanında bağımsız düğmelerin dikdörtgenlerinin çakışmaması da kontrol edilir.

Önceki joystick/dokunarak atış testi `e2e/duel-tap.mjs` korunur. Küçük yatay ekranda atış dokunuşu, yeni eğitim satırının altındaki açık saha üzerinde yapılır; eğitim düğmesine dokunmak atış sayılmaz.

TypeScript kontrolü geçti. Fizik, model mimarisi, BPTT algoritması ve online protokolü bu değişiklikte değiştirilmedi. Android kimliği `studio.noema.duel`, sürüm1.0.1/kod2; önceki Duel ile aynı sertifika ve kimlik kullanılır. Örnek/model depolama anahtarı değişmedi.

Son eğitim/oynatma çalıştırmasında **18 kontrol geçti**, JavaScript ve console hatası yok.18 gerçek gösterimle modelin işlediği örnek sayısı18→36→54 oldu. KOR gerçek hasarla16,042 simülasyon saniyesinde kazandı; sonuç ekranından üçüncü eğitim yapıldı ve galip, süre ile0/240canlar korundu.500tur eğitiminin iptali önceki modeli korudu. Gerçek GRU hareketi ve kontrolü devralınca bütün maç durumunun aynen kalması doğrulandı; sayfa yeniden yüklenince örnekler ve model saklandı. İnsan ve model maçlarının otomatik tam ekran açılması, çıkıştan sonra AI maçının normal görünümde sürmesi, duraklat/devam ile kontrol devralmanın normal görünüm kararını koruması ve sonuçtan yeni maçın yeniden tam ekran açılması doğrulandı.

Normal390×844, tam ekran390×844,844×390,604×268 ve568×320 boyutlarında eğitim, tur alanı, oynatma, joystick ve siper kontrolleri görünür/dokunulabilirdir. Tüm bağımsız görünür düğmelerin geometrik çakışma denetimi geçti; bitiş ekranı dahil. Rapor: `artifacts/duel/arena-training.json`; görseller: `arena-training-normal.png`, `arena-training-landscape.png`.

Yeni perspektif kamera ve otomatik tam ekranla joystick/dokunarak atış testi tekrar çalıştırıldı: **18 kontrol geçti**, console/çalışma hatası yok. Gerçek iki parmak hareket/atış,1,25sn bekleme,45m menzil, kayıt ve dönüşte kontrol temizliği ile desteklenmeyen Fullscreen API'sinde otomatik CSS görünümü doğrulandı. Rapor: `artifacts/duel/mobile-tap.json`.

Otomatik tam ekranın odak testi **8/8 geçti**. Gerçek Chrome Fullscreen API'si ve API'nin reddedildiği WebView benzetiminde her biri üç yeni maç otomatik tam ekran açtı; çıkış düğmesi, Escape ve tarayıcı Geri ile kapanma denetlendi. Dönüşte ekran doluluğu/maç korundu; açıkça çıktıktan sonra oyun adımları ve duraklat/devam normal görünüm tercihini korudu. Hata/console0. Rapor: `artifacts/duel/auto-fullscreen.json`. Son arayüz raporları18+18+8=44 kontrol grubudur.

Fiziksel Android cihazı bağlı olmadığı için sensör, kurulum ve cihaz FPS ölçümü yapılmadı.

## Son Android paketi

`releases/NOEMA-Duel-1.0.1-android.apk` güncel kaynaklarla üretildi;5.414.127bayt. SHA-256: `8bdcb2f026cac74f033000ff6390c75f005121a88ab13acc0ec33df5b3a9fcf4`.

Paket doğrulaması geçti: `studio.noema.duel`, sürüm1.0.1/kod2, geçerli APKv2 imzası, ZIP hizası/CRC ve20 güncel web dosyasının `dist` ile aynı özetleri doğrulandı. Eğitim Worker'ı ve yerel tam ekran eklentisi paket içinde. Sertifika Duel1.0.0 ile aynı, eski Noema'nın `studio.noema.robot` kimliğinden farklıdır; Duel güncellemesi olarak hazırlanmıştır. Rapor: `artifacts/duel/apk-verification-1.0.1.json`.

APK geliştirme sertifikasıyla imzalı debug paketidir. `NOEMA-Duel-1.0.1-unsigned.aab` mağaza imzası eklenmemiş release bundle'dır. Her iki dosyanın özetleri `releases/SHA256SUMS.txt` içindedir.
