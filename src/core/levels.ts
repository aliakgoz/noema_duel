import type { Action, Direction, Level, Position, Surface } from './types';

interface RoomSpec {
  title: string; subtitle: string; chapter: number; difficulty: number; map: string[];
  description: string; par: number; facing?: Direction;
  /** Indexes of controlling switches, in the order encountered in the map. */
  gates?: number[][];
  logic?: ('and' | 'or')[]; inverted?: boolean[]; initialOn?: number[];
  sequenceGroups?: number[][]; surfaces?: Surface[];
}

function room(index: number, spec: RoomSpec): Level {
  const id = `room-${String(index).padStart(2, '0')}`;
  const level: Level = {
    id, title: spec.title, subtitle: spec.subtitle, chapter: spec.chapter, difficulty: spec.difficulty,
    width: spec.map[0].length, height: spec.map.length, tiles: [], start: { x: 1, z: 1 },
    facing: spec.facing ?? 1, crates: [], switches: [], doors: [], goals: [],
    description: spec.description, par: spec.par,
  };
  let starts = 0;
  const numbered = new Map<number, string>();
  for (let z = 0; z < spec.map.length; z++) {
    const row = spec.map[z];
    if (row.length !== level.width) throw new Error(`Nonrectangular room: ${id}, row ${z}`);
    level.tiles.push([...row].map(char => char === '#' ? '#' : '.').join(''));
    for (let x = 0; x < row.length; x++) {
      const char = row[x];
      if (char === 'R') { level.start = { x, z }; starts++; }
      if (char === 'A' || char === 'C') level.crates.push({ id: `${id}-crate-${level.crates.length}`, kind: char === 'A' ? 'amber' : 'cyan', x, z });
      if (char === 'a' || char === 'b' || char === 'c' || char === 'v' || char === 'E') level.goals.push({ kind: char === 'E' ? 'exit' : char === 'a' || char === 'b' ? 'amber' : 'cyan', x, z });
      if (char === 't' || char === 'p' || char === 'b' || char === 'v') level.switches.push({ id: `${id}-switch-${level.switches.length}`, mode: char === 't' ? 'toggle' : 'pressure', on: false, x, z });
      if (/^[1-9]$/.test(char)) {
        const switchId = `${id}-switch-${level.switches.length}`;
        numbered.set(Number(char), switchId);
        level.switches.push({ id: switchId, mode: 'sequence', on: false, x, z });
      }
      if (char === 'I') (level.surfaces ??= []).push({ x, z, kind: 'ice' });
      if ('^>V<'.includes(char)) (level.surfaces ??= []).push({ x, z, kind: 'conveyor', direction: '^>V<'.indexOf(char) as Direction });
      if (char === 'D') level.doors.push({ id: `${id}-door-${level.doors.length}`, open: false, requires: [], x, z });
    }
  }
  if (starts !== 1) throw new Error(`A room must have exactly one start: ${id}`);
  if (spec.surfaces) (level.surfaces ??= []).push(...spec.surfaces.map(surface => ({ ...surface })));
  if (numbered.size) {
    level.sequences = (spec.sequenceGroups ?? [[...numbered.keys()].sort((a, b) => a - b)]).map((numbers, i) => {
      const sequence = { id: `${id}-sequence-${i}`, switchIds: numbers.map(n => {
        const switchId = numbered.get(n); if (!switchId) throw new Error(`Missing sequence number ${n} in ${id}`); return switchId;
      }) };
      for (const switch_ of level.switches) if (sequence.switchIds.includes(switch_.id)) switch_.sequenceId = sequence.id;
      return sequence;
    });
  }
  level.switches.forEach((switch_, i) => { if (spec.initialOn?.includes(i)) switch_.on = true; });
  level.doors.forEach((door, i) => {
    if (spec.logic?.[i]) door.logic = spec.logic[i];
    if (spec.inverted?.[i]) door.inverted = true;
    door.requires = (spec.gates?.[i] ?? level.switches.map((_, n) => n)).map(n => {
      if (!level.switches[n]) throw new Error(`Missing switch ${n} in ${id}`);
      return level.switches[n].id;
    });
  });
  return level;
}

/** A compact hub with two separate store rooms, not a corridor stretched off-screen. */
function storeRooms(placements: [string, number, number][]): string[] {
  const grid: string[][] = Array.from({ length: 9 }, (_, z) => Array.from({ length: 15 }, (_, x) => x === 0 || x === 14 || z === 0 || z === 8 ? '#' : '.'));
  for (let z = 1; z < 8; z++) grid[z][7] = '#';
  for (let x = 8; x < 14; x++) grid[4][x] = '#';
  for (const [symbol, x, z] of placements) grid[z][x] = symbol;
  return grid.map(row => row.join(''));
}

