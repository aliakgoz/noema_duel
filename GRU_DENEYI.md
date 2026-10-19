# NOEMA: gerçek GRU karşılaştırması

17 Ekim 2026. Bu deney çalışan oyuncu modelini, kayıtları veya arena sözleşmesini değiştirmez. Önceki mimari analizinden farklı olarak modeller gerçekten eğitilir, ağırlıkları dışa aktarılır ve gerçek oyun motorunda kendi kararlarıyla oynatılır.

Sürüm 1.2 notu: bu deneyden sonra 77.926 parametreli GRU mimarisi gerçek oyuna uygulandı. Paket eğitimsiz modelle başlar; bu rapordaki eğitilmiş ağırlıklar dağıtılmaz. Aşağıdaki "varsayılan model değişmedi" ifadesi deneyin yapıldığı önceki sürümün durumudur. Güncel ürün doğrulaması `QA_GRU_1_2.md` içindedir.

## Sonuçlar

Beş mimarinin her biri iki tohumla eğitildi; toplam **10 gerçek model ve 2.210 kendi başına oynama denemesi** tamamlandı. Aşağıdaki sayılar, aynı koşulların iki başlangıç tohumu üzerindeki toplamıdır. Son sütun yedi farklı odanın iki modelle sınanmasıdır; 14 bağımsız yeni oda anlamına gelmez.

| Model | Eğitim koşulları | Yeni başlangıç | Tek duvar değişikliği | Eğitimde olmayan oda |
|---|---:|---:|---:|---:|
| Mevcut MLP, 14.854 parametre | 230/240 | 75/96 (%78,1) | 82/92 (%89,1) | 2/14 |
| GRU, 77.926 parametre | 240/240 | 82/96 (%85,4) | 90/92 (%97,8) | 5/14 |
| Harita + MLP, 41.934 parametre | 228/240 | 76/96 (%79,2) | 83/92 (%90,2) | 2/14 |
| Harita + GRU, 101.902 parametre | 240/240 | 77/96 (%80,2) | 90/92 (%97,8) | 0/14 |
| Benzer kapasitede MLP, 77.526 parametre | 239/240 | 76/96 (%79,2) | 89/92 (%96,7) | 5/14 |

**GRU bu deneyde yakın aktarımı iyileştirdi, ezberi ortadan kaldırmadı.** GRU'nun iki tohumu yeni odalarda sırasıyla 2/7 ve 3/7 çözdü; benzer kapasitedeki belleksiz ağ da aynı sonuçları aldı. Yeni başlangıçlarda GRU 42/48 ve 40/48; kapasite kontrolü 35/48 ve 41/48 elde etti. Bu küçük seçili testte bellekli model lehine yakın aktarım bulgusu var; bütün başarının yalnız bellekten geldiği söylenemez.

Önceki analizde önerilen 101.902 parametreli harita+GRU adayının eğitim koşullarındaki başarısı %100 iken ayrı odalarda 0/14 oldu. Bu adayın mevcut eğitimiyle genelleme üstünlüğü gösterilemedi; parametre hesabı, başarılı model seçimi anlamına gelmedi. Tam harita bilgisi gözlemdeki bilgi kaybını azaltır fakat ağı planlama yapmaya veya yeni topolojiyi doğru kullanmaya zorlamaz.

Bağlantılı odalar için daha belirgin sınır: her mimari 49–56 ailesindeki eğitim koşullarını iki tohumda da 30/30 çözdü. Eğitimden tamamen çıkarılan 52 ve 55. odaları ise hiçbir mimari, hiçbir tohumda tamamlamadı. Buradan, yeni bir "önce yan odadan aracı getir, sonra eski hedefe dön" görevini genel olarak öğrendiği sonucu çıkmaz.

