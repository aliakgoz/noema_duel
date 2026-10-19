**NOEMA Duel — Robotunu Eğit**

Bu klasörün güncel açılışı robot eğitimli arena mücadelesidir: sen hareket, nişan, ateş ve siper örnekleri gösterirsin; robotun gerçek sinir ağıyla öğrenip kendi yarı sahasında rakibe karşı mücadele eder. Seken/geçirgen duvarlar, taşınabilir ve kırılabilir kutular, üç arena, öğrenilen modelin cihazda saklanması ve dokunmatik kontroller vardır.

Güncel oynama, eğitim, çalıştırma ve doğrulama bilgileri: [DUEL.md](DUEL.md).

[Android APK indir](releases/NOEMA-Duel-1.0.6-android.apk) · [Eğitim paneli önizlemesi](docs/screenshots/training-details.png)

Kaynak kodunu çalıştırmak için Node.js 22.12+ ile `npm ci`, ardından `npm run dev` kullan. Kontroller `npm test`, web paketi `npm run build` ile çalışır. Android APK için JDK 21 ve Android SDK 36 kurulu olmalı; Windows'ta `powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1 -ApkOnly` komutunu çalıştır. SDK'yı `ANDROID_HOME`, JDK'yı `JAVA_HOME` ile tanımlayabilirsin. İlk derleme Gradle bağımlılıklarını indirir; önbellek hazırsa `-Offline` eklenebilir.

**Noema Duel 1.0.6:** `studio.noema.duel` kimliğiyle Noema'dan ayrı kurulur; önceki Duel sürümlerinin üzerine güncellenir. Sol yarının her noktasında görünmez dokunmatik hareket kontrolü, sağ yarıya dokunarak tek atış, sabit %100 düz atış, dikey/yatay tam ekran ve mavi/mor/mercan tema.

Robotu izlerken küçük canlı joystick, modelin gitmeye çalıştığı yönü ve hareket miktarını gösterir. Ateş ve Al / bırak göstergeleri istenen komutları vurgular; gerçek atış, bekleme süresi ve taşınan siper ayrıca görünür. Öğrenme ve loss hesabı: [DUEL_LEARNING.md](DUEL_LEARNING.md).

Arena öncelikli mobil Atölye, ayrı Online Arena ve Sıralama sekmeleri; sağdaki küçük **Eğit** düğmesi **Robotuna öğret** ve **Tur sayısı** kontrollerini gerektiğinde açar. Maç sırasında kalıcı eğitim kutusu sahayı kaplamaz. **Robotumu izle / Kontrolü devral** doğrudan düello ekranındadır. Maç biter bitmez yeniden eğitim başlatılabilir. Eğitim başlatılınca panel açık kalır; gerçek loss, tur ilerlemesi, örnek sayısı, süre ve loss grafiği görünür. Sonuçlar eğitim sonunda korunur. Araştırma kampüsünde sallanan ağaçlar, yapraklar, flamalar, kameralar, uzak şehir ışıkları, güneş/yağmur ve çevre sesleri bulunur. Online değerlendirme için erişilebilir sunucu gerekir: [DUEL_ONLINE.md](DUEL_ONLINE.md).

Yeni düello otomatik tam ekran açılır; çıkış düğmesiyle normal görünüme dönünce maç orada sürer. Gerçek perspektif kamera, eğimli şehir mahalleleri, çok cepheli yapılar ve sokak trafiği çevrenin derinliğini artırır. Duvar/kutu parçaları mobil çizim yükünü azaltmak için birleştirilmiştir.

---

**Önceki sürümün arşiv notları — Robot Akademisi**

Telefonunda örneklerinden öğrenen insansı robot, çok çözümlü bulmacalar, gerçek sinir ağı görünümü ve sunucuda değerlendirilen model yarışmaları. Sürüm 1.2.2 gerçek 77.926 parametreli GRU96 kullanır.

