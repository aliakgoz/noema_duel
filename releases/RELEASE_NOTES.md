**Noema Duel 1.0.6 — Arenada eğitim detayları**

Eğit paneli Robotuna öğret'e basılınca açık kalır; maç eğitim boyunca duraklar. Gerçek son tur loss’u, tamamlanan/toplam tur, örnek sayısı, geçen süre ve tur başına loss grafiği görünür. İlk tur bitmeden sayısal loss gösterilmez. Panel kapatılıp yeniden açılınca eğitim ve ölçümler devam eder; tamamlanınca sonuçlar korunur. İptal edilen denemenin ölçümleri ve korunan modelin loss’u ayrı gösterilir. Yeni model dosyası yüklenince önceki modelin loss’u ona aktarılmaz.

Android sürüm kodu7; aynı bağımsız Duel kimliği ve sertifikası. APK: `NOEMA-Duel-1.0.6-android.apk`. Model, eğitim hedefi ve fizik kuralları değişmedi. Kaynaktan ilk Android derlemesi bağımlılık indirebilir; önbellek hazırsa `-Offline`, yalnızca APK için `-ApkOnly` kullanılabilir.

**Noema Duel 1.0.5 — Görünmez hareket alanı**

Manuel kontrolde joystick dairesi, düğmesi ve sol taraftaki kontrol ipucu kaldırıldı. Sol yarının her boş noktasından başlayan analog sürükleme, hareket, iki parmakla sağ atış ve bırakınca durma işlevleri korunur. Robotumu izle modundaki model karar göstergesi devam eder. Android sürüm kodu6, aynı Duel uygulama kimliği ve sertifikası. APK: `NOEMA-Duel-1.0.5-android.apk`.

**Noema Duel 1.0.4 — Dokunduğun yerde açılan joystick**

Manuel harekette sabit joystick alanı kaldırıldı. Arenanın sol yarısında boş bir yere basmak joystick merkezini o noktada açar; sürükleme yönü ve miktarı analog hareketi belirler. Parmağı bırakmak, iptal, duraklama, ekran dönüşü, uygulamanın odağını kaybetmesi ve geçici panelleri açmak hareketi keser ve joystick'i kapatır. Hareket parmağı orta çizgiyi aşabilir; sağ taraftaki ikinci parmak aynı anda dokunarak tek atış yapabilir. Sol dokunuşlar atış oluşturmaz. Kamera, hava, eğitim ve maç düğmeleri normal şekilde çalışır.

GRU, eğitim örnekleri, model kayıt anahtarı ve fizik kuralları korunur. Robotumu izle modundaki canlı model joystick'i hareket komutlarını göstermeye devam eder. Aynı Duel uygulaması sürüm 1.0.4 / kod5 olarak güncellenir. APK: `NOEMA-Duel-1.0.4-android.apk`. Doğrulama: [QA_DUEL_1_0_4.md](../QA_DUEL_1_0_4.md).

**Noema Duel 1.0.3 — Canlı robot kontrolleri**

Robotumu izle modunda gerçek modele ait hareket isteği küçük bir analog joystick üzerinde gösterilir. Hareket yönü ve itme yüzdesi sürekli X/Z çıktılarından gelir; fiziksel engel hareketi durdursa da komut görünür kalır. Ateş ve Al / bırak göstergeleri komut verilince yanar; gerçekten çıkan atış ve siper değişimi ayrıca işaretlenir. Yeniden dolum ve siper taşıma bilgisi korunur. Tam ekran yatay görünümde göstergeler alt köşelere yerleşir; kontrol düğmelerini kapatmaz ve dokunma yakalamaz. Duraklamada son komut saklanır, kontrolü devralınca manuel joystick geri gelir.

GRU, eğitim algoritması ve fizik kuralları değişmedi. Öğrenme, oyuncu gösterimlerini taklit etmeyi hedefler; hasar/kazanma ödülü bulunmaz. Loss hesabı [DUEL_LEARNING.md](../DUEL_LEARNING.md) içinde açıklanır. Android sürüm kodu4, aynı Duel kimliği ve sertifikası. APK: `NOEMA-Duel-1.0.3-android.apk`.

Dar dikey ekranda Robotu izle / Devral etiketi ve kontrol aralıkları küçültildi; ses düğmesinin ekran dışına taşması düzeltildi. 359px ve altında isteğe bağlı hız seçimi gizlenir; temel maç kontrolleri ve ses düğmesi erişilebilir kalır. Doğrulama: [QA_DUEL_1_0_3.md](../QA_DUEL_1_0_3.md).

