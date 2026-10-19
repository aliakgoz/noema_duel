# NOEMA: karmaşık görevler, ezber ve model boyutu

Sürüm 1.2 notu: aşağıdaki inceleme önceki MLP sürümüne aittir. Güncel oyun artık 77.926 parametreli 160→96→GRU96→64→6 modelini kullanır ve eğitimsiz başlar; ürün doğrulaması `QA_GRU_1_2.md` içindedir. 101.902 parametreli haritalı aday oyuna uygulanmadı.

17 Ekim 2026. Bu belge kaynak incelemesi, gerçek motorla karşı örnek ve kesin parametre hesabını içerir. Çalışan oyunda 160→64→64→6 model bulunur. Sonradan yapılan gerçek eğitim ve oyun karşılaştırması [GRU_DENEYI.md](./GRU_DENEYI.md) içindedir: 101.902 parametreli aday artık izole deneyde eğitilip sınanmıştır, oyuna uygulanmamıştır. Aşağıdaki öneriler bu deneyden önceki tasarım hesabıdır; adayın yeterliliği olarak okunmamalıdır.

**Deney sonrası düzeltme:** Harita+GRU adayı eğitim koşullarını 240/240 çözerken, eğitimde bulunmayan yedi odanın iki tohumlu denemelerinde 0/14 aldı. Daha küçük GRU 5/14, benzer parametreli belleksiz kontrol de 5/14 aldı. Bu nedenle aşağıdaki boyut önerisi genelleme başarısı kanıtı değildir. Ezber sorununu yalnız katman/parametre sayısıyla çözme varsayımı gerçek sonuçlarla desteklenmedi.

## Sonuç

Bugünkü modelin iki gizli katmanı ve **14.854 parametresi** var. Basit bir odada görülmeyen yakın başlangıçlara aktarım yapabildiği ölçüldü. Bütün mekanikleri veya uzun oda bağımlılıklarını öğrendiği gösterilmiş değil.

“Ezberlemeyen model için zorunlu en az N katman/P parametre” sayısı bu görev tanımından çıkarılamaz. Kaynak incelemesi daha temel bir sorun gösterdi: bazı farklı haritalar model için tamamen aynı girdiye dönüşüyor. Önce bu bilgi kaybını düzeltmek, sonra kapasiteyi gerçek testlerle seçmek gerekir.

Deney öncesinde seçtiğim geliştirme adayı: **iki küçük harita katmanı + tek GRU96 bellek katmanı; eski modeli koruyan toplam 101.902 parametre**. Bu bir mühendislik başlangıç seçimi ve kesin boyut hesabıdır; kanıtlanmış minimum veya başarı garantisi değildir. Sonraki gerçek deney yeni odalarda üstünlük göstermedi. Telefonda süre/ısınma ölçümü yapılmadan performans sonucu verilemez.

## Mevcut ağ neyi görüyor?

`src/core/observation.ts` 160 sayıya şunları sığdırıyor: robot yönü/taşıdığı nesne, 3×3 yakın çevre, en yakın kutular/hedefler, dört kareye kadar düz ışınlar, en yakın kapının özet mantığı, sıradaki numaralı düğme ve son iki eylem. Bütün harita, bütün nesneler ve kapı–anahtar eşleşmeleri eksiksiz görünmüyor. Son iki tuş, öğrenilmiş bölüm belleği değildir.

`scripts/analyze-model.ts` gerçek motorla iki sentetik konveyör odası kurar. Uzak iki duvar hücresi farklıdır; başlangıçtaki **160 Float32 değerinin tamamı aynıdır**. Bir odada ilk seçim sola, diğerinde sağa olmak zorundadır. Yanlış dalın çözümsüzlüğü, ulaşılabilir sonlu durum grafiğinin tamamı gezilerek doğrulanır. Bu, yazılmış odaların çözümsüz olduğunu söylemez; gözlem sözleşmesinin genel sınırını kanıtlar. Eksik bilgi hiç görülmediyse GRU da onu hatırlayamaz.

56 odanın en büyük boyutu 18×9, dönüşüm sonrası en büyük kenarı 18; en fazla 3 kasa, 4 anahtar, 2 kapı ve 2 sıra grubu var. Kayıtlı en uzun çözüm sertifikası 62 karar; bu uzunluk gerekli sinir ağı katman sayısı değildir.

## Yeni bağlı oda görevleri

49–56. bölümler tek bir ortak oyun durumu içinde birden fazla odayı bağlar. Örneğin 49. bölüm: başlangıç odasındaki düğmeyle kapıyı aç, diğer odadan kasayı al, başlangıç odasındaki yuvaya getir, çıkışı tamamla. Diğerleri iki renkli araç odaları, yardımcı kutuyla ikinci depoyu açma, ters bağlantı ve odalara dağılmış sıralı anahtarları birleştirir.