1.2.2: Haritanın altında 56 bölüme doğrudan seçim, önceki/sonraki bölüm, Benzer bölüm ve Baştan izle kontrolleri vardır. Robotu izle mevcut konum, nesneler, kapılar ve GRU belleğinden devam eder; bölüm zaten tamamlandıysa aynı görünen bölümü başlangıçtan oynatır. Baştan izle her zaman aynı görünen bölümü yeniden başlatır. Benzer bölüm bir engeli açıkça değiştirir, Asıl düzen geri döndürür; değişiklik yalnız bu düğmeye basınca yapılır. Tam ekranda da Robotuna öğret, eğitim ilerlemesi ve Durdur bulunur. Öğrenilmiş model bölüm değişince korunur. Doğrulama: `QA_1_2_2.md`.

1.2.1: NOEMA INC araştırma kampüsü, katmanlı şehir ve dört köşe gözlem kamerası; CAM düğmesiyle üç bakış açısı. Güneşli/parçalı bulutlu hava, fiziksel kasete çekilen rijit kapı lamelleri ve arena kenarındaki üst üste yüzey hatası düzeltmesi. Tam ekran yön/E kontrollerini içerir; görünür çıkış, Escape ve Android geri ile kapanır. Robot ilk görüntüyü ve önceki yürüyüşü bekleyerek oynar. Mevcut GRU eğitimi korunur. Doğrulama: `QA_1_2_1.md`.

Windows'ta `NOEMA.cmd` dosyasını çalıştırıp `http://127.0.0.1:4173` adresini aç. Bu komut tamamlanmış web paketini ve arena servisini birlikte başlatır. Geliştirme için Node 22+ ile `npm install`, `npm run dev`; ayrı arena için `npm run server` kullanılır. Paket yeniden üretimi `npm run build`, doğrulama `npm test`.

**Oynama**

Yön tuşları/WASD ile yürü; E/boşluk veya dokunmatik Etkileşim tuşuyla önündeki nesneyi al, bırak veya mekanizmayı kullan. İnsan ve model aynı altı eyleme sahiptir. Bir çözüm göster, gerekirse örnek listesinden istemediğin hamleleri çıkar, Robotuna öğret'e dokun. Robotu izle mevcut durumdan gerçek çıkarımı çalıştırır. Baştan izle aynı görünen bölümü başlangıçtan oynatır; Benzer bölüm küçük ve çözülebilir bir harita değişikliğini hemen gösterir. 7 koşulda sına, bir aynı oda + üç yakın başlangıç + üç benzer oda koşulunu sabit model kopyasıyla ayrı ayrı ölçer. Tekrar zaman çizelgesinden bir duruma dönüp ek bir düzeltme gösterebilir veya robotu o durumdan izleyebilirsin.

İlk odayı örneğin altı kez sağa ve dört kez yukarı giderek çözebilirsin; önce yukarı gidip sonra sağa dönmek de mümkündür. Robotun bu iki farklı öğretimden farklı yaklaşım öğrenmesi uçtan uca sınanır.

Beyin görünümü 160 girdi, 96 algılama nöronu, 96 GRU bellek hücresi, 64 karar nöronu ve altı eylemi gösterir. Bellek hücresi seçilince önceki/yeni bellek, reset/koruma kapıları, aday değer ve en güçlü dört bağlantının ağırlığı/katkısı incelenir. Noktalı bağlar önceki adımın belleğini taşır. Görünümü dondurmak trace ile bütün ağırlıkları birlikte saklar. Çizim yalnız gerçek değer veya seçim değiştiğinde yenilenir; model belleğini ilerletmez.

**Uygulanan ürün**