/** Fifty-six authored rooms. Symbols are parsed into floor plus separate entities. */
export const LEVELS: Level[] = [
  room(1, { title: 'İlk Adımlar', subtitle: 'Tek bir doğru yol yok', chapter: 1, difficulty: 1, par: 10,
    description: 'Işıklı çıkışa ulaş. İstersen yukarıdan, istersen sağdan git; robotun senin yolunu izlesin.',
    map: ['#########','#......E#','#.......#','#.......#','#.......#','#R......#','#########'] }),
  room(2, { title: 'İki Yol', subtitle: 'Bir engel, farklı tercihler', chapter: 1, difficulty: 1, par: 10,
    description: 'Ortadaki duvarın iki yanından da geçebilirsin. Kısa bir yol göster, sonra robotunu izle.',
    map: ['#########','#.......#','#...#...#','#R..#..E#','#...#...#','#.......#','#########'] }),
  room(3, { title: 'İlk İz', subtitle: 'İt veya kaldır', chapter: 1, difficulty: 1, par: 7,
    description: 'Kehribar kutuyu aynı renk yuvaya bırak, sonra çıkışa git. Kutuyu itebilir veya önüne dönüp E ile taşıyabilirsin.',
    map: ['#######','#.....#','#RA.aE#','#.....#','#######'] }),
  room(4, { title: 'Elden Ele', subtitle: 'Köşeler bir son değil', chapter: 1, difficulty: 2, par: 18,
    description: 'Duvarın çevresinden bir rota çiz. Kutuyu taşımak, onu itmekten farklı bir çözüm sunar.',
    map: ['#########','#.......#','#.A.#.a.#','#...#...#','#...#...#','#R.....E#','#########'] }),
  room(5, { title: 'İki Renk', subtitle: 'Her kutunun kendi yeri', chapter: 1, difficulty: 2, par: 22,
    description: 'İki renkli yuvayı tamamla. Hangi kutuyla başlayacağını sen seç.',
    map: ['#########','#a.....c#','#.......#','#..A.C..#','#.......#','#R.....E#','#########'] }),
  room(6, { title: 'Bir Dokunuş', subtitle: 'Önüne dön ve E', chapter: 1, difficulty: 2, par: 11,
    description: 'Anahtara doğru bakıp E kullan. Kapı açıkken yolunu tamamla.',
    map: ['#########','#...#...#','#.t.#...#','#R..D..E#','#...#...#','#########'] }),
  room(7, { title: 'Ağırlığın Gücü', subtitle: 'Bir kutu kapıyı tutabilir', chapter: 1, difficulty: 2, par: 17,
    description: 'Zemin düğmesinde bir ağırlık kaldığı sürece kapı açıktır. Kutuyu düğmeye bırakıp çıkışa ilerle.',
    map: ['###########','#....#....#','#....#....#','#R.A.D...E#','#..p.#....#','###########'] }),
  room(8, { title: 'İlk Bağlantı', subtitle: 'Önce hazırla, sonra geç', chapter: 1, difficulty: 3, par: 23,
    description: 'Anahtarı aç, kutuyu yuvaya ulaştır ve çıkışa git. Birden fazla işin sırasını sen belirle.',
    map: ['###########','#....#....#','#.t..#....#','#R.A.D..aE#','#....#....#','#....#....#','###########'] }),
  room(9, { title: 'Köşe Dönüşü', subtitle: 'Taşırken düşün', chapter: 2, difficulty: 3, par: 24,
    description: 'Geçitleri incele. Kutunun izleyeceği yol ile robotun yolu aynı olmak zorunda değil.',
    map: ['#########','#...#..a#','#.A.#...#','#.......#','#.#.###.#','#R.....E#','#########'] }),
  room(10, { title: 'İki İş Birden', subtitle: 'Yuva aynı zamanda bir düğme', chapter: 2, difficulty: 3, par: 21,
    description: 'Kehribar yuva bir basınç düğmesi üzerinde. Doğru kutu hem hedefi hem kapıyı tamamlar.',
    map: ['###########','#....#....#','#....#....#','#R.A.D...E#','#..b.#....#','#....#....#','###########'] }),
  room(11, { title: 'İki Anahtar', subtitle: 'Kapı ikisini de bekliyor', chapter: 2, difficulty: 3, par: 24,
    description: 'Kapının iki bağlantısı var. İki anahtarı da açık bırakarak karşıya geç.',
    map: ['###########','#.t..#....#','#....#....#','#R...D...E#','#....#....#','#..t.#....#','###########'] }),
  room(12, { title: 'Çapraz Rotalar', subtitle: 'Sıra bir tercihtir', chapter: 2, difficulty: 3, par: 30,
    description: 'İki kutunun yolları kesişiyor. Kutuları hangi sırayla yerleştirmek daha rahat?',
    map: ['###########','#a...#...c#','#....#....#','#..C...A..#','#....#....#','#R...#...E#','###########'] }),
  room(13, { title: 'Uzun Geçit', subtitle: 'Bir rota, iki görev', chapter: 2, difficulty: 3, par: 29,
    description: 'Geçidi aç ve iki kutuyu karşıdaki yuvalara götür. Anahtarı açık bırakmayı unutma.',
    map: ['#############','#....#.....a#','#.t..#......#','#R.A.D.C...E#','#....#......#','#....#.....c#','#############'] }),
  room(14, { title: 'Denge', subtitle: 'İki ağırlık, bir geçiş', chapter: 2, difficulty: 4, par: 34,
    description: 'Her renkli yuva kapının bir düğmesi. İki kutu yerini bulduğunda çıkış açılır.',
    map: ['#############','#.....#.....#','#..A..#.....#','#R....D....E#','#..C..#.....#','#.b.v.#.....#','#############'] }),
  room(15, { title: 'Ardışık Kapılar', subtitle: 'Her kapının kendi bağlantısı', chapter: 2, difficulty: 4, par: 28,
    description: 'İlk anahtar ilk kapıyı, ikinci anahtar ikinci kapıyı açıyor. Bağlantıları takip et.', gates: [[0], [1]],
    map: ['#############','#...#...#...#','#.t.#.t.#...#','#R..D...D..E#','#...#...#...#','#############'] }),
  room(16, { title: 'Küçük Atölye', subtitle: 'Üç kutu, kendi düzenin', chapter: 2, difficulty: 4, par: 40,
    description: 'Üç kutuyu renklerine göre yerleştir. Aynı renk kutulardan hangisinin nereye gideceğine sen karar ver.',
    map: ['###########','#a...#...c#','#.........#','#..A.C.A..#','#.........#','#R...#...a#','#........E#','###########'] }),
  room(17, { title: 'Sessiz Bahçe', subtitle: 'Engeller arasından bir imza', chapter: 3, difficulty: 4, par: 34,
    description: 'Adaların arasından iki kutuya rota çiz. Kısa yol ile rahat yol her zaman aynı olmayabilir.',
    map: ['###########','#a.......c#','#..##.##..#','#..A...C..#','#..##.##..#','#R.......E#','###########'] }),
  room(18, { title: 'Birlikte Açılır', subtitle: 'Anahtar ve ağırlık', chapter: 3, difficulty: 4, par: 36,
    description: 'Kapı hem açık bir anahtar hem dolu bir basınç yuvası istiyor. İki koşulu birlikte hazırla.',
    map: ['#############','#.....#....c#','#.t...#.....#','#R.A..D.C..E#','#.....#.....#','#..b..#.....#','#############'] }),
  room(19, { title: 'Devir Teslim', subtitle: 'Önce kapı, sonra son hedef', chapter: 3, difficulty: 4, par: 40,
    description: 'İlk kutu kapıyı açık tutarken diğer kutuyu karşıya geçir. Yuvaların renklerine dikkat et.',
    map: ['#############','#.....#....c#','#.....#.....#','#R.A..D.C..E#','#.....#.....#','#..b..#.....#','#.....#.....#','#############'] }),
  room(20, { title: 'Çifte Bağ', subtitle: 'Düğümleri doğru sırala', chapter: 3, difficulty: 5, par: 43,
    description: 'İlk kapı anahtara, ikinci kapı ağırlığa bağlı. Kutuyu ikinci geçide kadar taşı.', gates: [[0], [1]],
    map: ['###############','#...#....#....#','#.t.#....#....#','#R.AD....D...E#','#...#....#....#','#...#..b.#....#','###############'] }),
  room(21, { title: 'Renk Labirenti', subtitle: 'Hatırla, uyarlayarak çöz', chapter: 3, difficulty: 5, par: 46,
    description: 'Tanıdık parçalar farklı bir düzende. Üç kutunun yollarını birbirini kapatmadan kur.',
    map: ['#############','#a....#....c#','#..#.....#..#','#..A..C..A..#','#..#.....#..#','#R....#....a#','#..........E#','#############'] }),
  room(22, { title: 'Üç Koşul', subtitle: 'İki yuva ve bir anahtar', chapter: 3, difficulty: 5, par: 48,
    description: 'Çıkış kapısı üç bağlantıyı da istiyor. İki renkli yuvayı doldur ve anahtarı açık bırak.',
    map: ['#############','#..t..#.....#','#..A..#.....#','#R....D....E#','#..C..#.....#','#.b.v.#.....#','#.....#.....#','#############'] }),
  room(23, { title: 'Son Atölye', subtitle: 'Rotalarını birleştir', chapter: 3, difficulty: 5, par: 52,
    description: 'Anahtarla geçidi aç, üç kutuyu yerleştir. Birbirine benzeyen kutular farklı rotaları mümkün kılar.',
    map: ['#############','#a...#.....c#','#....#......#','#.t..D......#','#....#......#','#R.A.#C.A..a#','#....#.....E#','#############'] }),
  room(24, { title: 'Senin İmzan', subtitle: 'Aynı kurallar, sana ait bir çözüm', chapter: 3, difficulty: 5, par: 55,
    description: 'İki kapının bağlantılarını incele. Ağırlığı, anahtarı ve renkli yuvaları kendi sıranla birleştir.', gates: [[0], [1, 2]],
    map: ['###############','#.....#...#..c#','#.t...#...#...#','#R.A..D.C.D..E#','#.....#...#...#','#..b..#.t.#...#','#.....#...#...#','###############'] }),
  room(25, { title: 'Kaygan İlk Adım', subtitle: 'Buzda yönün seni taşır', chapter: 4, difficulty: 2, par: 8,
    description: 'Buzun üzerine yürüyünce aynı yönde kuru zemine veya engele kadar kayarsın. Üstten dolaşmak da mümkün; kendi yaklaşımını göster.',
    map: ['###########','#.........#','#RIIIIII.E#','#.........#','###########'] }),
  room(26, { title: 'Durma Noktası', subtitle: 'Kayışın sonunu seç', chapter: 4, difficulty: 3, par: 14,
    description: 'Kuru zeminler yeni bir yön seçebileceğin duraklar. Buz şeridine farklı yanlardan girmeyi dene.',
    map: ['###########','#...I...E.#','#...I.###.#','#R..III...#','#...#.....#','#.........#','###########'] }),
  room(27, { title: 'Kayan Kutu', subtitle: 'İtişin etkisi uzar', chapter: 4, difficulty: 3, par: 15,
    description: 'Buzun üzerine ittiğin kutu da kayar. E ile taşımayı ve iterek göndermeyi karşılaştır; kehribar yuvayı tamamlayıp çık.',
    map: ['###########','#.........#','#R.AII.a.E#','#.........#','###########'] }),
  room(28, { title: 'İki Soğuk Rota', subtitle: 'Aynı zemin, farklı yükler', chapter: 4, difficulty: 4, par: 30,
    description: 'İki rengi kendi yuvasına ulaştır. Buz şeritleri kutu taşırken de robotun rotasını değiştirir.',
    map: ['###########','#a.......c#','#..II.II..#','#..A...C..#','#..II.II..#','#R.......E#','###########'] }),
  room(29, { title: 'Buzlu Eşik', subtitle: 'Önce bağlantı, sonra akış', chapter: 4, difficulty: 4, par: 25,
    description: 'Kapı kapalıyken buzun sonu bir engel. Anahtarı açıp aynı şeride yeniden yaklaş; öğrendiğin yönü koşula göre uyarla.',
    map: ['#############','#.....#....E#','#.t...#..I..#','#R.IIID..I..#','#.....#..I..#','#.....#.....#','#############'] }),
  room(30, { title: 'Soğuk Denge', subtitle: 'Ağırlık yerinde kalmalı', chapter: 4, difficulty: 4, par: 30,
    description: 'Kehribar kutuyu basınç yuvasına bırak. Kapı açık kalırken buzlu geçitten çıkışa kendi yolunu çiz.',
    map: ['#############','#.....#.....#','#..A..#..I..#','#R....D.II.E#','#..I..#.....#','#..b..#.....#','#############'] }),
  room(31, { title: 'Buz Kavşağı', subtitle: 'Giriş yönü çözümü değiştirir', chapter: 4, difficulty: 4, par: 32,
    description: 'Bir buz hattına üstten girmekle yandan girmek aynı sonucu vermez. Kutuyu karşıya geçirirken durakları kullan.',
    map: ['#############','#.....I....a#','#..#..I.#...#','#..A.III....#','#..#..I.#...#','#R.........E#','#############'] }),
  room(32, { title: 'Soğuk Atölye', subtitle: 'Eski becerilerini birleştir', chapter: 4, difficulty: 5, par: 42,
    description: 'Anahtar, iki renk ve kaygan koridorlar bir arada. Kutuları taşımak veya kaydırmak farklı rotalar açar.',
    map: ['#############','#a...#.....c#','#.II.#..II..#','#.t..D......#','#....#..II..#','#R.A.#C.....#','#....#.....E#','#############'] }),
  room(33, { title: 'Akışa İlk Bakış', subtitle: 'Okun yönüne taşınırsın', chapter: 5, difficulty: 2, par: 8,
    description: 'Konveyör, üstündeki robotu ok yönünde taşır. Bir kuru karede durur; istersen bantların çevresinden de dolaş.',
    map: ['###########','#.........#','#R>>>>>>.E#','#.........#','###########'] }),
  room(34, { title: 'Dönen Akış', subtitle: 'Her ok yeni bir yön', chapter: 5, difficulty: 3, par: 18,
    description: 'Bantlar köşelerde yön değiştirebilir. Akışın nereye bıraktığını izle ve sonra bir sonraki hareketi göster.',
    map: ['###########','#.....>..E#','#.....^...#','#R.>>>^...#','#.........#','###########'] }),
  room(35, { title: 'Kutu Postası', subtitle: 'Bantlar yük de taşır', chapter: 5, difficulty: 3, par: 18,
    description: 'Bir kutuyu banda itince o da taşınır. Kutunun bırakıldığı kuru noktayı hesaba katarak yuvasını doldur.',
    map: ['###########','#.........#','#R.A>>>.aE#','#.........#','###########'] }),
  room(36, { title: 'Ters Akış', subtitle: 'En kısa görünen yol her zaman uygun değil', chapter: 5, difficulty: 4, par: 22,
    description: 'Sola akan banda sağa yürümek seni geri getirebilir. Alternatif koridorları kullanarak yaklaşımını değiştir.',
    map: ['#############','#...........#','#..###.###..#','#R..<<<<...E#','#..###.###..#','#...........#','#############'] }),
  room(37, { title: 'Akıştan Kayışa', subtitle: 'İki hareket kuralı buluşuyor', chapter: 5, difficulty: 4, par: 24,
    description: 'Banttan buza geçince yönün korunur; yeni ok ise yönü değiştirir. Akışı izle ve uygun duraklarda karar ver.',
    map: ['#############','#...........#','#.....^II.E.#','#R.>>>^.....#','#..I........#','#...........#','#############'] }),
  room(38, { title: 'Ağırlık Teslimatı', subtitle: 'Kutuyu düğmeye gönder', chapter: 5, difficulty: 4, par: 30,
    description: 'Aşağı akan bant, kutuyu basınç yuvasına bırakabilir. Kutunun üstünde durduğu hedef kapıyı da açık tutar.',
    map: ['#############','#.....#.....#','#...A.#.....#','#R..V.D....E#','#...b.#.....#','#############'] }),
  room(39, { title: 'İki Teslimat', subtitle: 'Akışları doğru renklerle eşleştir', chapter: 5, difficulty: 5, par: 38,
    description: 'İki bant iki yuvaya uzanıyor. İki renk de yerine ulaştığında çıkış kapısı açılır.',
    map: ['###############','#.......#.....#','#..A.C..#.....#','#R.V.V..D....E#','#..b.v..#.....#','#.......#.....#','###############'] }),
  room(40, { title: 'Akış Atölyesi', subtitle: 'Taşı, kaydır, akışa bırak', chapter: 5, difficulty: 5, par: 45,
    description: 'Renkli kutular, buz ve yönlü bantları birlikte kullan. Öğrettiğin yaklaşım yalnız bir hareket dizisi olmak zorunda değil.',
    map: ['#############','#a.........c#','#..II.^II...#','#..A.>^..C..#','#..II.......#','#R.........E#','#############'] }),
  room(41, { title: 'Bir Sıra Var', subtitle: '1, sonra 2, sonra 3', chapter: 6, difficulty: 3, par: 28,
    description: 'Numaralı düğmelere E ile doğru sırada bas. Yanlış bir düğme sırayı sıfırlar; tamamladığında bağlantı açık kalır.',
    map: ['###########','#1...#....#','#....#....#','#R.2.D...E#','#....#....#','#..3.#....#','###########'] }),
  room(42, { title: 'Buzda Hatırla', subtitle: 'Konumdan önce sırayı öğren', chapter: 6, difficulty: 4, par: 35,
    description: 'Düğmelerin yakınlığı sırasını söylemez. Numaraları takip et; buzdaki giriş yönünü de hesaba kat.',
    map: ['#############','#..3..#.....#','#..II.#.....#','#R.2..D....E#','#..II.#.....#','#1....#.....#','#############'] }),
  room(43, { title: 'Ya Bu Ya Öteki', subtitle: 'VEYA kapısı bir bağlantı bekler', chapter: 6, difficulty: 4, par: 22, logic: ['or'],
    description: 'Bu kapıda VEYA bağlantısı var: iki anahtardan biri açık olduğunda geçebilirsin. Hangi yolu seçeceğine sen karar ver.',
    map: ['#############','#.t...#.....#','#.....#.....#','#R....D....E#','#.....#.....#','#...t.#.....#','#############'] }),
  room(44, { title: 'Ters Bağlantı', subtitle: 'Bazen düğme boş kalmalı', chapter: 6, difficulty: 4, par: 30, inverted: [true],
    description: 'Ters bağlı kapı, basınç düğmesi BOŞKEN açık. Kutuyu renkli yuvaya taşırken düğmeyi kapatmadan yol bul.',
    map: ['#############','#.....#....a#','#..A..#.....#','#R.p..D....E#','#.....#.....#','#.....#.....#','#############'] }),
  room(45, { title: 'Sıralı Teslimat', subtitle: 'Bağlantıyı hatırla, yükü taşı', chapter: 6, difficulty: 5, par: 44,
    description: 'Önce numaralı sırayı tamamlayarak kapıyı aç, ardından kutuyu bant üzerinden doğru yuvaya ulaştır.',
    map: ['#############','#1....#....a#','#.....#.....#','#R.A..D.>>.E#','#..2..#.....#','#....3#.....#','#############'] }),
  room(46, { title: 'İki Ayrı Sıra', subtitle: 'Bir bağlantı diğerini beklemez', chapter: 6, difficulty: 5, par: 46, sequenceGroups: [[1, 2], [3, 4]], gates: [[0, 2], [1, 3]],
    description: 'İlk iki düğme ilk kapıya, diğer iki düğme ikinci kapıya bağlı. Her grubun numara sırası kendi içinde ilerler.',
    map: ['###############','#1...#3..#....#','#....#...#....#','#R...D...D...E#','#....#...#....#','#...2#..4#....#','###############'] }),
  room(47, { title: 'Koşullar Bahçesi', subtitle: 'Sıra ve ağırlık birlikte', chapter: 6, difficulty: 5, par: 52,
    description: 'Doğru düğme sırası tek başına yetmez; kehribar kutu basınç yuvasında kalmalı. Robotun koşulları birlikte okumayı öğrensin.',
    map: ['#############','#1....#.....#','#..A..#.....#','#R.2..D....E#','#..I..#.....#','#..b.3#.....#','#############'] }),
  room(48, { title: 'Yeni Bir İmza', subtitle: 'Bütün ilişkiler aynı odada', chapter: 6, difficulty: 5, par: 62, sequenceGroups: [[1, 2, 3]], gates: [[0, 1, 2], [3]], logic: ['and', 'or'],
    description: 'İlk kapıyı bir sırayla aç. İkinci kapının anahtarını bul, iki renkli yuvayı tamamla; buz ve bantların etkisini kendi çözümüne kat.',
    map: ['##################','#1....#....#....c#','#..A..#....#.....#','#R.2..D.>^.D.C..E#','#..I..#.I..#.....#','#....3#..t.#....a#','#.....#....#.....#','##################'] }),
  room(49, { title: 'Yan Odadaki Kutu', subtitle: 'Kapıyı aç, kutuyu getir, eve dön', chapter: 7, difficulty: 3, par: 30,
    description: 'Kehribar yuva ve çıkış başlangıç odanda; gereken kutu sağdaki kilitli depoda. Önce bu odadaki anahtarı aç, depoya geçip kutuyu al, sonra onu ilk odanın yuvasına bırak ve çıkışa git.',
    map: ['#############','#.t...#.....#','#..a..#.....#','#R....D..A..#','#.....#.....#','#E....#.....#','#############'] }),
  room(50, { title: 'İki Depo, Bir Atölye', subtitle: 'Her kapı bir sonraki aracı açar', chapter: 7, difficulty: 4, par: 58, gates: [[0], [1]],
    description: 'İlk odandaki iki renkli yuvayı doldurmalısın. Buradaki anahtar orta deponun kapısını, orta depodaki anahtar en sağdaki kapıyı açar. Kehribar kutu orta odada, camgöbeği kutu son odada; ikisini de ilk odaya geri getir.',
    map: ['##################','#.t...#.t..#.....#','#..a..#....#.....#','#R....D.A..D..C..#','#.....#....#.....#','#...c.#....#.....#','#E....#....#.....#','##################'] }),
  room(51, { title: 'Önce Geçidi Sabitle', subtitle: 'Bir kutunun işi henüz bitmedi', chapter: 7, difficulty: 5, par: 54,
    description: 'Depodaki kehribar kutu ilk odanın yuvasına dönmeli. Depo kapısı hem açık anahtar hem dolu basınç düğmesi ister. İlk odadaki camgöbeği kutuyu önce düğmede ağırlık olarak kullan; kehribar kutuyu geri getirdikten sonra onu kendi renkli yuvasına taşı.',
    map: ['#############','#t.a..#.....#','#..C..#.....#','#R....D..A..#','#..p..#.....#','#E..c.#.....#','#############'] }),
  room(52, { title: 'Depoyu Açmak İçin Kapat', subtitle: 'Ters bağlantı, geri dönüşlü rota', chapter: 7, difficulty: 4, par: 32, inverted: [true], initialOn: [0],
    description: 'Başlangıç odandaki anahtar AÇIK olduğu için ters bağlı depo kapısı kapalı. Anahtarı E ile kapat, sağ depodan kehribar kutuyu alıp ilk odadaki yuvaya getir. Dönüş yolunu açık bırakıp başlangıç odasının çıkışını tamamla.',
    map: ['#############','#.t...#.....#','#..a..#.....#','#R....D..A..#','#.....#.....#','#E....#.....#','#############'] }),
  room(53, { title: 'Odalar Arasında Bir Sıra', subtitle: 'Bağlantı bir yolculuğu hatırlar', chapter: 7, difficulty: 5, par: 58, gates: [[0], [1, 2, 3]],
    description: 'İlk anahtar orta odayı açar. Son deponun kapısı için 1 numaralı düğmeye ilk odada, 2 ve 3 numaralı düğmelere orta odada sırayla bas. Son depodaki kehribar kutuyu bütün geçitlerden geri taşıyarak ilk odanın yuvasına bırak.',
    map: ['##################','#.t.1.#.2..#.....#','#..a..#....#.....#','#R....D....D..A..#','#.....#....#.....#','#.....#.3..#.....#','#E....#....#.....#','##################'] }),
  room(54, { title: 'İki Kanatlı Depo', subtitle: 'İki araç odası, ortak dönüş noktası', chapter: 7, difficulty: 4, par: 58, logic: ['or', 'or'],
    description: 'Atölyenin sağında üst ve alt olmak üzere iki ayrı depo var; renkli yuvalar soldaki ilk odada. Soldaki iki anahtardan birini açman iki kapıya da yeter. Üst depodan kehribar, alt depodan camgöbeği kutuyu alıp kendi yuvalarına geri getir.',
    map: storeRooms([['t', 2, 1], ['t', 4, 7], ['D', 7, 2], ['D', 7, 6], ['R', 1, 4], ['A', 11, 1], ['C', 11, 7], ['a', 2, 3], ['c', 5, 5], ['E', 1, 7]]) }),
  room(55, { title: 'Depodaki Anahtar Bir Kutu', subtitle: 'Üst odadan al, alt odayı aç', chapter: 7, difficulty: 5, par: 68, gates: [[0], [1]],
    description: 'Önce soldaki anahtarla üst depoyu aç ve oradaki camgöbeği kutuyu ilk odanın basınç düğmesine getir. Bu ağırlık alt depoyu açar. Alttaki kehribar kutuyu ilk odasına geri taşıdıktan sonra camgöbeği kutuyu düğmeden alıp renkli yuvasına bırak; çıkış da ilk odada.',
    map: storeRooms([['t', 2, 1], ['p', 4, 6], ['D', 7, 2], ['D', 7, 6], ['R', 1, 4], ['C', 11, 2], ['A', 11, 6], ['a', 2, 3], ['c', 5, 7], ['E', 1, 7]]) }),
  room(56, { title: 'Geri Dönüş Planı', subtitle: 'Sırayı kur, aracı kullan, hepsini geri getir', chapter: 7, difficulty: 5, par: 76, gates: [[0, 1], [2]],
    description: 'İki renkli yuva ve çıkış ilk odada. Burada 1 ve 2 düğmelerini sırayla açıp orta odaya geç. Oradaki camgöbeği kutuyu aynı odanın basınç düğmesine bırak; son depo açılır. Son depodaki kehribar kutuyu ilk odaya geri getir. En son camgöbeği kutuyu da geri alıp ilk odadaki yuvasını tamamla.',
    map: ['##################','#1....#....#.....#','#..a..#.C..#.....#','#R....D....D..A..#','#.....#....#.....#','#..c2.#.p..#.....#','#E....#....#.....#','##################'] }),
];