Öğrenilecek ilişki yalnız “sonraki tuş” değildir: hangi hedef eksik, gerekli araç nerede, hangi geçit bu araca erişim sağlıyor, araç alındıktan sonra hangi hedefe dönülecek? Fiziksel bütün durum eksiksiz verilirse uzun çözüm tek başına tekrarlayan ağ gerektirmez. GRU; görev odağını, keşif bilgisini ve hatadan toparlanma bağlamını taşımak için bir adaydır. Sıralı anahtarların ilerlemesi zaten girdide bulunur; bunların varlığı tek başına GRU zorunluluğu kanıtı değildir.

## Kesin boyut karşılaştırması

Dense katman: `girdi × çıktı + çıktı`. İki bias vektörlü GRU: `3 × h × (girdi + h + 2)`. GRU'nun üç kapısı üç ayrı bellek katmanı değildir. Bu sayım [PyTorch GRU parametre tanımıyla](https://docs.pytorch.org/docs/2.14/generated/torch.nn.GRU.html) uyumludur.

| Aday | Yapı | Parametre | Durum |
|---|---|---:|---|
| Çalışan model | 160→64→64→6 | 14.854 | Uygulanmış |
| Daha derin düz ağ | 160→96→96→64→6 | 31.366 | Kapasite karşılaştırma adayı |
| Bellekli ağ | 160→96→GRU96→64→6 | 77.926 | İzole deneyde eğitilip sınandı; harita eksikliği sürer |
| Geniş bellekli ağ | 160→128→GRU96→64→6 | 92.294 | Eski modele doğrudan eşdeğer geçiş yok |
| Eski ağa bellek dalı | Eski ağ + GRU96 + 96→64 | 67.654 | Davranışı başlangıçta koruyabilir; harita eksikliği sürer |
| Haritalı, belleksiz denetim | Eski ağ + harita kodlayıcı + 32→64 | 41.934 | İzole deneyde eğitilip sınandı |
| Önerilen bütün aday | Eski ağ + harita kodlayıcı + GRU96 + birleştirme | **101.902** | İzole deneyde sınandı; oyuna uygulanmadı |

## Önerilen 101.902 parametrenin açılımı

Harita 20×20 alana, boş dolgu maskesiyle yerleştirilir. 16 kanal; yürünebilir topoloji, iki renk kasa/hedef, çıkış, anahtar kimliği/türü/durumu, sıra grubu/sırası/ilerlemesi, kapının açık durumu/mantığı/bağlı anahtarları, zemin türü/yönü ve robot konumunu kodlar. Mevcut 160 özellik yerel ayrıntıları taşımaya devam eder. Bağlantı bitleri bu oyunun en fazla dört anahtarı için tam gösterilebilir; bunlar çözüm yolu veya doğru eylem değildir.

| Blok | Boyut ve sayım | Parametre |
|---|---|---:|
| Mevcut ağ | 160→64→64→6 | 14.854 |
| Harita katmanı 1 | 3×3, stride 2, padding 1, 16→16: `(9×16+1)×16` | 2.320 |
| Harita katmanı 2 | 3×3, stride 2, padding 1, 16→24: `(9×16+1)×24` | 3.480 |
| Harita özeti | 5×5×24=600 →32: `600×32+32` | 19.232 |
| Bölüm belleği | Eski ilk gizli katman 64 + harita özeti 32 →GRU96 | 55.872 |
| Belleği eski ağa ekleme | Bias'sız 96→64: `96×64` | 6.144 |
| **Toplam** | | **101.902** |

Harita dalındaki en uzun parametreli yol altı bloktur: iki uzamsal katman, harita özeti, bir GRU, birleştirme izdüşümü ve eylem çıkışı. Paralel eski dal dahil toplam sekiz ayrı parametreli modül vardır; giriş bunlara dahil değildir. Eski dalda iki gizli Dense katman ve eylem çıkışı korunur. GRU için 32 adımlık eğitim penceresi başlangıç varsayımıdır; 64 ile karşılaştırılır. Pencereyi uzatmak yeni ağırlık katmanı eklemez. Bölüm boyunca geçici bellek taşınabilir; yeni bölümde geçici bellek sıfırlanırken öğrenilmiş ağırlıklar korunur.

Yeni birleştirme matrisi sıfır başlatılır, eski ağırlıklar kopyalanır. Böylece yeni dal ilk anda eski kararları değiştirmez. Sonraki eğitim yine eski becerileri değiştirebilir; geçmiş örnek tekrarı ve eski bölümlerde regresyon ölçümü zorunludur. Yeni ağın eklenmesi, aynı ligde herkes için aynı mimari/model sürümüne geçiş gerektirir.