- 7 bölümde 56 çözülebilir oda; taşıma/itme, renkli yuvalar ve basınç plakalarına ek olarak buzda kayma, yönlü taşıma bantları, sıralı anahtar grupları, VE/VEYA ve ters bağlı kapılar.
- Çözülebilirliği koruyan döndürülmüş/yansıtılmış sürpriz düzenler.
- Gerçek 160→96→GRU96→64→6, 77.926 parametreli ağ; Adam, zaman boyunca geri yayılım ve eğitimi arayüzden ayıran Worker. İnsan gösterimleri sıraları ve deneme sınırları korunarak bütün halinde geometrik olarak çeşitlendirilir. 32 adımlık gradyan pencereleri arasında ileri bellek taşınır.
- Öğrenme örneği seçimi, model dışa/içe aktarma, tekrar ve düzeltme; IndexedDB'de örnekler/model/ilerleme/ayarlar.
- Animasyonlu 3D robot, seramik/bakır laboratuvar ve portal; gerçek kumaş deformasyonlu flamalar, dalları ve yaprakları hareket eden ağaçlar, uçuşan yapraklar, bulutlanma ve aralıklı yağmur. Işık, sis, yüzey ıslaklığı ve yağmur halkaları birlikte değişir. Rüzgâr/yaprak/yağmur sesleri ses ayarına bağlıdır. Hava otomatik, açık veya yağmurlu seçilebilir; bulmaca durumunu etkilemez. Yüksek/dengeli kalite ve azaltılmış hareket desteği.
- Yerel fontlar ve oluşturulan servis worker önbelleğiyle çevrimdışı açılış ve eğitim.
- Gerçek arena: günlük ortak 8 görülmemiş düzen, her birinde 160 karar, sabit model sözleşmesi, sunucuda çıkarım, kalıcı sıralama. Günlük tablolar kural sürümüne göre ayrılır; eski değerlendirmeler yeni koşullarla karıştırılmaz.

Bölüm veya deneme değişince öğrenilmiş ağırlıklar korunur; yeni bölümün geçici GRU belleği sıfırlanır. Eğitim mevcut ağırlıklardan ve önceki seçili gösterimlerden devam eder. Kullanıcı isteğiyle 1.2 ilk açılışta sıfırdan GRU profili başlatır; eski MLP profili eğitime taşınmaz. Yeni kayıt anahtarı `profile-gru96-v3`; model sözleşmesi `noema-160-96-gru96-64-6-v3`. Eski model dosyaları bu sürüme yüklenmez.

Küçük bir odada yüksek eğitim uyumu, bütün yeni bulmacalarda başarılı olunduğu anlamına gelmez. Eğitimde görülmeyen bir mekanizmanın kullanımı kendiliğinden garanti edilmez. Robotu geliştirmek için çeşitli durumlar ve hatadan toparlanma örnekleri göstermek gerekir. Modelin yerine çalışan gizli bir çözüm planlayıcısı yoktur.

**Mobil paket**

`android/` gerçek Capacitor Android projesi, `ios/` Xcode/Swift Package Manager projesidir. Mobilde sinir ağı JavaScript Worker üzerinde CPU ile yerel olarak eğitilir; herhangi bir bulut modeli veya API anahtarı gerekmez. Unity kurulumu bulunmadığı için hızlı uygulama kararı Three.js + React/TypeScript + Capacitor oldu. Oyun kuralları ve model kodu istemci ile sunucuda ortaktır.

Android APK ve imzasız release AAB üretmek için `scripts/build-android.ps1` kullanılabilir. Bu çalışma alanına taşınabilir Node, Java ve Android SDK kuruldu; başka makinelerde standart Android SDK/JDK 21 kurulumu gerekir. APK geliştirme imzasıyla telefona kurulabilir. Google Play yüklemesi için sahibine ait upload signing key ve mağaza hesabı gerekir; anahtar üretilmedi ve mağazaya yükleme yapılmadı. iOS derleme/imzalama Mac ve Xcode üzerinde yapılır; Windows'ta iOS binary üretildiği iddia edilmez.

**Arena işletimi**

`npm run server`: yalnız API, varsayılan `127.0.0.1:8787`. `npm start`: build edilmiş oyun + API, `127.0.0.1:4173`. `ARENA_HOST`/`ARENA_PORT` ayrı API'yi; `HOST`/`PORT` birleşik sunucuyu belirler. `ARENA_ALLOWED_ORIGINS` virgülle ayrılmış kesin kaynak listesidir; wildcard kabul edilmez. İnternete açarken HTTPS ve uygulamanın gerçek kaynak adresleri yapılandırılmalıdır. Telefonda Arena bağlantısı alanına bu HTTPS sunucusunun adresi girilir. Canlı bir internet sunucusu henüz yayımlanmadı.