**Noema Duel 1.0.2 — Sahayı kapatmayan eğitim**

Kalıcı üst eğitim satırı kaldırıldı. Sağdaki küçük Eğit düğmesi, tur seçimi ve Robotuna öğret kontrollerini gerektiğinde açar; normal ve tam ekran görünümde başlangıçta kapalıdır. Eğitime basınca panel kapanır, ilerleme sağdaki küçük düğmede izlenir; yeniden açıp iptal edilebilir. Maç sonrası yeniden eğitim korunur. X/Escape ve dış dokunuşla panel kapanır; Escape tam ekranı korur, paneli kapatan saha dokunuşu yanlışlıkla ateş etmez. Robotu izle/Devral doğrudan düello kontrollerinde kalır.

Android sürüm kodu3, aynı Duel kimliği ve sertifikası. APK: `NOEMA-Duel-1.0.2-android.apk`. Doğrulama: `QA_DUEL_1_0_2.md`.

**Noema Duel 1.0.1 — Düello kontrolleri ve perspektif dünya**

Düelloyu başlatmak ve robotu yeni maçta oynatmak otomatik tam ekranı açar. Kullanıcı çıkış düğmesiyle normal görünüme dönebilir; maçın sürmesi veya duraklatılıp devam edilmesi onu yeniden tam ekrana zorlamaz. İstediğinde tekrar tam ekranı açabilir.

Açılı kamera gerçek perspektife geçirildi; uzaktaki yapılar küçülür ve binaların yan cepheleri görünür. Saha ve robotlar ekran oranına göre otomatik kadraja sığar; tepeden görünüm korunur. Şehir eğimli vadi ve tepeler, dört uzaklıkta mahalleler, farklı cam cepheler, kat şeritleri, kademeli çatılar, çatı donanımları, dört cephede sıcak/soğuk pencereler, sokak lambaları ve hareketli trafikle yeniden kuruldu. Sis kamera uzaklığına göre ayarlanır; dikey ekranda saha net kalır. Mobilde32, masaüstünde44 bina ortak çizimlerle üretilir.

Geçirgen duvarların ışıkları ve kutu parçaları ortak geometriye birleştirildi. Mobil Chrome ölçümünde aynı34.918üçgen için toplam çizim çağrısı800→295'e indi; fizik ve görsel ayrıntılar korundu. Fiziksel telefonda FPS ölçülmedi.

Robotuna öğret düğmesi ve1–500 tur seçimi, açılır panelden düello ekranına taşındı. Normal görünümde ve dikey/yatay tam ekranda erişilebilir; maç bitince aynı örnekler ve mevcut modelle hemen yeniden eğitim başlatılır. Varsayılan1tur korunur. İlerleme, durdurma ve eğitim sonucu aynı satırdadır. Eğitim sürerken maçın yeniden başlaması ve model modunun değişmesi engellenir.

Robotumu izle / Kontrolü devral düğmesi düello kontrollerine eklendi. Eğitimden sonra modeli doğrudan yeni düelloda izleyebilir, kontrolü geri aldığında mevcut saha ve örneklerden devam edebilirsin. Dar ekranda etiketler Robotu izle / Devral olarak kısalır. Android sürüm kodu2; kimlik ve imza Duel1.0.0 ile aynı olduğundan veriler korunarak güncellenir. APK: `NOEMA-Duel-1.0.1-android.apk`. Gerçek maç sonrası yeniden eğitim ve mobil kontrollerin doğrulaması: `QA_DUEL_1_0_1.md`.

**Noema Duel 1.0.0 — Ayrı uygulama, dokunarak atış**

Yeni bağımsız uygulama kimliği `studio.noema.duel`, sürüm kodu1. Eski Noema'nın `studio.noema.robot` kimliğinden farklıdır; Noema ile birlikte kurulur ve kendi uygulama verilerini kullanır. Aşağıdaki 2.x paketleri geliştirme sırasında Noema kimliğiyle üretilen eski denemelerdir; bağımsız Duel paketi `NOEMA-Duel-1.0.0-android.apk` dosyasıdır.

Joystick yalnızca hareketi yönetir. Sahaya dokunmak, dokunulan noktaya doğru tek düz atış yapar. Basılı tutmak ve sürüklemek ek atış yapmaz. Atışlar arasında1,25sn beklenir; bu sıradaki dokunuşlardan yalnızca sonuncusu için bir atış saklanır. Duraklatma ve ekran dönüşü bekleyen atışı iptal eder. Ayrı ateş düğmesi ve güç sürgüsü kaldırıldı. Bütün robotlar her zaman %100 güçle,18m/sn hızla ateş eder; eğik atış yoktur. Sekmeli duvarlar, taşları geçiren duvarlar ve45m menzil korunur.