FP32 ağırlıklar **407.608 bayt ≈398 KiB** tutar. Ağırlık, gradyan ve iki Adam momenti için alt toplam yaklaşık **1,55 MiB**; ara aktivasyonlar, çalışma tamponları, örnekler ve grafikler buna dahil değildir. Yaklaşık **412.160 çarp-topla/karar** hesaplanır; mevcut ağın 14.720 işlemine göre daha pahalıdır. Küçük ağırlık dosyası hızlı eğitim garantisi değildir. Mobil eğitim için küçük dizi grupları, vektörleştirilmiş hesap ve gerçek cihaz ölçümü gerekir; mevcut düz ağ eğiticisine yalnız yeni sayılar yazmak bu mimariyi uygulamaz.

## Ezberi azaltmak için öğrenme ve ölçüm

1. Aynı beceriyi farklı nesne konumu, giriş noktası, engel ve kapı bağlantısıyla göster. Döndürülmüş aynı rota bağımsız bir beceri sayılmaz. Eğitim/doğrulama ayrımı, çeşitlendirmeden önce ana harita kimliğine göre yapılır.
2. Robotun gerçekten ulaştığı hatalı durumlarda oyuncu düzeltmesi topla. Bu dağılım kayması, [DAgger çalışmasının](https://proceedings.mlr.press/v15/ross11a.html) ele aldığı temel sorundur. Oyunda aynı duruma tekrar tekrar dönen robot artık durup bu noktadan düzeltme ister; otomatik doğru hamle eklenmez.
3. Eski ve yeni odalardan örnekleri mekanik ve görev aşamasına göre dengeli tekrar kullan. Son örnekleri tutmak veya ağırlıkları saklamak tek başına unutmayı önlemez. Nadir etkileşim/geri dönüş örneklerini uzun yürüyüşlerin bastırması izlenir. [Kalıcı öğrenmede unutma araştırması](https://arxiv.org/abs/1612.00796).
4. Bütün bölüm çözümünü ölç: yakın başlangıç, yeni engel, yeni kapı–anahtar eşleştirmesi, yeni mekanik birleşimi ve diğer odadan aracı alıp eski hedefe dönme ayrı sonuçlar olsun. Eğitim örneklerine uyum tek başarı puanı değildir.
5. Adayları aynı öğretim örnekleri, birkaç başlangıç seed'i ve eşit eğitim işiyle karşılaştır. Daha büyük ağa daha fazla eğitim verip mimari üstünlüğü ilan etme. Telefon süresi, tepe bellek ve eski becerilerin korunmasını da ölç.

41.934 parametreli haritalı/belleksiz adayın hesabı `14.854 + 25.032 + 32×64` biçimindedir. Bu denetim, iyileşmenin tam haritadan mı GRU'dan mı geldiğini ayırır. Eşdeğer başarıya ulaşırsa daha küçük seçeneği kullanmak uygun olur; GRU'nun yararı varsayılıp ölçülmüş gibi sunulmaz.

Bu mimari mevcut eğiticinin katman boyutlarını değiştirerek kurulamaz: uzamsal geri yayılım, zaman boyunca GRU eğitimi, yeni model sözleşmesi/yükleme sınırları, bellek sıfırlama kuralları, beyin gösterimi ve arena sürümü birlikte uyarlanmalıdır. Bugünkü yükleyici yalnız mevcut MLP ve eski sürümünü kabul eder; analiz adayı oyuna sessizce yüklenmez.

Bugünkü kanıt: iki ilk-oda tarzında %100 eğitim uyumu, dört yakın başlangıçta 4/4 başarı var. Öğretilmemiş ileri mekaniklerdeki 0/3 sonuç, 14.854 parametrenin yetersizliğinin kanıtı değildir; bu mekanikler için öğretim örneği bulunmuyor. [Tekrarlayan ağ araştırması](https://arxiv.org/abs/1507.06527) belleğin kısmi gözlemde yararlı olabileceğini, genel üstünlük garantisi olmadığını gösterir. [Value Iteration Networks](https://arxiv.org/abs/1602.02867) ise yapısal planlama öğreniminin bazı rota görevlerinde aktarımı iyileştirebildiğini gösterir; oyunun bütün kutu/mantık görevlerine otomatik sonuç çıkarılamaz.

Tekrarlanabilir kaynak analizi ve hesap: `node --import tsx scripts/analyze-model.ts`; çıktı `artifacts/model-analysis.json`. Bu betik mimari hesabıdır, eğitim yapmaz. Gerçek masaüstü eğitim ve başarı ölçümleri `GRU_DENEYI.md` ve `artifacts/gru-experiment/` içindedir. Telefon eğitim süresi ölçülmedi.
