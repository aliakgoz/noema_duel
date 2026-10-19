**Mobil robot oyunu — doğrudan nihai ürün için fikir ve üretim planı**

Bu belge, konuşmada alınan kararları uygulanabilir bir oyun tasarımına dönüştürür. Çalışma yöntemi kısa araştırma, açık varsayım ve doğrudan üretimdir. Ayrı prototip ürünler, uzun kullanıcı araştırmaları ve art arda onay kapıları planlanmaz. Yayın kalitesini ve gerçek öğrenmeyi doğrulayan kontroller üretim sırasında yapılır. Ekip, bütçe ve mevcut kaynaklar bilinmediği için takvim henüz bir teslim tarihi değildir.

**1. Sabit kararlar**

| Konu | Kabul edilen karar |
|---|---|
| Platform | Mobil; oyuncu kendi telefonunda internet olmadan model eğitebilir. |
| Oyuncunun rolü | İnsansı bir robotun eğiticisi ve bulmaca çözücüsü. |
| Öğrenme | Robot, oyuncunun oyun içindeki çözüm davranışlarını gözlemleyerek gerçekten öğrenir. |
| Kontroller | Oyuncu ve model aynı dört yön tuşunu ve tek etkileşim tuşunu kullanır. |
| Görünürlük | Model çalışırken bastığı tuşlar anlık gösterilir; tekrar kaydında da görülebilir. |
| Beyin görünümü | Gerçek modelin nöron etkinlikleri ve bağlantı katkıları, beyin biçiminde canlı ve incelenebilir bir gösterimde izlenir. |
| Bulmacalar | Birden fazla geçerli çözüm yolu ve farklı yaklaşım biçimleri bulunur. |
| Kişisellik | Oyuncunun çözüm sırası, deneme alışkanlıkları ve araç kullanımı robotunun davranışına yansır. |
| Çevrimiçi rekabet | Aynı mimari, parametre sayısı ve derinlikteki modeller güvenilir sunucuda yarışır. |
| Sürpriz | Yarışlarda önceden görülmemiş bulmaca düzenleri ve koşul birleşimleri bulunur. |
| Kalite | Özgün sanat yönetimi, ayrıntılı mekânlar, kaliteli robot ve animasyonlar, tamamlanmış arayüz ve ses; yayınlanabilir nihai ürün. |
| Çalışma yöntemi | Belirsizlikte kısa kaynak araştırması yapılır, bir karar alınır ve doğrudan uygulanır. |

Ürün vaadi: **“Bulmacaları kendi tarzınla çöz, robotuna öğret ve onun yeni problemleri nasıl çözdüğünü keşfet.”**

**2. Oynanışın tamamlanmış biçimi**

Oyuncu bir problemi inceler, kendi çözümünü uygular, robotuna öğretmek istediği hamleleri seçer ve telefonda kısa bir eğitim çalıştırır. Ardından robotun benzer veya yeni bir düzeni çözmesini izler. Robotun zorlandığı an tekrar üzerinden bulunabilir; oyuncu o durumdan kontrolü devralıp bir düzeltme örneği verebilir. Eski model sürümüne dönmek ve iki eğitim sonucunu aynı problemde karşılaştırmak mümkündür.

Her çözüm otomatik olarak doğru öğretim örneği sayılmaz. Oyuncu deneme, kontrol hatası veya vazgeçtiği bir yaklaşımı eğitim kaydından çıkarabilir. Robot yalnızca bitmiş çözümleri değil, hatadan toparlanma örneklerini de öğrenebilir.

Çevrimdışı deneyim kendi başına tamamlanmış bir oyundur: kişisel bulmacalar, eğitim, robot denemeleri, ilerleme, özelleştirme ve kayıt internet gerektirmez. Çevrimiçi bağlantı, robotu yarışlara gönderme, arkadaş meydan okumaları ve diğer oyuncuların sonuçlarını izleme olanağı getirir.

**3. Kontrol ve öğrenme sözleşmesi**

İlk uygulama kararı dört yön ve etkileşimdir. Modelin çıktısı yukarı, aşağı, sola, sağa, etkileşim veya hiçbir tuşa basmama seçeneklerinden biridir. Tuşların basılı tutulma ve bırakılma davranışları, oyuncu ve robot için aynı sabit karar aralığında işlenir. Etkileşim, mevcut bağlama göre tutma, bırakma, düğmeye basma veya mekanizma kullanma gibi bir eylem yapar; bu bağlam oyuncuya açıkça gösterilir.

