# NOEMA Duel — Robotunu eğit

**Noema Duel ayrı bir uygulamadır.** Android kimliği `studio.noema.duel`, ilk bağımsız sürümü 1.0.0 / kod1'dir. Eski Noema'nın `studio.noema.robot` kimliğinden farklı olduğundan onun üzerine kurulmaz; ikisi aynı telefonda bulunabilir ve ayrı uygulama verileri kullanır. Eski akademinin kaynakları `src/App.tsx`, `src/core`, `src/ml` ve `src/render` altında durur; Duel oyunu `src/duel` altındadır.

## Oynayarak öğret

1. **Düelloyu başlat.** ATLAS senin robotun, KOR antrenman rakibin. Örnek kaydı başlangıçta açıktır.
2. **Arenanın sol yarısında istediğin noktaya basıp sürükleyerek hareket et.** Kontrol görseli gösterilmez; başlangıç noktasından uzaklaştıkça hızlanırsın. Parmağını bırakınca durursun. Hareket parmağın orta çizgiyi aşsa da aynı hareketi yönetir. **Sağ yarıda dokunduğun noktaya doğru tek atış yapılır.** Hareket ederken diğer parmakla sağ yarıya dokunabilirsin; sol tarafta yeni dokunuşlar atış yapmaz. Ayrı ateş düğmesi ve güç ayarı yoktur; bütün atışlar düz ve sabit %100 güçtedir. Bilgisayarda WASD / yön tuşlarıyla veya sol alanda fareyi sürükleyerek hareket et; sağ alana tıklayarak ateş et. Space ile basılı ateş desteği de vardır.
3. Yakındaki kendi kutunu E veya **Al / bırak** ile al. Başka bir yere taşıyıp tekrar bırak. Kutu taşırken hareket yavaşlar ve ateş edilemez.
4. En az16örnekten sonra sağ kenardaki küçük **Eğit** düğmesini açıp **Robotuna öğret** ile gerçek sinir ağını eğit. **Tur sayısı** varsayılan **1 turdur**; yazarak veya − / + düğmeleriyle1–500 arasında değiştirebilirsin.1.0.2ile eğitim kutusu başlangıçta kapalıdır ve düello sırasında sahayı kaplamaz. Panel X/Escape veya dış dokunuşla kapanır; paneli kapatan saha dokunuşu atış yapmaz. Eğitime basınca maç duraklar ve panel açık kalır. Canlı loss, tamamlanan tur, örnek sayısı, süre ve gerçek tur ölçümlerinin grafiği görünür. İlk tur bitmeden loss sıfır gösterilmez. Paneli kapatıp Eğit düğmesinden tekrar açarak aynı ilerlemeyi izleyebilir veya eğitimi iptal edebilirsin. Eğitim bitince sonuçlar panelde kalır; iptalde yarım kalan denemenin loss’u ile korunan modelin loss’u ayrılır. Maç bittikten hemen sonra aynı düğmeden mevcut model ve örneklerle yeniden öğretilebilir. Daha fazla ve çeşitli durumlar göstermek daha yararlıdır.
5. Düello kontrollerindeki **Robotumu izle** (dar ekranda **Robotu izle**) ile öğrendiği modeli yeni maçta dene. Aynı düğme **Kontrolü devral** (dar ekranda **Devral**) olur; mevcut konumdan düzeltme gösterebilirsin. Önceki modelden ve biriken örneklerden eğitime devam edilir.

Üç kort ve hücum / dengeli / savunma antrenman rakibi vardır. Kort veya maç değişince öğrenilen model ve örnekler korunur. **Örnekleri temizle**, modeli silmeden gösterimleri temizler. Kayıt düğmesiyle örnek biriktirmeyi durdurabilirsin.

Düelloyu başlatmak veya **Robotumu izle** ile yeni maç açmak arenayı otomatik tam ekrana geçirir. Sağ üstteki **Tam ekrandan çık** ile normal görünüme dönebilirsin; maç ve örnekler korunur. Maç sürerken tekrar otomatik tam ekrana zorlanmazsın; duraklatıp devam etmek de normal görünüm seçimini korur. Sağ üstteki **Tam ekran** ile istediğinde tekrar büyütebilirsin. Dikey görünümde kontroller altta, yatay görünümde joystick solda, siper ve atışın hazır olma durumu sağda kalır; can göstergeleri, duraklatma ve çıkış erişilebilirdir. Telefonu döndürmek aynı maçı ve eğitim örneklerini korur; basılı hareket ve bekleyen atış bırakılır. Android APK'da tam ekran sistem çubuklarını gizler ve sensöre göre yön değiştirir; çıkışta normal görünüm geri gelir. Tam ekran API'si olmayan tarayıcılarda ekranı dolduran görünüm çalışır.