Bu ölçümlere göre sonraki teknik öncelik, robotun kendi hatalarından toparlanma gösterimleri, farklı nesne/kapı bağlantılarıyla daha çeşitli öğretim ve yeni görev birleşimlerini ayrı ölçmektir. GRU, bu eğitimle birlikte sınanacak adaydır. Oyundaki varsayılan model bu deneyle değiştirilmedi; kayıt ve arena hâlâ mevcut MLP sözleşmesini kullanır.

Ham sonuçlar `artifacts/gru-experiment/closed-loop-results.json`, kapasite kontrolü `capacity-control/closed-loop-results.json`, doğrulanmış birleşik tablo `summary.json` ve `summary.md` içindedir. Deneyin sayısal eşitlik kontrolü hem kısa dizilerde hem 58/58/55 adımlık üç tam bağlı oda dizisinde geçti; uzun kontrolde en büyük logit farkı **3,34×10⁻⁶**, kabul sınırı **10⁻⁴** idi.

## Deney düzeni

Dört mimari, aynı 120 öğretim oynanışı ve tur başına 3.306 hareketle eğitilir. Her biri 80 tur, 640 Adam güncellemesi, 264.480 geçerli zaman adımı görür. Başlangıç tohumları 42 ve 123; bölüm grubu 16, öğrenme oranı 0,003, gradyan norm sınırı 5. Her tohumda bölüm sırası bütün modeller için aynıdır. Bütçe test sonuçları görülmeden belirlenmiştir; testte en iyi görünen ara ağırlık seçilmez.

| Mimari | Parametre |
|---|---:|
| Mevcut ağın yapısı: 160→64→64→6 | 14.854 |
| 160→96→GRU96→64→6 | 77.926 |
| Mevcut ağ + tam harita dalı | 41.934 |
| Mevcut ağ + tam harita + GRU96 | 101.902 |

Parametre sayısının etkisini kısmen kontrol etmek için ek bir kontrol de çalıştırılır: **160→192→192→48→6**, 77.526 parametre. Bu, 77.926 parametreli GRU'dan yaklaşık %0,5 küçüktür. Kontrol, ilk dört mimariye sonradan eklenen bir denemedir; aynı veri, 80 tur, iki tohum ve bölüm sırası kullanır. Mimari farklı olduğundan ortak eski ağırlıkları kopyalayamaz. Tek CPU iş parçacığında ana deneyle eşzamanlı çalıştığından eğitim süreleri bir hız sıralaması olarak karşılaştırılmaz.

Bellekli modeller tam bölüm boyunca geri yayılımla eğitilir. Geçici bellek bölüm başında sıfırlanır, bölüm içinde taşınır. Kısa örnekler sonlarından doldurulur; dolgu kayba katılmaz. Harita kodlayıcısı 16×20×20 görünür fiziksel durumdan iki küçük evrişim katmanı ve 32 değerli özet üretir. Güncel katalog için en fazla 20×20 hücre, dört düğme, iki sıra grubu ve grup başına dört düğme desteklenir; aşılırsa sessizce bilgi kırpmak yerine hata verir. Gelecek durum, çözüm yolu veya doğru hareket girdiye verilmez.

MLP, haritalı model ve harita+GRU modeli oyunun aynı tohumlu gerçek başlangıç ağırlıklarını paylaşır; yeni dal sıfır izdüşümle başladığından ilk kararlar aynı kalır. GRU-only modelinin boyutları farklıdır; uyumlu eylem çıkışı ortak başlatılır. Bunlar oyuncunun eğitilmiş kaydından değil, yeni modellerden başlayan deneylerdir.

## Veri ayrımı ve ölçüm

221 oynanışın 6.136 hareketi gerçek motorla tekrar oynatılarak doğrulanır. 24 temel odanın 120 oynanışı eğitimdir. Testler 48 yeni başlangıç, 46 tek duvar değişikliği ve eğitimde bulunmayan yedi temel odadan oluşur. Son gruptaki odalar 3, 12, 31, 38, 46, 52 ve 55'tir. Bağlantılı oda görevleri de deneyde bulunur.