Robot, modelin seçtiği tuşlarla hareket eder. Animasyon ve fizik sistemi bu girdileri gerçekleştirir; bulmacanın çözüm yolunu robotun yerine seçmez. Kullanıcıdan gizli bir çözüm planlayıcısı, öğrenme başarısı gibi sunulmaz.

Eğitim verisi oyun motorundan alınan görünür durum ile o anda kullanılan tuşlardır. Başlangıç tercihi yapılandırılmış sayısal gözlemlerdir: görülebilen nesneler, konum ilişkileri, mekanizma durumları, robotun yönü ve taşıdığı nesne gibi bilgiler. Modelin görüş sınırı oyuncunun anlayabileceği şekilde tanımlanır; kapalı kapının arkasındaki bilgi veya gelecekteki rastgele sonuçlar girdiye eklenmez.

Uygulanan mimari 160 giriş, iki gizli katmanda 64 birim ve altı eylem çıktısıdır: 14.854 parametre. İlk 128 girişin anlamı korunur; yeni mekanikler 32 ek girişte görünür. Eski model ilk katmana sıfır sütun eklenerek kararları kaybolmadan yükseltilir. Bu mimari bütün yarışmacılar için sabittir. Bu sayı telefon ölçümü yapılmadan performans garantisi olarak sunulmaz. Aynı ligde bağlantı yapısı, sayısal hassasiyet, hafıza kapasitesi ve karar sıklığı da eşittir.