Atölye arena önceliklidir: kısa başlık, büyük saha ve temel kontroller açılış ekranına sığar. Öğretme ve tur sayısı sağdaki küçük **Eğit** düğmesinden gerektiğinde açılır; robotu oynatma doğrudan düello kontrollerindedir. Örnek kaydı ve rakip/arena ayarları kapalı başlayan alt paneldedir. GRU görünümü arenadaki beyin simgesinden açılır; geniş ekranda model önizlemesi de görünür. Gece mavisi yüzeyler, mor eylemler, mavi/turuncu takım vurguları kullanılır.

Mobil alt sekmeler **Atölye**, **Online Arena** ve **Sıralama** sayfalarını açar. Sekme değişince maç duraklar; model, örnekler ve saha korunur. Online Arena eğitilmiş GRU'yu sunucunun üç günlük düellosunda sınar; Sıralama gerçek sunucu sonuçlarını gösterir. APK'da erişilebilir sunucu adresi girilmelidir; herkese açık bir sunucu bu paketle yayımlanmaz. Kurulum ve protokol: [DUEL_ONLINE.md](DUEL_ONLINE.md).

Çevre, ilk Noema'nın araştırma kampüsüne yaklaştırılmıştır: cam laboratuvarlar, bakır/seramik yürüyüş alanları, NOEMA ARENA girişi, rüzgârda sallanan dallar ve tekil yapraklar, düşen yapraklar, dalgalanan flamalar ve dönen gözlem kameraları bulunur. Arka planda katmanlı şehir ve yanan pencereler vardır. Hava simülasyondan bağımsız bir saatte güneş/bulut/yağmur arasında geçer; arenadaki hava simgesiyle güneşli veya yağmurlu hava da seçilebilir. Bulutlar güneş ışığını değiştirir, yağmur zemini ıslatır. **Sesi aç** rüzgâr, yaprak hışırtısı ve yağmuru etkinleştirir; başka sekmede, gizli uygulamada ve eğitim sırasında ambiyans susar.

1.0.1 ile şehir eğimli vadi üzerindeki dört mahalle, farklı cepheler, çok yüzlü pencereler, kademeli çatılar, sokak ışıkları ve hareketli trafikle yeniden oluşturuldu. Açılı görünüm gerçek perspektiftir; uzak binalar küçülür ve yan cepheleri görülür. Arena ekran oranına göre otomatik kadraja sığar; tepeden görünüm ve dokunulan dünya noktasına nişan alma korunur. Sis, portredeki daha uzak kamera konumuna göre ayarlanarak oyun alanının okunaklı kalmasını sağlar.

## Kort kuralları

- Her robot kendi yarı sahasında kalır. Orta çizgi taşları geçirir.
- Turuncu duvarlar taşları sektirir. Saydam, kesikli duvarlar robotları durdurur, taşları geçirir.
- Kutular taşları emer, hasar alır ve kırılır. Robotlar sadece kendilerine ait kutuları taşıyabilir.
- Kort 30 × 18 metredir. Robotların 240 canı vardır; hareket hızı 4,8 m/sn, kutu taşırken 3,45 m/sn olur.
- Atışlar düz ve sabit %100 güçtedir: hız 18 m/sn, başlangıç hasarı 26. Rakip hareket ederken önüne nişan almak gerekir. Atışlar arasında 1,25 saniye beklenir; havadaki taş sayısı ayrıca kısıtlanmaz. Bekleme sırasında dokunursan son dokunduğun nokta için yalnızca bir atış sıraya alınır. Parmağı basılı tutmak veya sürüklemek ek atış yapmaz.
- Her taş sekmeler dahil toplam 45 metre yol alabilir. Menzil bittiğinde söner. Gelecekte izleyeceği yolu gösteren nişan çizgileri yoktur.
- Rakibinin canını sıfırlayan kazanır; eş zamanlı tükenme beraberedir. Süreye göre otomatik kazanan atanmaz.

## Gerçek öğrenme