Yakın başlangıç ve duvar testleri aynı temel görevi paylaşır; bağımsız yeni bulmaca başarısı sayılmaz. Duvar değişikliği mevcut yolun dışında kalabilir. Ayrı temel odalar daha güçlü bir aktarım sınamasıdır; yedi seçili oda, bütün olası bulmacaları temsil etmez. Bütün fiziksel düzenler benzersizdir ve test tohumları eğitimden ayrıdır.

Öğretim hareketleri bu izole deney için yazılmış çözüm sertifikalarından gelir. Canlı oyundaki oyuncu modeli bu sertifikaları almaz. Dolayısıyla bu deney insanın birkaç gösterimle öğretebilme deneyimini ölçmez.

Asıl sonuç, her modelin gerçek motoru kendi argmax kararlarıyla en fazla 220 girişte tamamlamasıdır. Değerlendirmede eğitim, çözüm araması veya doğru hamle düzeltmesi yoktur. Aynı fiziksel duruma dönüş GRU'yu durdurmaz; belleği farklı olabilir. Öğretim sırasında verilen gerçek durumdan bir sonraki hareketi tahmin etme başarısı ayrıca raporlanır; bu, kendi başına bölüm tamamlama oranı değildir.

## Uygulamanın doğrulanması

PyTorch CPU'nun gerçek otomatik türevi ve GRU geri yayılımı kullanılır. Son kaybın önceki bir ipucuna gradyan taşıdığı kontrol edilir. Son gözlemi aynı olan iki durumda daha önceki ipucunu hatırlama denemesi, bellekli modelde %100 terminal doğruluk elde etti; belleksiz terminal politikasının bu dengeli iki örnekte üst sınırı %50'dir. Bu küçük kontrol yalnız bellek uygulamasını doğrular; bulmaca başarısı kanıtı değildir.

Python'dan çıkan ağırlıklar JavaScript'te yeniden çalıştırılır. Katman boyutları, parametre sayısı ve sayısal logit eşitliği doğrulanmadan bölüm sonuçları üretilmez. GRU kapıları [PyTorch GRU tanımıyla](https://docs.pytorch.org/docs/2.14/generated/torch.nn.GRU.html) aynı sırada ve çift bias ile hesaplanır. Rastgelelik, CPU iş parçacıkları ve deney tohumları [tekrarlanabilirlik ayarlarıyla](https://docs.pytorch.org/docs/2.14/notes/randomness.html) sabitlenir; farklı donanımda bit düzeyinde eşitlik iddiası yapılmaz.

## Sınırlar ve tekrar çalıştırma

Eşit örnek ve güncelleme sayısı eşit işlem miktarı değildir. Modellerin parametre sayısı farklı olduğu için farkın yalnız bellekten kaynaklandığı söylenemez. Bütün karşılaştırmalı modeller aynı PyTorch Adam eğiticisini kullanır; oyunun JavaScript eğiticisiyle telefon hız karşılaştırması yapılmaz. Gerçek telefon ısınması, bellek ve eğitim süresi ölçülmemiştir. İki başlangıç tohumu geniş istatistiksel kanıt değildir.

Tekrar çalıştırma: `powershell -ExecutionPolicy Bypass -File scripts/run-gru-experiment.ps1`. Betik bu çalışma alanındaki taşınabilir Python ve Node kurulumlarını kullanır. PyTorch CPU bağımlılığı `scripts/requirements-gru-experiment.txt` içinde sabitlenmiştir. Kaynaklar: `scripts/export-gru-experiment.ts`, `scripts/train-gru-experiment.py`, `scripts/train-capacity-control.py`, `scripts/evaluate-gru-experiment.ts`, `scripts/export-gru-long-parity.py`, `scripts/summarize-gru-experiment.ts`. Ham veri, ağırlıklar, eğitim ve oyun raporları `artifacts/gru-experiment/` altındadır. Rapor yalnız sabit 80 tur ve 42/123 tohumlu koşulları birleştirir; farklı bütçeler için ham raporlar ayrıca incelenir.