export function getLevel(id: string): Level | undefined { return LEVELS.find(level => level.id === id); }

export function transformAction(action: Action, rotations = 0, reflected = false): Action {
  if (action >= 4) return action;
  const turns = ((rotations % 4) + 4) % 4;
  return ((reflected ? (4 - action) % 4 : action) + turns) % 4 as Action;
}

/** A complete geometric transform; IDs, logical connections and sequence order stay intact. */
export function transformLevel(base: Level, rotations = 0, reflected = false): Level {
  const turns = ((rotations % 4) + 4) % 4;
  const width = turns % 2 ? base.height : base.width;
  const height = turns % 2 ? base.width : base.height;
  const transform = (position: Position): Position => {
    let x = reflected ? base.width - 1 - position.x : position.x;
    let z = position.z; let w = base.width; let h = base.height;
    for (let turn = 0; turn < turns; turn++) { [x, z] = [h - 1 - z, x]; [w, h] = [h, w]; }
    return { x, z };
  };
  const tiles = Array.from({ length: height }, () => Array.from({ length: width }, () => '#'));
  base.tiles.forEach((row, z) => [...row].forEach((tile, x) => { const p = transform({ x, z }); tiles[p.z][p.x] = tile; }));
  return {
    ...base, width, height, tiles: tiles.map(row => row.join('')), start: transform(base.start),
    facing: transformAction(base.facing, turns, reflected) as Direction,
    crates: base.crates.map(crate => ({ ...crate, ...transform(crate) })),
    switches: base.switches.map(switch_ => ({ ...switch_, ...transform(switch_) })),
    doors: base.doors.map(door => ({ ...door, requires: [...door.requires], ...transform(door) })),
    goals: base.goals.map(goal => ({ ...goal, ...transform(goal) })),
    surfaces: base.surfaces?.map(surface => ({ ...surface, ...transform(surface), ...(surface.direction !== undefined ? { direction: transformAction(surface.direction, turns, reflected) as Direction } : {}) })),
    sequences: base.sequences?.map(sequence => ({ ...sequence, switchIds: [...sequence.switchIds] })),
    variantChanges: base.variantChanges ? [...base.variantChanges] : undefined,
  };
}