İlk öğrenme yöntemi oyuncu örneklerinden davranış öğrenmedir. Yeni düzeltmeler eski örneklerle dengeli karıştırılır; tek bir yeni dersin daha önce öğrenileni silmesi izlenir. Öğrenmenin gerçekten ağırlıkları değiştirdiği ve yeni düzenlerde davranışa yansıdığı doğrulanır. Mevcut araçlarda cihaz üzerinde eğitim ve çıkarıma hazır model üretimi desteklenmektedir; bu oyundaki hız ayrıca ölçülmelidir. [ONNX Runtime cihaz üzerinde eğitim](https://onnxruntime.ai/docs/get-started/training-on-device.html), [Unity’nin örneklerden öğrenme açıklaması](https://unity-technologies.github.io/ml-agents/ML-Agents-Overview/).

**3A. Canlı beyin görünümü**

Robotun gerçek modeline bağlı, özgün sanat yönetimiyle hazırlanmış bir beyin görünümü bulunur. Girişler, gizli katmanlar ve eylem çıkışları beyin formuna yerleştirilir; gösterilen düğümler ve bağlantılar gerçek model yapısına karşılık gelir. Dekoratif ışık akışı ile hesap verisi birbirine karıştırılmaz.

Nöronun o andaki etkinliği parlaklık veya büyüklükle; öğrenilmiş bağlantı ağırlığı çizgi kalınlığıyla; o karardaki sinyal katkısı ise bağlantı üzerindeki ışık akışıyla gösterilir. Doğrusal bir bağlantı için yerel katkı, kaynak nöron etkinliği ile bağlantı ağırlığının çarpımıdır. Katkının işareti ve büyüklüğü ayrı okunabilir. Katmanlar arası görsel ölçeklendirme açıklanır; farklı renkler biçim veya işaretle de desteklenir.

Bu değerler modelin hesap akışını gösterir; tek başına bir nöronun anlamsal görevi veya kararın kesin nedensel açıklaması sayılmaz. Gizli nöronlara kanıtsız şekilde “cesaret”, “kapı anlama” gibi isimler verilmez. Gözlem girişleri ve yön/etkileşim çıkışları gerçek işlevleriyle etiketlenir.

Oyuncu robot çalışırken görünümü açabilir, bir karar anını durdurabilir, belirli nörona dokunabilir, güçlü bağlantıları filtreleyebilir ve iki durumun etkinliklerini karşılaştırabilir. Çıkış nöronları ile ekrandaki tuş göstergesi aynı karar kaydından beslenir. Etkinlik kaydı model sürümüyle ilişkilendirilir; tekrar izlerken farklı ağırlıklarla geçmiş karar yeniden açıklanmaz.

Eğitim sırasında bağlantı ağırlıklarındaki değişim ayrı bir görünümde gösterilir. Yarış veya deneme sırasında ise sabit ağırlıklar üzerinden değişen etkinlik izlenir. İki gösterimin anlamı kullanıcıya kısa ve açık biçimde anlatılır.

Mobil görünümde bütün bağlantıların aynı anda yoğun animasyonla çizilmesi zorunlu değildir: güçlü bağlantı filtresi, katman yakınlaştırma ve seçili nöron ayrıntısı okunabilirliği korur. Veri gerçek hesaplardan alınır; görüntü yenileme sıklığı performans bütçesine göre ayarlanır. Beyin görünümü kapalıyken gereksiz görselleştirme maliyeti oluşmaz. Çevrimiçi karşılaşmalarda varsayılan olarak oyuncunun kendi robotu incelenir; rakiplerin ağırlık ve gizli durumları paylaşılmaz.

**4. Telefonda eğitim ve performans**

Android ve iOS hedeflenir; ortak oyun kodu kullanılır. Yayın sırası ve en eski desteklenen cihazlar mevcut geliştirme cihazlarına ve dağıtım hesabı olanaklarına göre tek seferde kararlaştırılır. GPU/NPU gerektirmeyen bir CPU eğitim yolu temel alınır.

Eğitim kısa, kesilebilir dilimler halinde arayüzü kilitlemeden yürütülür. Uygulama arka plana geçerse eğitim iptal edilir ve eğitim öncesi tamamlanmış model korunur; örnekler yeniden eğitim için saklanır. Eğitim örnekleri, model sürümleri ve ilerleme kapanma sırasında bozulmamalıdır. Gerekli eğitim bileşenleri kurulumda bulunur; çevrimdışı kullanım bulut çağrısına bağlı olmaz.

İlk mühendislik hedefi, kısa bir düzeltmenin yaklaşık 5–15 saniyelik eğitim içinde denenebilmesidir. Bu aralık bir çalışma varsayımıdır; cihaz ölçümü sonucuna göre güncelleme sayısı ve örnek miktarı ayarlanır. Kalıcı bekleme ekranları ve uzun boş eğitim oturumları temel oyun döngüsüne konmaz.

Bellek bütçesi; oyun, grafik varlıkları, ağırlıklar, gradyanlar, eğitim ara değerleri, örnek havuzu ve kayıt sürümlerinin toplamı üzerinden hesaplanır. En düşük hedef telefon ve orta sınıf bir telefonda uzun oturum sırasında akıcılık, dokunma gecikmesi, ısınma ve pil tüketimi kontrol edilir. Android’in resmî rehberi de sürdürülebilir performans için ısıya göre iş yükü ayarlamayı ele alır. [Android Thermal API](https://developer.android.com/games/optimize/adpf/thermal).

**5. Bulmaca tasarımı ve keşif**

Güncel uygulama yedi bölümde 56 ana bulmaca içerir. Aileler; nesne taşıma ve yerleştirme, basınç ve kapı bağlantıları, buzda momentum, yönlü taşıma bantları, sıralı anahtar grupları ve VE/VEYA/ters mantık etrafında birleşir. Her odanın gerçek motorla tekrar oynatılarak doğrulanmış bir çözüm sertifikası bulunur; sertifika modelin kararlarını üretmez. Aynı etkileşim dili farklı mimari mekânlara ve çok adımlı problemlere taşınır.

Her ana bulmacada birden fazla anlamlı yaklaşım bulunur. Farklılık; kullanılan araç, izlenen yol, kaynak harcaması, işlem sırası veya güvenilirlik açısından ortaya çıkar. Yalnızca aynı çözümün farklı görünümleri çoklu çözüm sayılmaz.

Kurallı bulmaca üretimi mevcut araçların yeni yerleşimlerini ve bileşimlerini oluşturur. Yakın başlangıç denemeleri robotu 1–3 güvenli kare kaydırır; benzer oda denemeleri bir iç engeli değiştirir. Aynı oda, üç benzersiz yakın başlangıç ve üç benzersiz benzer oda koşulunun başarıları ayrı ölçülür; eğitim uyumu genelleme puanı olarak kullanılmaz. İnsan örnekleri yön/etkileşim etiketleri birlikte dönüştürülerek çeşitlendirilir. Üretici, geçerli başlangıç ve tamamlanabilir bir çözüm yolu sağlamalıdır; alternatif yollar ayrıca korunur. Çözülemeyen, rastlantısal kilitlenme yaratan veya tek bir açık üzerinden geçilen düzenler yarışa alınmaz.

Keşif kaynakları yeni problem ilişkileri, robotun geliştirdiği davranışlar, oyuncunun kendi öğretme yöntemindeki iyileşmeler, diğer robotların yaklaşımları ve koşulların farklı birleşimleridir. Üretim miktarı tek başına yenilik ölçüsü değildir.

**6. Çevrimiçi sürpriz ve adil değerlendirme**

Oyuncu model sürümünü yarışa kaydeder; bu sürüm karşılaşmalar için kilitlenir. Sunucu yarış bulmacalarını ve başlangıç koşullarını üretir. Her modele aynı bilgi erişimi, robot yetenekleri, eylem sıklığı, hafıza ve işlem bütçesi verilir. Yarışta oyuncunun telefonu yalnızca sonucu izler; resmi hamleler ve sonuç sunucuda hesaplanır.

Sürpriz, bilinen kuralların görülmemiş birleşiminden ve yeni problem düzenlerinden gelir. Yeni bir özelliğin anlaşılabilmesi için gözlemlenebilir ipuçları bulunur. Oyuncuların hazırlık yaptığı oyun dilini habersizce geçersiz kılan kural değişiklikleri yapılmaz. Birebir gelecekteki test düzenleri açıklanmaz; eğitim ortamı, kural ailelerini çalışmaya izin verir.

Başlangıçta maç sırasında ağırlık güncellemesi yapılmaz. İzin verilen sınırlı geçmiş bilgisi ve hafıza, aynı kuralla kullanılır ve karşılaşma başında sıfırlanır. Böylece eğitim ile yarışma kaynak bütçeleri anlaşılır kalır.

İlk çevrimiçi biçim, aynı problem setinin ayrı kopyalarını çözen robotların karşılaştırıldığı asenkron yarışmadır. Arkadaşlar birbirlerine meydan okuyabilir; birlikte izleme ve sonuç karşılaştırma deneyimi tamamlanır. Eşzamanlı oyuncu müdahalesi resmi robot yarışının parçası değildir.

Ana başarı ölçüsü görülmemiş bulmacaları tamamlama ve farklı koşullarda tutarlılıktır. Az hamle ve az kaynak gibi ölçüler açıkça belirtilen ayrı karşılaştırmalar sağlar. Yalnız hızı ödüllendiren tek bir puan oyuncu tarzlarını daraltabileceği için ana sıralamanın tek dayanağı yapılmaz. Birden fazla bulmaca, dengelenmiş başlangıçlar ve yeterli tekrar ile şans etkisi azaltılır.

**7. Güvenlik ve rekabet kuralları**

Çevrimdışı eğitim serbesttir. Resmi yarışma, eğitim geçmişi veya yerel XP beyanı üzerinden sonuç üretmez; gönderilen modeli kendisi çalıştırır. İyi ağırlıklar geliştirmek oyunun amacıdır. Eğitim donanımının ve süresinin eşit olduğu iddia edilmez; yarış koşulları eşitlenir.

Sunucu oyuncunun çalıştırılabilir kodunu veya serbest model grafiğini kabul etmez. Sabit mimariye ait sınırlandırılmış sayısal ağırlıkları alır; sürüm, boyut, sayı adedi ve geçersiz değerleri kontrol eder. Dosya işleme ve maç çalıştırma kaynak sınırlarıyla yalıtılır. Güvenilmeyen model yüklemesinin ayrıca korunması gerekir; PyTorch da güvenilmeyen veriyi yükleme konusunda açık uyarı verir. [PyTorch model yükleme güvenliği](https://docs.pytorch.org/docs/stable/generated/torch.load.html).

Modelin gizli bilgiye erişmesi, yarış sonucunun istemciden kabul edilmesi, aynı ödülün tekrar verilmesi ve bir modelin diğer maçların kaynaklarını tüketmesi engellenmesi gereken davranışlardır. Hilelerin bütünüyle imkânsız olduğu sözü verilmez; korunan sınırlar somut olarak tanımlanır ve kontrol edilir.

Resmi başarımlar ve yarış ödülleri sunucu sonucundan çıkar. Model kimliği hangi sürümün yarıştığını belirler; oyuncunun modeli kendi başına eğittiğinin kanıtı sayılmaz. İlk yayında model pazarı ve oyuncular arası ticaret bulunmaz. Harici eğitim ve model paylaşımı kuralları açıkça yayımlanır; doğrulanamayan kişisel emek iddiaları sıralama ölçüsü olmaz.

**8. Karakter gelişimi ve erişilebilirlik**

Robotun esas gelişimi öğrendiği davranışlardır. Buna görünüm, atölye, kişisel başarı günlüğü ve açılan bulmaca içerikleri eşlik eder. Seviye veya ödeme, resmi yarışta daha büyük model, fazla görüş, hızlı hareket veya ek işlem hakkı vermez.

Eğitim araçları kodlama ve matematik bilgisi gerektirmez. Oyuncu çözerek, tekrar üzerinden düzeltme yaparak ve örnek seçerek öğretir. Eğitim sırasında duraklatma ve adım adım kontrol kullanılabilir; kaydedilen robot eylemleri ortak zaman adımlarına dönüştürülür. Temel öğretme işlemi hızlı refleks zorunluluğu taşımaz.

Büyük ve yeniden düzenlenebilir dokunmatik kontroller, okunaklı yazılar, renk dışında da bilgi veren işaretler, altyazılar, titreşim ayarı ve hareket etkilerini azaltma seçenekleri yayın kapsamındadır. İlk ders oyun içinde kısa ve etkileşimli verilir. Tuş göstergesi hem anlık hem tekrar izlerken açıktır; gerçek basılan tuşları gösterir. Robotun karar nedeni bilinmiyorsa uydurulmuş bir iç düşünce açıklaması gösterilmez. [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/).

**9. Sanat, mekân mimarisi ve sunum**

Sanat yönü; insansı robotun belirgin bir siluete ve kişiliğe sahip olduğu, ayrıntılı mimariyle çevrili özgün bir bilimkurgu dünyasıdır. Mekânlar işlevi okunabilen ama katmanlı kompozisyonlara, zengin malzemelere ve çevresel anlatıma sahip olur. Robotun malzeme, eklem, yüz veya ışık dili ve animasyon karakteri aynı tasarım anlayışını taşır.

Yayın varlıkları: tamamlanmış robot modeli ve rig, yürüyüş ve dönüşler, tutma/bırakma/etkileşim animasyonları, bekleme ve tepki hareketleri, çevre setleri, ışık düzenleri, malzemeler, görsel efektler, canlı beyin görünümü, özgün arayüz, ikonlar, ses efektleri, müzik ve mağaza görselleridir. Geçici varlıklar yayın paketinde bulunmaz. Tuş göstergesi ve beyin görünümü oyunun arayüz estetiğine uygun tamamlanmış bileşenlerdir.

Hareketli flamalar, katmanlı ağaç/dal/yaprak hareketleri, uçuşan yapraklar, bulutlanma ve aralıklı yağmur ortamı canlı tutar. Işık, sis ve ıslaklık birlikte değişir; sesler kullanıcı etkileşiminden sonra ve ses ayarına bağlı başlar. Hava yalnız görsel/işitsel atmosferdir, eşit bulmaca kurallarını değiştirmez.

Mobil performans; ölçülü geometri ve doku bütçeleri, uygun ışıklandırma, ayrıntı seviyeleri ve cihaz kalite profilleriyle yönetilir. Sanatsal kimlik bütün profillerde korunur. Ekran oranları, güvenli alanlar, küçük ekran okunabilirliği, kamera kapanmaları ve dokunmatik kullanım birlikte ele alınır.

**10. Yazılım mimarisi, kayıt ve işletme**

Uygulanan teknik seçim React/TypeScript + Three.js + Capacitor 8 mobil istemci, ayrı deterministik oyun kuralları, yerel Worker üzerinde gerçek geri yayılım ve aynı kuralları kullanan sunucu yarış servisidir. Android ve iOS proje kaynakları vardır; Android paket bu Windows ortamında üretilir. Grafikler eğitim boyunca statik tutulur; eğitim Worker içinde sürer ve bittikten sonra sahne hareketi devam eder.

Sorumluluklar ayrı tutulur: görüntü ve giriş, bulmaca kuralları, gözlem/eylem sözleşmesi, eğitim verisi, model güncelleme, yerel kayıt, çevrimiçi hesap ve yarışma. Aynı oyun kuralları sunucu değerlendirmesinde kullanılır. Model ve bulmaca sözleşmeleri sürümlenir; güncellemenin önceki robot eğitimine etkisi açıkça yönetilir.

Yerel kayıt; eğitim örneklerini, model sürümlerini, kişisel ilerlemeyi ve ayarları içerir. Bulut eşitlemede iki cihazın çatışması sessizce veri silmemelidir. Bağlantı kopması tamamlanmış yerel eğitimi kaybettirmez; model yükleme yeniden denenebilir ve aynı yarış ödülü ikinci kez verilmez. Yarış sonucu sonradan görüntülenebilir.

Sunucu maliyeti; aktif oyuncu başına model yükleme, maç sayısı, maç süresi, depolama ve destek üzerinden tahmin edilir. Yarışların işlem ve katılım sınırları bu bütçeye göre seçilir. Sunucu hizmeti durduğunda çevrimdışı oyun ve kişisel robot eğitimi çalışmaya devam eder.

**11. Ticari yayın için alınacak kararlar**

Başlangıç gelir varsayımı ücretsiz deneme ve tek satın almayla tam oyun erişimidir; ücretli eğitim gücü veya rekabet avantajı satılmaz. Fiyat, mağaza konumlandırması ve varsa kozmetik satışları hedef pazar incelemesiyle belirlenir. Zorunlu günlük giriş, robotun ilgisizlikten beceri kaybetmesi veya eğitim sırasında reklam bekletmesi kullanılmaz.

Yayın öncesinde hedef yaş, Türkçe/İngilizce metin kapsamı, mağaza hesapları, oyun ve model bileşenlerinin ticari lisansları, görsel/ses hakları, veri toplama, hesap silme, gizlilik metinleri ve platformun içerik bildirim kuralları kararlaştırılır. İlk yayında serbest sohbet ve kullanıcı içeriği pazarı kapsamı büyütmez. Destek, hata bildirimi, kötüye kullanım ve yarış sonucu itirazı için bir kanal bulunur.

Geniş kitle hedefi, erişilebilir kontrol, anlaşılır eğitim, cihaz kapsaması, fiyat ve çekici sanat üzerinden ele alınır. Herkesin oyunu isteyeceği veya hiçbir oyuncunun sıkılmayacağı garanti olarak kullanılmaz.

**12. Hızlı çalışma yöntemi ve tamamlanma tanımı**

Her belirsizlik için tek satırlık karar kaydı tutulur: konu, seçilen varsayım, kısa gerekçe ve yalnızca hangi somut sorun çıkarsa değiştirileceği. Araştırma, uygulanacak soruya bağlanır; araç ve kaynaklar öğrenildiğinde karar verilir. Ayrı fikirler ve prototipler arasında dolaşılmaz.

Üretim doğrudan aynı oyunda ilerler. Öğrenme ve bulmaca kuralları ilk çalışan bütünlüğü oluştururken sanat, robot ve ortam üretimi paralel yürür. Yarış servisi aynı model/eylem sözleşmesine bağlanır. Bitmiş varlıklar, öğretim, arayüz ve ses aynı ürün içinde tamamlanır. İş sırası bağımlılıklara göre kurulur; her adım yeni bir kullanıcı onayı gerektirmez.

Gerekli kontroller: uçak modunda çöz–öğret–eğit–dene döngüsü; gerçek ağırlık güncellemesi ve yeni bulmacada etkisi; farklı oyuncu tarzlarının davranışa yansıması; oyuncu/robot tuş eşitliği ve doğru gösterge; beyin görünümündeki etkinlik ve katkıların gerçek model hesabıyla eşleşmesi; uzun telefon oturumunda performans; kayıt kurtarma; sunucuda eşit model sınırları; hatalı model dosyası ve tekrarlanan ödül işlemi; yayın paketindeki görsel, ses ve arayüz bütünlüğü.

Ürün tamamlandığında oyuncu telefonda robotuna kendi çözüm tarzını öğretebilir, onu çevrimdışı yeni problemlerde kullanabilir ve çevrimiçi yarışlara aynı modelle katılabilir. Öğrenme gerçektir; yarış sonuçları sunucudan çıkar; kontroller ve robotun bastığı tuşlar anlaşılırdır; bütün oyuncuya dönük varlıklar yayın kalitesindedir. Mağaza paketi, tanıtım görselleri, ilk kullanım, ayarlar, kayıt, hata durumları ve destek akışı ürünün parçasıdır.