`serverdata/arena.json` gizli HMAC anahtarı, tuzlu oturum token hash'leri ve sıralamayı içerir. Bu dizin kaynak depoya alınmaz, genel web dizinine konmaz ve işletimde yedeklenmelidir. Oyuncunun gönderdiği puan okunmaz. Model boyutu/sürümü/sayıları doğrulanır; yalnız uygulamaya ait değerlendirici çalışır. Worker kuyruğu, süre ve heap sınırları, oturum ve istek sınırları bulunur. Worker thread, ayrı işletim sistemi sandbox'ı iddiası değildir; kullanıcı kodu kabul edilmez. Üretimde ters proxy/gövde sınırları ve dış hizmet oran sınırlaması da yapılandırılmalıdır.

**Doğrulama ve gerçek sınırlar**

`npm test`: motor, 56 oda/üreteç, sayısal gradyan, görülmemiş sayısal örneğe öğrenme, model yükleme ve gerçek sunucu değerlendirme testleri. `e2e/smoke.mjs` gerçek WebGL, masaüstü/mobil arayüz, tuşlar, ayarlar, kayıt, modal ve çevrimdışı eğitimi; `e2e/learning.mjs` iki insan tarzından gerçek öğrenme ve kalıcı modeli; `e2e/atmosphere.mjs` hava arayüzü, yeni odalar ve gerçek aktarım worker akışını kontrol eder. `node --import tsx e2e/transfer.mjs` basit oda aktarım ölçümünü yeniden üretir. Ekran görüntüleri ve raporlar `artifacts/` altındadır. Tarayıcı kontrolünde sistem Chrome/Edge ve ortamın proxy ayarından bağımsız `--no-proxy-server` kullanılır.

Fiziksel telefon ısınma/pil ölçümleri, iOS cihaz derlemesi ve mağaza dağıtımı bu Windows çalışmasında doğrulanmış sayılmaz. Bunlar yayın kaydında açık tutulur; çalışan APK ve kaynaklar teslim edilebilir durumdadır. Sanat varlıkları prosedürel özgün geometri ve proje ikonlarıdır. Manrope ve Cormorant Garamond fontlarının SIL OFL lisansları `public/fonts/` içinde paketlenir.


49–56. odalar aynı bölüm içindeki bağlı mekânlarda araç getirip geri dönmeyi gerektirir. Örneğin Yan Odadaki Kutu bölümünde kapı açılır, diğer odadan kasa alınır ve başlangıç odasındaki hedefe getirilir. Model aynı duruma tekrar tekrar dönerse izleme durur; oyuncu gerçek hatalı durumdan düzeltme gösterebilir. Mimari ve ezber analizi `MODEL_MIMARISI_ANALIZI.md` içindedir; önerilen 101.902 parametreli uzamsal/bellekli mimari analiz adayıdır, çalışan modelin yerine uygulanmış değildir.

Gerçek GRU karşılaştırması `GRU_DENEYI.md` içindedir: beş mimari, iki tohum, 80 tur ve 2.210 gerçek motor denemesi. GRU yakın başlangıçlarda 82/96, mevcut MLP 75/96 başarı elde etti. Ayrı yedi odanın iki tohumlu denemelerinde GRU ve benzer parametreli belleksiz kontrol 5/14, harita+GRU 0/14 aldı. Bu izole deney modelleri oyuncu kayıtlarını veya arenayı değiştirmez. Yeniden çalıştırma: `scripts/run-gru-experiment.ps1`.

1.2 sürümünde karşılaştırmanın 77.926 parametreli GRU mimarisi oyuna uygulandı; deneyin eğitilmiş ağırlıkları dağıtılmadı. Oyuncu kendi eğitimsiz GRU'suyla başlar. Güncel 43 test, iki öğretim tarzından gerçek Worker eğitimi, beyin/mobil ve çevrimdışı üretim kontrolleri `QA_GRU_1_2.md` içinde kayıtlıdır.