77.926 parametreli GRU ve1 tur varsayılan eğitim korunur. Eski güç çıkışı dosya uyumluluğu için yedektedir; oyun gücünü değiştiremez ve eğitim kaybına katılmaz. Yeni gösterimler hareket, nişan, ateş ve siper içindir. Doğrulama: `QA_DUEL_STANDALONE.md`.

Arena öncelikli mobil uygulama düzeni: saha, joystick ve temel kontroller ilk ekrandadır. Eğitim/arena ayarları açılır panelde, model ayrıntısı beyin simgesindedir. Atölye, Online Arena ve Sıralama ayrı sekmelerdir; geçişlerde örnekler ve model korunur. Gerçek günlük online değerlendirme ve ayrı Duel sıralama servisi eklendi. Mobilde erişilebilir sunucu adresi ayarlanır; herkese açık sunucu bu paketle yayımlanmadı. Ayrıntılar: `DUEL_ONLINE.md`.

Tenis çizgileri ve tribünler yerine araştırma kampüsü kuruldu. Cam laboratuvarlar, bakır/seramik çevre, NOEMA ARENA girişi, sallanan ağaçlar, düşen yapraklar, dalgalanan flamalar ve hareketli kameralar vardır. Uzak şehir katmanları ve ışıkları, güneş/bulut/yağmur geçişleri, ıslanan zemin ve açılabilir rüzgâr/yaprak/yağmur sesleri eklendi. Çevre simülasyon kurallarından bağımsızdır; mobilde detay bütçesi azaltılır.

**Arşiv: NOEMA Duel 2.0.1 — Mobil joystick ve canlı arena**

Sürüm kodu 7; aynı uygulama kimliği ve geliştirme sertifikasıyla önceki sürümün üzerine kurulabilir. Dört yön tuşu yerine orantılı hız veren yuvarlak joystick kullanılır. Hareket ederken başka parmakla nişan almak ve ateş etmek mümkündür. Bırakma, iptal, odağın kaybı ve ekran dönüşünde hareket/ateş takılı kalmaz.

Tam ekran arena dikey ve yatay ekranlara uyarlanır. Yatayda joystick ve güç/siper/ateş iki köşededir; can, başlat/duraklat, sıfırla ve çıkış erişilebilir kalır. Aynı maç ekran dönüşünde devam eder. Android'e sistem çubuklarını gizleyen ve tam ekranda sensör yönünü izleyen yerel kontrol eklendi. Çıkışta önceki yön ayarı ve sistem çubukları geri yüklenir. Tam ekran API desteği olmayan WebView/tarayıcıda ekranı dolduran görünüm korunur.

Yeşil tema yerine mavi, mor, camgöbeği ve mercan paleti kullanılır; kort zemini, tribün vurguları, eğitim paneli, model görünümü ve dokunma kontrolleri birlikte yenilendi. 77.926 parametreli GRU, model/örnek kayıtları, 1 tur varsayılanı ve kort kuralları korunur. APK: `NOEMA-Duel-2.0.1-android.apk`; doğrulama: `QA_DUEL_MOBILE.md`.

**NOEMA Duel 2.0.0 — NOEMA ARENA**

Sürüm kodu 6. `NOEMA-Duel-2.0.0-android.apk` kurulabilir, önceki NOEMA paketleriyle aynı geliştirme sertifikasını ve uygulama kimliğini kullanır. `NOEMA-Duel-2.0.0-unsigned.aab` imzasız release bundle'dır.

Kort 30×18 metre, robot canı 240, hareket hızı 4,8 m/sn oldu. Taşlar 9,5–18 m/sn hızla ilerler; hareket eden rakibin önüne nişan almak anlamlıdır. Atışlar arasında sabit 1,25 saniye beklenir. Havadaki taş sayısına ayrı sınır yoktur. Sekmeler dahil her taşın menzili 45 metredir; gelecek atış yolunu gösteren çizgiler kaldırıldı. Taş, namlu tepmesi, darbe halkaları ve sönen iz efektleri yenilendi.

NOEMA ARENA tabelası, tribün saçakları, takım panoları, bitkilendirme ve çevre ışıkları eklendi. Mobil piksel oranı ve gölgeler hafifletildi; tribünler ve bitkiler ortak çizimlerle üretilir.