**Robotumu izle** sırasında normal ekranda ve tam ekranda canlı kontrol göstergesi bulunur: joystick modelin sürekli X/Z hareket isteğini, Ateş ve Al / bırak ışıkları eş zamanlı komutlarını gösterir. Gösterilen yön çarpışmadan sonraki hız değildir; robot bir engele yürüse de gitmeye çalıştığı yön okunur. Atış isteği, gerçekten çıkan atış, yeniden dolum ve siper taşıma durumu ayrılır. Gösterge dokunma veya klavye kontrolü almaz. Loss formülü ve hangi örneklerin öğrenildiği: [DUEL_LEARNING.md](DUEL_LEARNING.md).

ATLAS için önceki oyunun **160 → 96 → GRU96 → 64 → 6, 77.926 parametreli mimarisi** kullanılır. Aynı yoğun katmanlar, 96 gerçek GRU hücresi ve reset / update / candidate kapıları vardır. Girdiler iki robotun durumunu, yaklaşan taşları, kutuları, yakın duvarların malzemelerini ve 8 × 8 yerel engel haritasını içerir. Hareketin iki ekseni, nişan açısı, ateş ve siper etkileşimi öğrenilir. Dosya uyumluluğu için altı çıkış korunur; eski güç nöronu yedektir, eğitim kaybına katılmaz ve atış gücünü değiştiremez. Nişan için dairesel kayıp kullanılır; ±180° sınırındaki açılar karşı yöne ortalanmaz. Çıktılar doğrudan fizik motoruna gider; öğrenilmiş robotun yerine çalışan kural tabanlı taktik planlayıcısı yoktur. KOR, eğitim için kural tabanlı rakiptir.

Örnekler maç sırasında saniyede on kez ve ateş/siper etkileşimlerinin başında kaydedilir; en yeni 8.000 örnek tutulur. Gösterimler maç ve kesinti sınırlarıyla zaman sırasını korur. Gerçek BPTT, 32 adımlık pencereler arasında belleği taşıyarak GRU ve etkin motor çıktılarının ağırlıklarını Adam ile eğitir. Eğitim ayrı bir Worker'da çalışır; iptal edilirse önceki model korunur. Canlı kararlar saniyede on kez hesaplanır; beyin çizimi mobilde saniyede en fazla 2,5 kez yenilenir. Eğitim hatası örneklere uyumu gösterir, yeni bir kortta kazanma garantisi değildir. Mimari korunmuştur; kortun gözlem ve motor sözleşmesi farklı olduğundan akademinin eğitim ağırlıkları aynı anlamda kullanılamaz.

**Modeli incele** ile gerçek nöron aktivasyonları, ağırlıklar ve 96 bellek hücresinin önceki / yeni belleği, reset, update ve candidate değerleri görülür. Görünümü dondurmak sinyalleri ve ağırlıkları birlikte saklar; inceleme model belleğini ilerletmez. Model indirilebilir ve uyumlu model dosyası yüklenebilir.

Örnekler ve model IndexedDB'deki `noema-local-v1 / records / noema-duel-gru96-v1` kaydında otomatik saklanır. Geçici GRU belleği modele yazılmaz; yeni maçta sıfırlanır. Eski akademi kayıt anahtarları ayrıdır. Android'de yeni uygulama kimliği ayrıca cihaz depolamasını ayırır; Noema'nın verilerine erişmez. Eğitim ve oyun çevrimdışı çalışır; herhangi bir model API'si kullanılmaz.

## Çalıştırma ve doğrulama

Node kuruluysa `npm run dev`; üretim paketi için `npm run build`, mevcut başlatıcı için `NOEMA.cmd`. Bu çalışma alanındaki taşınabilir Node ile geliştirme sunucusu:

```powershell
& ./.tools/node-v24.22.0-win-x64/node.exe node_modules/vite/bin/vite.js --host 127.0.0.1
```

Testler `npm test` ile çalışır. `e2e/duel.mjs`, gerçek WebGL ve gerçek eğitim Worker'ıyla öğretme → eğitme → izleme, kayıtların yeniden yüklenmesi, duraklatma ve mobil görünümü kontrol eder. Geliştirme sunucusuna göre `BASE_URL` ayarlanabilir. Ekran görüntüleri ve sonuçlar `artifacts/duel` altına yazılır.

Mobilde piksel oranı en fazla1,25, gölge haritası1024px; kampüs detayları, şehir pencereleri ve yapraklar ortak çizimlerle üretilir. Yağmur ve yaprak sayısı mobilde azaltılır. Çevre oyunun rastgele sayı üretecini ve fizik durumunu değiştirmez. Android APK üretimi `powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1` komutuyla yapılır; güncel çıktı `releases/NOEMA-Duel-1.0.6-android.apk` olur.
