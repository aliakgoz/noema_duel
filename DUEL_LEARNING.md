# Noema Duel'de robot nasıl öğreniyor?

Robot, sen oynarken gösterdiğin davranışları taklit ederek öğrenir. **Maçı kazanma, hasar verme veya hasardan kaçınma için otomatik ödül ve ceza uygulanmaz.** Öğrenme, **Robotuna öğret** düğmesine bastığında gerçekleşir; robotu izlediğin düello sırasında model ağırlıkları değişmez.

## Hareket ve düğmeler

Model **160 → 96 → GRU96 → 64 → 6** yapısında ve **77.926 parametrelidir**. Kendi durumunu, rakibi, yaklaşan taşları, kutuları, duvarları ve yerel engel haritasını görür. Önceki durumları GRU belleğinde tutar. [Gözlem girdileri](src/duel/learning.ts#L53)

Joystick kararı dört yön veya radyal dilimler arasından seçilmez. Model, analog joystick gibi **sürekli X ve Z değerleri** üretir. Bu iki değer birlikte yönü ve hızı belirler. Her eksende mutlak değeri 0,12'den küçük çıktılar sıfırlanır; vektörün uzunluğu 1'i aşarsa normalize edilir. Nişan açısı ayrı bir çıktıdır. Ateş ve **Al / bırak** sinyalleri 0,5 ve üzerindeyse etkin kabul edilir. Güç her zaman %100'dür; dosya uyumluluğu için tutulan eski güç çıkışı oyunu etkilemez. Karar yaklaşık saniyede 10 kez yenilenir. [Modelden komuta dönüşüm](src/duel/learning.ts#L136)

Birden fazla komut aynı anda etkin olabilir: robot hareket ederken nişan alıp ateş isteyebilir. Beyin görselleştirmesinin ortak veri yapısındaki `action` alanı, en büyük mutlak çıktının indeksini taşır; **robotun tek bir düğmeyi seçme politikası değildir**. Oyunu altı çıktının birlikte komuta çevrilmesi yönetir. [Görselleştirme verisi](src/duel/learning.ts#L124)

Komut ile gerçekleşen hareket farklı olabilir. Robot duvara doğru gitmek isteyebilir ama çarpışma hareketini durdurur veya duvar boyunca kaydırır. Ateş isteği de bekleme süresi dolmamışsa ya da robot siper taşıyorsa mermi çıkarmaz. [Hareket ve atış koşulları](src/duel/engine.ts#L300)

## Loss nasıl hesaplanıyor?

Sen oynarken, örnek kaydı açıksa oyun durumuyla birlikte seçtiğin komutlar yaklaşık **0,1 saniyede bir** kaydedilir. Kısa ateş ve siper etkileşimleri ayrıca yakalanır. En yeni 8.000 örnek tutulur; eğitim için en az 16 örnek gerekir. Beklemek, yanlış yöne gitmek veya ıskalamak da gösterimin bir parçasıdır; örnekler maç sonucuna göre ayıklanmaz.

Her örnekte model çıktısı, o durumda senin verdiğin komutla karşılaştırılır:

```text
L = 1,6 × [(hareketX − hedefX)² + (hareketZ − hedefZ)²]
  + 1,2 × [1 − cos(nişanAçısı − hedefAçı)]
  + 0,6 × sınıfAğırlığı × BCE(ateşÇıktısı, ateşHedefi)
  + 0,6 × sınıfAğırlığı × BCE(siperÇıktısı, siperHedefi)
```

Hareket terimi iki eksendeki karesel hatadır. Açılar radyandır; dairesel nişan kaybı, örneğin +179° ile −179°'yi birbirine yakın kabul eder. Ateş ve siper için ikili çapraz entropi kullanılır: `BCE(p, y) = −y × ln(p) − (1−y) × ln(1−p)`. Logaritmaya giren değer en az `0,0000001` alınır.

Ateş ve siper için 0 ve 1 sınıfları ayrı dengelenir. İki sınıf da varsa ağırlık `min(12, toplamÖrnek / (2 × ilgiliSınıftakiÖrnek))`, yalnızca tek sınıf varsa 1'dir. Böylece nadir basışlar, çok sayıdaki basılmamış örnek arasında kaybolmaz. Eski güç çıkışı kayba katılmaz. [Kayıp ve sınıf ağırlıkları](src/duel/learning.ts#L167)

Ekrandaki **loss**, o eğitim turunda hesaplanan örnek kayıplarının ortalamasıdır. Ağırlıklar tur içinde güncellendiğinden bu sayı ayrı bir test kümesinde ölçülen sonuç değildir. Gösterimler kendi zaman sıralarını korur; GRU, **32 adımlık BPTT pencereleriyle** ve pencereler arasında belleği taşıyarak eğitilir. [Eğitim ve ortalama kayıp](src/duel/learning.ts#L234)

## İyi ve kötü harekete nasıl karar veriliyor?

Mevcut eğitimde “doğru hedef”, senin gösterdiğin komuttur. Model o komuta yaklaştıkça loss azalır. Hareketin sonradan hasar aldırması, rakibe vurması veya maçı kazandırması bu hedefi değiştirmez. Maç sonucu, eğitim kaybına ödül veya ceza olarak eklenmez. [Maç sonucu](src/duel/engine.ts#L423)

**Düşük loss, gösterdiğin davranışa iyi uyum demektir; yüksek kazanma oranı demek değildir.** Kötü veya birbiriyle çelişen gösterimler de öğrenilebilir. Robotun oyun başarısı, eğittikten sonra farklı durumlarda oynatılıp gözlenerek değerlendirilir.