Eğitim varsayılan olarak yalnızca 1 tur çalışır. Tur sayısı, panelle uyumlu kompakt − / + kontrolü veya sayı alanından 1–500 arasında seçilir. Yeni eğitim mevcut ağırlıkların üzerinden devam eder. Eğitim sırasında 3B çizim duraklatılarak işlem yükü azaltılır.

Gerçek 77.926 parametreli 160→96→GRU96→64→6 model ve ayrıntılı beyin görünümü korunur. Altı motor çıktısı hareket X/Z, nişan açısı, güç, ateş ve siper içindir. Zaman sıralı gösterimler gerçek BPTT ile ayrı Worker'da eğitilir. Nöron, ağırlık, önceki/yeni bellek, reset/update/candidate değerleri incelenebilir. Model dışa/içe aktarma ve cihazda kalıcı kayıt vardır. Doğrulama: `QA_DUEL_2.md`.

**NOEMA 1.2.2 — Atölyeden doğrudan kontrol**

Sürüm kodu 5. `NOEMA-1.2.2-android.apk` kurulabilir; önceki paketle aynı geliştirme sertifikasını kullanır. `NOEMA-1.2.2-unsigned.aab` imzasız release bundle'dır.

Haritanın hemen altında bölüm seçimi, önceki/sonraki bölüm, Benzer bölüm ve Baştan izle bulunur. 56 bölümün tamamına bitirme koşulu olmadan geçilebilir. Benzer bölüm aynı temel odanın tek engeli değiştirilmiş, çözümü doğrulanmış düzenini açar; Asıl düzen geri döndürür. Aynı varyantın arka arkaya tekrar gösterilmesi engellenir.

Robotu izle artık yeni bir başlangıç oluşturarak robotu ışınlamaz; mevcut konum, kutular, kapılar, hamle geçmişi ve GRU belleğiyle devam eder. Tekrarda seçilen kareden de devam edebilir. Baştan izle aynı görünür bölümü sıfırlar ve oynatır; bitmiş bir bölümde Robotu izle de aynı düzenin başlangıcından oynar. Kalıcı model ağırlıkları korunur.

Tam ekranda Robotuna öğret düğmesi, örnek sayısı, gerçek eğitim ilerlemesi ve Durdur kontrolü bulunur. Bölüm kontrolleri, yön/E, kamera ve çıkış tam ekranda da kullanılabilir. Aşağıdaki toplu genelleme deneyi artık Robotu izle davranışını değiştiren gizli bir seçim içermez. Doğrulama: `QA_1_2_2.md`.

**NOEMA 1.2.1 — NOEMA INC araştırma kampüsü**

Sürüm kodu 4. `NOEMA-1.2.1-android.apk` kurulabilir, önceki paketle aynı geliştirme sertifikasını kullanır. `NOEMA-1.2.1-unsigned.aab` imzasız release bundle'dır.

- Arena çevresindeki koyu temel ile açık çevre taşlarının aynı yükseklikte çizilmesinden doğan siyah üçgenler giderildi; yüzeyler fiziksel olarak ayrıldı.
- Otomatik hava güneş, parçalı bulut ve yağmur arasında geçiş yapar. Sıcak doğrudan güneş, yumuşak hareketli bulut gölgelenmesi, gökyüzü ve ortam ışığı birlikte değişir.
- NOEMA INC tabelalı araştırma kampüsü, katmanlı uzak şehir, kemerli teraslar, çatı bahçeleri ve dört köşe gözlem kamerası eklendi. CAM düğmesi perspektif, sol çapraz ve üstten görünüm arasında geçer.
- Kapı lamelleri boy değiştirmeden gerçek üst kasete kayar; üst durum plakası kasaya bağlıdır. Geçit robotun başı dahil tamamen boş kalır.
- Tam ekranda aynı sahne ve yön/E kontrolleri birlikte açılır. Görünür çıkış, Escape, tarayıcı geri ve Android geri dönüşü desteklenir; Fullscreen API reddeden WebView için oynanabilir CSS görünümü vardır.
- Robot ilk çizilmiş görüntüyü bekler; önceki yürüyüş ve dönüş tamamlanmadan yeni karar vermez. Yavaş kareler birikmiş hızlı adımlara yol açmaz.

77.926 parametreli GRU ve kayıt anahtarı aynı kalır; oyuncunun mevcut eğitimi korunur. İlk kurulum eğitimsiz başlar. Test kanıtları ve cihaz sınırları `QA_1_2_1.md` içindedir.

**NOEMA 1.2.0 — GRU96**

`NOEMA-1.2.0-android.apk`: kurulabilir, geliştirme sertifikasıyla imzalı Android paketi. `NOEMA-1.2.0-unsigned.aab`: optimize edilmiş, imzasız mağaza paketi. Sürüm kodu 3; uygulama kimliği değişmez.