/** A dihedral isometry preserves every legal move, interaction and solution. */
export function generateChallenge(seed: number): Level {
  if (!Number.isSafeInteger(seed)) throw new RangeError('A challenge seed must be a safe integer');
  let randomState = seed >>> 0;
  const random = () => {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let value = randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
  const base = LEVELS[random() % LEVELS.length];
  const rotations = random() % 4;
  const reflected = (random() & 1) === 1;
  return {
    ...transformLevel(base, rotations, reflected), id: `challenge-${seed}`, title: 'Ayna Odası', subtitle: base.title,
    seed, sourceLevelId: base.id,
    description: 'Tanıdık kurallar döndürülmüş bir odada. Gösterdiğin yaklaşımı yeni yönlere uyarlayabilir misin?',
    surprise: 'Döndürülmüş ve yansıtılmış düzen; bütün nesneler ve bağlantılar birlikte taşındı.',
  };
}

/** Replayable validation certificates; never used by neural action selection. */
export const LEVEL_SOLUTIONS: Record<string, readonly Action[]> = {"room-01":[0,0,0,0,1,1,1,1,1,1],"room-02":[0,0,1,1,1,1,1,1,2,2],"room-03":[1,1,0,1,1,2],"room-04":[0,1,0,4,1,2,2,1,1,0,1,0,4,1,2,2],"room-05":[0,0,1,4,3,0,4,1,0,1,1,1,2,4,0,1,4,2,1,2,2,2],"room-06":[1,2,0,4,1,1,1,1,1],"room-07":[0,1,1,2,1,1,1,1,1,1],"room-08":[1,2,0,4,1,1,1,1,1,0,1,1,2],"room-09":[0,0,0,1,4,1,2,1,1,0,0,1,4,2,1,2,2,2],"room-10":[0,1,1,2,1,1,1,1,1,1],"room-11":[1,0,4,1,2,2,4,0,1,1,1,1,1,1],"room-12":[0,1,1,1,0,1,1,4,3,3,0,0,3,3,4,1,2,2,4,1,1,1,0,0,1,1,4,2,1,2,2,2],"room-13":[1,2,0,4,1,1,1,4,1,0,0,1,1,1,1,4,2,2,3,3,4,1,1,1,2,4,0],"room-14":[0,1,4,2,2,4,1,0,1,2,0,1,1,1,1,1,1,1],"room-15":[1,2,0,4,1,1,1,1,2,0,4,1,1,1,1,1],"room-16":[0,0,1,4,3,0,4,1,1,1,1,2,4,0,1,0,1,1,4,2,1,2,3,4,1,2,4,3,2,2,1],"room-17":[0,0,1,4,3,0,4,1,2,1,1,1,1,1,1,2,1,0,0,2,2,2],"room-18":[1,2,0,4,0,1,2,2,0,1,1,1,1,1,1,1,2,1,0,0,2],"room-19":[0,1,1,2,2,0,1,1,1,1,1,1,1,2,1,0,0,2],"room-20":[1,2,0,4,1,1,1,1,0,1,2,2,0,1,1,1,1,1,1],"room-21":[0,0,1,4,3,0,4,1,2,1,1,1,1,1,4,0,0,1,1,1,4,2,1,2,3,4,1,2,4,3,2,2,1],"room-22":[0,0,1,4,1,2,4,2,3,2,4,1,0,1,2,0,1,1,1,1,1,1,1],"room-23":[1,0,4,0,1,2,4,0,0,0,3,4,1,1,2,2,1,1,2,4,0,0,0,1,1,1,1,4,2,2,2,2,3,4,1,4,2,1],"room-24":[1,2,0,4,0,1,2,2,0,1,1,1,1,1,2,4,0,1,1,1,1,2,1,0,0,2],"room-25":[1,1],"room-26":[0,0,1,1,1,1,1,1],"room-27":[1,1,1,1,0,1,1,1,2],"room-28":[0,0,1,4,3,0,4,1,1,1,2,3,4,0,1,4,2,1,2,2,2],"room-29":[1,2,0,4,1,1,0,1,1,0,1],"room-30":[0,0,1,1,2,2,1,1,1,1,1,1],"room-31":[0,0,1,1,4,1,1,1,0,0,1,4,2,1,2,2,2],"room-32":[1,0,4,0,1,2,4,0,0,3,4,1,2,1,1,1,2,4,1,1,0,1,0,4,2,2,2,2],"room-33":[1,1],"room-34":[1,1,1,1],"room-35":[1,1,1,1,0,1,1,2],"room-36":[0,0,1,1,1,1,1,1,1,1,1,1,2,2],"room-37":[1,1,1,1,1,1,2],"room-38":[0,0,1,1,1,2,1,2,1,1,1,1,1,1],"room-39":[0,0,1,1,2,0,1,1,2,1,1,2,1,1,1,1,1,1],"room-40":[0,0,1,4,3,0,4,1,1,1,1,1,1,2,4,0,1,4,2,1,2,2,2],"room-41":[0,4,2,1,4,1,2,4,0,1,1,1,1,1,1],"room-42":[2,4,0,1,4,0,0,3,1,4,2,1,2,1,1,1,1,1,1],"room-43":[1,0,4,1,1,2,2,4,0,1,1,1,1,1,1,1],"room-44":[0,1,1,1,4,1,2,1,1,0,0,1,1,1,4,2,1,2],"room-45":[0,4,2,2,1,4,1,2,1,4,0,0,1,3,4,1,1,1,1,1,0,4,2],"room-46":[0,4,1,1,1,2,2,4,0,1,1,0,4,1,1,2,2,4,0,1,1,1,1,1],"room-47":[0,4,2,1,4,1,2,1,4,0,0,0,0,3,2,2,1,1,1,1,1,1,1,1],"room-48":[0,4,2,1,4,1,2,1,4,0,0,1,1,1,2,2,1,4,0,1,2,1,1,1,1,1,2,1,0,0,2,3,3,3,3,3,3,2,3,3,0,3,3,0,3,4,1,2,1,1,1,1,2,1,1,1,1,1,1,2,4,0],"room-49":[1,0,4,1,1,1,2,1,1,1,4,3,3,3,0,3,4,2,2,2,3,3,3],"room-50":[1,0,4,1,1,1,2,1,1,0,0,1,1,1,3,4,2,2,3,3,3,3,3,2,3,0,1,1,1,1,1,1,1,1,1,1,4,3,3,3,3,3,3,3,3,3,2,4,3,2,2,3,3],"room-51":[0,4,0,1,1,2,2,1,1,1,1,1,4,3,3,3,0,0,3,4,2,2,3,2,3,2,1,3,3],"room-52":[1,0,4,1,1,1,2,1,1,1,4,3,3,3,0,3,4,2,2,2,3,3,3],"room-53":[1,0,4,0,1,4,1,1,2,2,1,1,1,0,4,2,2,4,0,1,1,1,1,1,4,3,3,3,3,3,3,3,3,0,3,4,2,2,2,2,3,3,3],"room-54":[0,1,0,4,1,1,2,2,2,2,4,0,0,0,0,1,1,1,1,0,1,1,4,2,3,3,3,3,2,3,3,3,4,1,1,1,2,2,2,1,1,1,2,1,4,0,3,3,3,3,2,3,0,4,2,3,3,3,3],"room-55":[0,1,0,4,1,1,1,1,1,1,1,1,4,3,3,3,3,2,2,2,2,3,4,1,1,1,1,1,4,3,3,3,3,0,0,0,3,3,3,4,1,2,2,2,3,2,1,3,3,3],"room-56":[0,4,1,1,1,2,2,4,0,1,1,1,0,0,1,2,2,2,0,1,1,1,1,1,4,3,3,3,3,3,3,3,3,0,3,4,1,2,1,1,1,2,4,0,3,3,3,2,2,3,4,2,3,3,3]};
