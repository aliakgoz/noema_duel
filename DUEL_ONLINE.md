# Noema Duel: online arena

Atölye çevrimdışı çalışır. **Online Arena** eğittiğin modeli ortak sunucuda sınar; **Sıralama** o sunucunun gerçek günlük sonuçlarını gösterir. Bu sürümün online müsabakası, her oyuncunun aynı sunucu rakipleriyle oynadığı günlük bir değerlendirmedir.

Sunucu `npm run server` ile 8787 portunda çalışır. Geliştirme sırasında Vite `/api` isteklerini bu sunucuya iletir. `npm start`, üretim paketini ve API'yi aynı sunucudan sunar. Web geliştirme sürümü HTTP veya HTTPS kullanabilir. **Mobil APK'da Arena bağlantısı bölümüne geçerli sertifikalı, erişilebilir bir HTTPS sunucu adresi girilir.** Mobil uygulama HTTP adresini açık bir hata ile reddeder; Android'in varsayılan ağ korumaları korunur. Telefonun `localhost` adresi bilgisayardaki sunucu değildir. Bu çalışma, herkese açık bir sunucu yayımlamaz.

Model yalnızca kullanıcı **Modelimi arenaya gönder** düğmesine bastığında gönderilir. Eğitim örnekleri gönderilmez. Sunucu geçerli GRU ağırlıklarını doğrular; her günlük ortak tohum için classic, ricochet ve open arenalarında, dengeli/savunmacı/hücum rakiplerine karşı üç düello oynatır. Her düello en fazla 120 simülasyon saniyesidir. Model mobil uygulamadaki gibi 10 Hz karar verir, fizik 120 Hz çalışır. Rakibinin canını bitiren kazanır; süre dolduğunda maç berabere sayılır.

Puan = galibiyet × 10.000 + beraberlik × 3.000 + verilen hasar + kalan can. Aynı oyuncunun UTC günündeki en iyi sonucu korunur. İstemcinin gönderdiği puanlar kullanılmaz. Duel sıralamaları `serverdata/duel.json` içinde, eski Noema bulmaca sıralamasından ayrı saklanır. Misafir oturumları mevcut tuzlu token doğrulamasını kullanır; model değerlendirmesi sınırlandırılmış kuyruk ve 30 saniye süre sınırı olan ayrı Node Worker içinde yürütülür.

API:

- `GET /api/duel/health`
- `GET /api/duel/leaderboard`
- `POST /api/session` (`{name}`)
- `POST /api/duel/submit` (`{name, model}`, Bearer oturum anahtarı)

Doğrulama: `server/duel.test.ts` gerçek GRU çalışmasını, istemci puanlarının yok sayılmasını, kimlik/model kontrollerini, kalıcı sıralamayı, eski Noema sıralamasıyla ayrılığı, günlük ortak tohumları ve Worker zaman aşımını test eder. `server/arena.test.ts` eski servisin uyumluluğunu kontrol eder. `e2e/duel-online.mjs` tarayıcıda gerçek gösterim ve eğitimden başlayıp model gönderimi ve mobil sıralamaya kadar olan akışı doğrular.