Gerçek 160→96→GRU96→64→6, 77.926 parametreli model cihazdaki Worker içinde sıralı gösterimlerle eğitilir. Bölüm boyunca geçici bellek taşınır; bölüm başında bellek sıfırlanır, öğrenilmiş ağırlıklar korunur. Kullanıcı isteğiyle yeni sürüm sıfırdan GRU profiliyle başlar; eski MLP eğitimi taşınmaz.

Beyin görünümü beş gerçek katmanı, 96 GRU bellek hücresini, sıfırlama/koruma kapılarını, aday değeri ve önceki/yeni belleği gösterir. Seçilen nöronun gerçek bağlantı ağırlıkları ve katkıları incelenebilir. Görünümü dondurma bütün ağ parametrelerini de saklar. Ekranı incelemek modelin belleğini ilerletmez.

Yerel değerlendirme ve sunucu arenası her bulmacanın başında GRU belleğini sıfırlar. Arena sonuçları yeni kural sürümünde ayrı tutulur. 56 oda, hava olayları, mobil denetimler ve çevrimdışı varlıklar korunur. Doğrulama: `QA_GRU_1_2.md`.

**NOEMA 1.1.0 — önceki teslim**

`NOEMA-1.1.0-android.apk`: Android'e kurulabilen, geliştirme sertifikasıyla imzalı paket. Yerel eğitim ve bütün oyun varlıkları çevrimdışı kullanılabilir.

`NOEMA-1.1.0-unsigned.aab`: optimize edilmiş release bundle. Mağaza yüklemesi uygulama sahibinin upload anahtarıyla imzalama gerektirir.

Bu sürümde 32 yeni oda eklendi: toplam yedi bölüm ve 56 oda. Buzda kayma, yönlü taşıma bantları, sıralı anahtarlar ve VE/VEYA/ters kapılar öğrenilecek yeni ilişkiler oluşturur. Hareketli kumaş flamalar, rüzgârda dallar/yapraklar, uçuşan yapraklar, bulutlanma, aralıklı yağmur, ıslaklık ve ortam sesleri eklendi.

Robotu izle varsayılan olarak yakın bir başlangıcı dener. Aynı oda ve tek engeli değiştirilmiş benzer oda seçenekleri de vardır. Ayrı değerlendirme paneli yedi farklı koşulu gerçek model kararlarıyla ölçer. Eğitim örnekleri yönleriyle birlikte geometrik olarak çeşitlendirilir. Model 160→64→64→6 ve 14.854 parametredir; eski modeller önceki kararları korunarak yükseltilir. Bölüm değişiminde öğrenme sıfırlanmaz.

Basit ilk odada iki öğretim tarzının her biri dört görülmemiş yakın başlangıcı ve rota dışında tek duvar değişikliğini çözdü. Bu ölçüm ileri mekaniklerin kendiliğinden öğrenildiği anlamına gelmez. Öğrenme tamamen cihazda gerçek ağırlık güncellemeleridir; robotun yerine çalışan gizli çözüm planlayıcısı yoktur.

Arena servisi yeni koşulları sunucuda değerlendirir; eski sürüm sonuçlarıyla karıştırmaz. İnternette çalışan arena sunucusu henüz yayımlanmadı.

Fiziksel telefon bağlı değildi; pil/ısınma ve gerçek telefon performansı doğrulanmış sayılmaz. iOS kaynakları hazırdır; Xcode derlemesi ve iPhone testi yapılmadı. Mağaza hesapları, yayın imzası ve canlı sunucu dağıtımı bu teslimin dışında kalır. Test raporları `QA.md` ve `artifacts/` içindedir.

Basılı düğmeler daha güçlü yüzey ve çevre ışığıyla görünür. Açılan kapılar üst kasaya çekilir; AÇIK/KAPALI durum plakası ve ışıklı geçit eklendi.


49–56. odalar aynı bölüm içindeki bağlı mekânlarda araç getirip geri dönmeyi gerektirir. Örneğin Yan Odadaki Kutu bölümünde kapı açılır, diğer odadan kasa alınır ve başlangıç odasındaki hedefe getirilir. Model aynı duruma tekrar tekrar dönerse izleme durur; oyuncu gerçek hatalı durumdan düzeltme gösterebilir. Mimari ve ezber analizi `MODEL_MIMARISI_ANALIZI.md` içindedir; önerilen 101.902 parametreli uzamsal/bellekli mimari analiz adayıdır, çalışan modelin yerine uygulanmış değildir.
