import { useSyncExternalStore } from 'react';
import { sb } from './supabase';
import type { LeagueContent, MustRead, QuizQuestion, CapstoneQuestion } from './types';

export type TaskKind = 'week' | 'league' | 'unit' | 'capstone';
export type TaskStatus = 'running' | 'done' | 'error';

export type BackgroundTask = {
  id: string;
  kind: TaskKind;
  label: string;
  status: TaskStatus;
  message: string;
};

// Module-scope state. This module is imported once and its state lives for
// the lifetime of the page (i.e. the whole SPA session). React Router's
// HashRouter only swaps which components are mounted under <Routes> — it
// never reloads the page or re-evaluates this module, so `tasks` below
// keeps whatever it held before a navigation, and any async work already
// referencing it (via upsertTask closures) keeps updating the exact same
// object after the component that started it has unmounted. That's what
// lets generation survive a route change: the fetch/Anthropic/Supabase
// chain lives in a plain async function with no dependency on any
// component's lifecycle, and it reports progress into this shared store
// rather than into local useState.
let tasks: BackgroundTask[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return tasks;
}

export function upsertTask(task: BackgroundTask) {
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx === -1) {
    tasks = [...tasks, task];
  } else {
    tasks = tasks.map((t, i) => (i === idx ? task : t));
  }
  notify();
}

export function removeTask(id: string) {
  tasks = tasks.filter((t) => t.id !== id);
  notify();
}

export function useBackgroundTasks(): BackgroundTask[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const MODEL = 'claude-sonnet-5';

async function fetchReadable(url: string) {
  const readerUrl = 'https://r.jina.ai/' + url;
  const res = await fetch(readerUrl);
  if (!res.ok) throw new Error('reader-failed:' + url);
  const text = await res.text();
  return text.slice(0, 6000);
}

export type WeekGenerationParams = {
  urls: string[];
  apiKey: string;
  weekLabel: string;
  nextWeekNumber: number;
  isBossWeek: boolean;
};

const BOSS_EVERY = 5;

export async function runWeekGeneration(params: WeekGenerationParams): Promise<void> {
  const { urls, apiKey, weekLabel, nextWeekNumber, isBossWeek } = params;
  const id = genId();
  const label = weekLabel.trim() || `Hafta ${nextWeekNumber}`;

  upsertTask({ id, kind: 'week', label, status: 'running', message: 'Başlatılıyor…' });

  let combined = '';
  for (let i = 0; i < urls.length; i++) {
    upsertTask({ id, kind: 'week', label, status: 'running', message: `${i + 1}/${urls.length} okunuyor: ${urls[i]}` });
    try {
      const text = await fetchReadable(urls[i]);
      combined += `\n\n--- Kaynak ${i}: ${urls[i]} ---\n${text}`;
    } catch (e) {
      combined += `\n\n--- Kaynak ${i}: ${urls[i]} (içerik okunamadı, sadece link olarak dahil et) ---`;
    }
  }

  upsertTask({ id, kind: 'week', label, status: 'running', message: 'Quiz ve özet hazırlanıyor…' });
  try {
    const prompt = `Aşağıda bu haftaki AI/kurumsal dönüşüm kaynaklarının ham metni var (makale, blog, podcast/video sayfası), her biri "--- Kaynak N: url ---" başlığıyla ayrılmış. Bunları işleyip SADECE aşağıdaki şemaya uyan geçerli JSON döndür, başka açıklama, markdown işareti ekleme:

{
  "week_theme": "haftanın öne çıkan temasını özetleyen tek kısa cümle",
  "must_reads": [ { "title": "başlık", "url": "kaynağın orijinal linki", "summary": "4-6 cümlelik, doğrudan bilgi aktaran ders notu" } ],
  "quiz": [ { "source_index": 0, "type": "mc", "bonus": false, "question": "soru metni", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama" } ],
  "number_challenge": { "source_index": 0, "question": "kaynakta geçen bir sayıyı soran soru metni", "correct_value": 42, "tolerance": 5, "explanation": "kısa açıklama" },
  "risk_question": { "question": "orta-zor bir soru", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama" }${isBossWeek ? ',\n  "boss_question": { "question": "birden fazla kaynaktaki bilgiyi birleştirmeyi gerektiren zor bir sentez sorusu", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama" }' : ''}
}

Kurallar:
- Her kaynak için bir must_reads öğesi oluştur (sırasıyla index 0,1,2,...).
- "summary" alanı bir "makale tanıtımı" DEĞİL, doğrudan bilgi aktaran bir ders notu olmalı — kaynağı okumadan da o bilgiye sahip olacak şekilde yaz. "Bu makale ... anlatıyor", "Yazar ... belirtiyor", "Bu yazı ... ele alıyor" gibi meta-anlatım KULLANMA; doğrudan olguyu, kavramı, sonucu ver — sanki okuyucuya konuyu sen öğretiyormuşsun gibi yaz. ODAK NOKTASI SAYILAR/İSTATİSTİKLER DEĞİL, ANLAM olmalı: neden oldu, ne anlama geliyor, sonucu/etkisi ne olacak — bunları öne çıkar. Kaynakta geçen bir rakam gerçekten haberin özüyse elbette geçebilir, ama özeti bir rakam listesine indirgeme; asıl mesaj her zaman "bu gelişme neden önemli ve ne anlama geliyor" olsun. JSON'UN KIRILMAMASI İÇİN: metnin içinde düz tırnak işareti (") KULLANMA — bir terimi vurgulamak istersen tırnaksız yaz ya da tek tırnak (') kullan.
- Sorular ve özetler gereksiz sektör içi jargon kullanmadan, konuya yeni başlayan sıradan birinin de anlayabileceği şekilde yazılsın — ama bilgiyi basitleştirirken yanlış veya belirsiz hale getirme, doğruluktan ödün verme.
- Her kaynak için quiz'de "source_index" o kaynağın must_reads içindeki index'ine eşit olan tam olarak 4 soru olsun:
  - 2 tanesi "type": "mc", "bonus": false — cevabı summary'den çıkarılabilecek, genel anlama soruları, farklı yönlere odaklansın, 3 seçenekli.
  - 1 tanesi "type": "tf", "bonus": true — Doğru/Yanlış formatında bir ifade, SADECE kaynağın tam metnindeki spesifik bir detaya dayanmalı, summary'den cevaplanamamalı; "options" tam olarak ["Doğru","Yanlış"] olmalı, "correct_index" 0 (Doğru) veya 1 (Yanlış).
  - 1 tanesi "type": "mc", "bonus": true — yine kaynağın tam metnindeki bir detaya dayanmalı, summary'den cevaplanamamalı, 3 seçenekli.
- SORU KALİTESİ — ÇOK ÖNEMLİ, kesinlikle uy: Bu bir bilgi yarışması/trivia sınavı DEĞİL, okuyucunun konuyu gerçekten ANLAYIP ANLAMADIĞINI ölçen bir sınav. Şunları KESİNLİKLE YAPMA:
  - "X ne kadardı/kaçtı?", "Y'nin rakamı neydi?" gibi salt bir sayıyı/istatistiği ezberden sorma soruları YASAK — sayı sorusu SADECE "number_challenge" alanında olur, quiz'de asla tekrar sorulmaz.
  - Birbiriyle ilgisiz 2-3 olguyu yan yana koyup "aşağıdakilerden hangisi doğrudur?" diye sorma — bu şans/ezber sorusu üretir, anlama ölçmez.
  - Bir ismi, tarihi veya terimi salt hatırlamayı test eden soru yazma.
  Bunun yerine şu kalıplarda sorular kur: "Bu gelişme neden önemli/riskli?", "Bu iki bilgi arasındaki ilişki/çelişki nedir?", "Bu durumun en olası sonucu/etkisi nedir?", "Kaynağa göre bu neden böyle oldu/olacak?", "Bu bilgi [ilgili kavram] açısından ne ifade ediyor?" — yani NEDEN, SONUÇ, ÖNEM veya İLİŞKİ soran sorular yaz. Yanlış şıklar rastgele değil, konuyu yüzeysel/yanlış anlayan birinin makul şekilde seçebileceği çeldiriciler olsun. Doğru şıkkın konumu ("correct_index") sorular arasında dengeli dağılsın (hep aynı konumda olmasın) ve şıklar birbirine yakın uzunlukta yazılsın — doğru şık sırf daha uzun/detaylı olduğu için belli olmasın.
- "number_challenge": haftada sadece 1 tane, kaynaklardan birinde geçen somut bir sayıyı/istatistiği sorsun (rakam sorusu SADECE burada olur), makul bir "tolerance" belirle.
- "risk_question": kaynaklardan herhangi birine dayanan, yukarıdaki SORU KALİTESİ kuralına uyan (neden/sonuç/ilişki soran, ezber değil), normal sorulardan biraz daha zor, 3 seçenekli tek bir soru.
${isBossWeek ? '- "boss_question": bu bir BOSS HAFTASI, birden fazla kaynaktaki bilgiyi birlikte kullanmayı ve aralarındaki ilişkiyi/sonucu kavramayı gerektiren, yukarıdaki SORU KALİTESİ kuralına uyan en zor soruyu üret.' : ''}

Ham içerik:
${combined}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 64000, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'api-error');
    if (data.stop_reason === 'max_tokens') throw new Error('Yanıt çok uzun olduğu için kesildi, daha az link ile tekrar dene');
    const textBlock = (data.content || []).find((b: any) => b.type === 'text');
    if (!textBlock) throw new Error('Model boş yanıt döndürdü (stop_reason: ' + (data.stop_reason || 'bilinmiyor') + ')');
    let cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
    const parsed = JSON.parse(cleaned);

    const { error: insertError } = await sb.from('weeks').insert({
      week_number: nextWeekNumber,
      week_theme: parsed.week_theme,
      week_label: weekLabel.trim() || null,
      must_reads: parsed.must_reads,
      quiz: parsed.quiz,
      number_challenge: parsed.number_challenge || null,
      matching: parsed.matching || null,
      risk_question: parsed.risk_question || null,
      boss_question: parsed.boss_question || null,
      is_boss: isBossWeek,
      status: 'draft',
    });
    if (insertError) throw new Error('Veritabanına yazılamadı: ' + insertError.message);

    upsertTask({
      id,
      kind: 'week',
      label,
      status: 'done',
      message: `Hafta ${nextWeekNumber} taslak olarak oluşturuldu${isBossWeek ? ' (BOSS HAFTASI)' : ''}. "Taslaklar" bölümünden inceleyip yayınlayabilirsin.`,
    });
  } catch (e: any) {
    upsertTask({ id, kind: 'week', label, status: 'error', message: 'Hafta işlenirken bir sorun oldu: ' + e.message });
  }
}

// Shared prompt fragments — reused verbatim by both the full-guide generation
// (runLeagueGeneration) and the single-unit regeneration (runUnitRegeneration)
// so wording never drifts between the two entry points.
const SUMMARY_QUALITY_RULE = `"summary" alanı bir "makale tanıtımı" DEĞİL, doğrudan bilgi aktaran bir ders notu olmalı — kaynağı okumadan da o bilgiye sahip olacak şekilde yaz. "Bu makale ... anlatıyor", "Yazar ... belirtiyor" gibi meta-anlatım KULLANMA; doğrudan olguyu, kavramı, sonucu ver. ODAK NOKTASI SAYILAR/İSTATİSTİKLER DEĞİL, ANLAM olmalı: bu kavram neden önemli, ne işe yarar, nasıl kullanılır — bunları öne çıkar. Bir rakam gerçekten konunun özüyse geçebilir, ama özeti bir rakam listesine indirgeme. JSON'UN KIRILMAMASI İÇİN: metnin içinde düz tırnak işareti (") KULLANMA — bir terimi vurgulamak istersen tırnaksız yaz ya da tek tırnak (') kullan.`;

// Ünite başına 10 soru: 6'sı özetten/genel anlamadan çıkarılabilecek, 4'ü (2+2)
// iki kaynağın tam metnindeki detaylara dayanan daha zor sorular. Gerçek bir
// üretim denemesinde doğrulandı: bu oranla hem özetten çıkan genel anlama hem
// tam metne dayalı derinlik dengeleniyor.
const PER_UNIT_QUIZ_RULE = `Tam olarak 10 soru üret, her biri TAM OLARAK 4 şıklı olsun:
  - 6 tanesi "type": "mc", "bonus": false — cevabı summary'den çıkarılabilecek, genel anlama soruları, farklı yönlere odaklansın.
  - 2 tanesi "type": "mc", "bonus": true — Kaynak A'nın tam metnindeki spesifik bir detaya dayanmalı, summary'den cevaplanamamalı.
  - 2 tanesi "type": "mc", "bonus": true — Kaynak B'nin tam metnindeki spesifik bir detaya dayanmalı, summary'den cevaplanamamalı. (Tek kaynaklı bir ünite ise bu 4 soru da o tek kaynağın tam metninden gelsin.)`;

// Gerçek bir üretim denemesinde gözlemlendi: model doğru şıkkı hep aynı
// konuma koyuyor veya doğru şıkkı diğerlerinden daha uzun/detaylı yazıyordu —
// bu, kullanıcının içeriği hiç okumadan kalıba bakarak doğru cevabı tahmin
// etmesine yol açıyordu. İlk versiyonu ("yakın uzunlukta yaz" gibi yumuşak bir
// öneri) yetersiz kaldı — canlıda hâlâ "doğru şık 3-4 satır + somut tarih,
// diğer üçü tek cümlelik saçma/eleyici iddialar" kalıbı üretti (örn. "hesaplama
// gücü azaldıkça YZ gelişmiştir" gibi mantıksal olarak imkansız bir çeldirici).
// Bu yüzden somut/ölçülebilir bir uzunluk kısıtı ve "çeldiriciyi zenginleştir"
// talimatına çevrildi.
const ANTI_BIAS_RULE = `ŞIK DAĞILIMI, UZUNLUK VE İNANDIRICILIK — ÇOK ÖNEMLİ, kesinlikle uy: Bir sorudaki "correct_index" değerinin hep aynı konumda olması, doğru şıkkın diğerlerinden uzun/detaylı yazılması ya da yanlış şıkların mantıksal olarak imkansız/saçma olması, kullanıcının içeriği hiç okumadan veya konuyu hiç bilmeden salt kalıba bakarak doğru cevabı bulmasına yol açar. Bunu önlemek için:
  (1) Bir üniteye/sınava ait sorular arasında "correct_index" değerleri (0,1,2,3) dengeli dağılsın, art arda aynı index'i 3'ten fazla tekrarlama.
  (2) UZUNLUK KURALI (sert kısıt): en kısa şık, en uzun şıkkın karakter sayısının en az %70'i kadar olsun. Bunu şöyle sağla: önce doğru şıkkı yaz, sonra HER yanlış şıkkı da doğru şıkla AYNI seviyede somut detay/gerekçe/sayı içerecek şekilde zenginleştir (gerekirse inandırıcı ama yanlış bir tarih/mekanizma/sayı uydur) — kısa, tek cümlelik, "belli ki yanlış" bir çeldirici YAZMA.
  (3) İNANDIRICILIK KURALI: yanlış şıklar mantıksal olarak imkansız veya gerçekle açıkça çelişen iddialar OLMASIN (örn. "X azaldıkça Y gelişti" gibi). Bunun yerine konuyu yüzeysel/yanlış anlayan, kısmen haklı ama sonucu yanlış çıkaran birinin gerçekten seçebileceği makul yanlış çıkarımlar olsun.
  (4) Şıkların sırası konu akışına veya alfabetik sıraya göre olmasın.`;

const QUIZ_QUALITY_RULE = `SORU KALİTESİ — ÇOK ÖNEMLİ, kesinlikle uy (quiz VE capstone için geçerli): Bu bir bilgi yarışması/trivia sınavı DEĞİL, okuyucunun konuyu gerçekten ANLAYIP ANLAMADIĞINI ölçen bir sınav. Şunları KESİNLİKLE YAPMA:
  - Bir sayıyı/istatistiği/ismi/tarihi ezberden sorma (örn. "X ne kadardı?", "Y kaç kişiydi?") — bu bir kalıcı rehber, güncel bir sayıya dayanmak zaten yanlış olur.
  - Birbiriyle ilgisiz 2-3 olguyu yan yana koyup "aşağıdakilerden hangisi doğrudur?" diye sorma — bu şans/ezber sorusu üretir, anlama ölçmez.
  Bunun yerine şu kalıplarda sorular kur: "Bu neden önemli?", "Bu iki kavram arasındaki ilişki/fark nedir?", "Bu, [ilgili kavram] açısından ne ifade eder?", "Bu bilgiye göre en olası sonuç/uygulama nedir?" — yani NEDEN, SONUÇ, ÖNEM veya İLİŞKİ soran, o seviyeye özgü kavramsal anlayışı test eden sorular. Yanlış şıklar rastgele değil, konuyu yüzeysel anlayan birinin makul şekilde seçebileceği çeldiriciler olsun.
  ${ANTI_BIAS_RULE}`;

// Shared Anthropic call + robust JSON extraction, used by the single-unit
// regeneration flow below (kept separate from the two full-generation
// functions above so their existing, already-tested inline logic stays
// untouched).
async function callClaudeJSON(prompt: string, apiKey: string, maxTokens: number): Promise<any> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'api-error');
  if (data.stop_reason === 'max_tokens') throw new Error('Yanıt çok uzun olduğu için kesildi');
  const textBlock = (data.content || []).find((b: any) => b.type === 'text');
  if (!textBlock) throw new Error('Model boş yanıt döndürdü (stop_reason: ' + (data.stop_reason || 'bilinmiyor') + ')');
  let cleaned = textBlock.text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(cleaned);
}

// Ünite üretiminin tek gerçek kaynağı: 1-2 kaynak URL'sinden bir must_read +
// 10 quiz sorusu üretir. Hem taze rehber üretiminde (runLeagueGeneration,
// ünite ünite) hem tek ünite yenilemede (runUnitRegeneration) kullanılıyor —
// prompt burada bir kere yazılır, ikisi de aynı kalitede üretim yapar.
async function generateUnit(urlA: string, urlB: string | undefined, apiKey: string): Promise<{ mustRead: MustRead; quiz: Omit<QuizQuestion, 'source_index'>[] }> {
  let sourceText: string;
  try {
    sourceText = await fetchReadable(urlA);
  } catch (e) {
    throw new Error('Kaynak okunamadı: ' + urlA);
  }
  let combined = `--- Kaynak A: ${urlA} ---\n${sourceText}`;
  if (urlB) {
    try {
      const sourceText2 = await fetchReadable(urlB);
      combined += `\n\n--- Kaynak B: ${urlB} ---\n${sourceText2}`;
    } catch (e) {
      throw new Error('İkinci kaynak okunamadı: ' + urlB);
    }
  }

  const unitPrompt = `Aşağıda bir lig rehberindeki TEK BİR ünitenin kaynağının/kaynaklarının ham metni var. Bunu işleyip SADECE aşağıdaki şemaya uyan geçerli JSON döndür, başka açıklama, markdown işareti ekleme:

{
  "title": "başlık",
  "url": "Kaynak A linki",
  "url2": "Kaynak B linki (varsa; yoksa bu alanı hiç ekleme)",
  "summary": "6-10 cümlelik, doğrudan bilgi aktaran, kaynak(lar)ı birleştiren ders notu",
  "quiz": [ { "type": "mc", "bonus": false, "question": "soru metni", "options": ["seçenek1","seçenek2","seçenek3","seçenek4"], "correct_index": 0, "explanation": "kısa açıklama" } ]
}

Kurallar:
- ${SUMMARY_QUALITY_RULE}
- "quiz" alanında ${PER_UNIT_QUIZ_RULE}
- ${QUIZ_QUALITY_RULE}

Ham içerik:
${combined}`;

  const unitParsed = await callClaudeJSON(unitPrompt, apiKey, 16000);
  const mustRead: MustRead = {
    title: unitParsed.title,
    url: unitParsed.url || urlA,
    ...(unitParsed.url2 || urlB ? { url2: unitParsed.url2 || urlB } : {}),
    summary: unitParsed.summary,
  };
  const quiz = (unitParsed.quiz || []).map((q: any) => ({
    type: q.type,
    bonus: q.bonus,
    question: q.question,
    options: q.options,
    correct_index: q.correct_index,
    explanation: q.explanation,
  }));
  return { mustRead, quiz };
}

// Bitirme sınavı üretiminin tek gerçek kaynağı: verilen ünite özetlerinden
// tam olarak `count` soruluk bir sentez sınavı üretir. Taze rehber
// üretiminde (tüm üniteler bitince), tek ünite yenilemede (silinen capstone
// sorularını doldururken) ve tek başına "Bitirme Sınavını Üret" aksiyonunda
// kullanılıyor — üçü de aynı kalite kurallarına tabi olsun diye tek yerde.
async function generateCapstone(mustReads: MustRead[], count: number, apiKey: string): Promise<CapstoneQuestion[]> {
  const mustReadsList = mustReads.map((m, i) => `Ünite ${i}: ${m.title}\n${m.summary}`).join('\n\n');
  const capstonePrompt = `Aşağıda bir lig rehberindeki tüm ünitelerin özetleri var. Bu rehberi kapatan bitirme sınavı için tam olarak ${count} soru üret:

${mustReadsList}

Kurallar:
- Ünite sayısı 2 veya daha fazlaysa, HER soru en az İKİ FARKLI üniteden bilgiyi birbirine bağlamayı gerektirmeli — tek bir ünitenin özetinden cevaplanamamalı. Örnek kalıplar: "Ünite A'daki X kavramı ile Ünite B'deki Y arasındaki ilişki nedir?", "Bu iki bilgi birlikte değerlendirildiğinde en olası sonuç nedir?", "A ve B'deki yaklaşımlar birleştirilirse ortaya çıkan çıkarım nedir?".
- Ünite sayısı 1 gibi çok azsa (gerçek bir "birden fazla üniteyi birleştirme" sorusu kurulamıyorsa) yine de tam ${count} soru üret, ama bu durumda sorular mevcut ünite(ler)deki EN DERİN/EN ÖNEMLİ kavramları test etsin.
- Bu, rehberin final sınavı olduğu için EN ZOR sorular bunlar olmalı — normal ünite sorularından bile daha zor.
- Her soru için, o soruyu cevaplamak amacıyla kullandığın ünitelerin (must_reads) index'lerini "source_indices" dizisinde belirt (örn. iki üniteyi birleştiren bir soru için [0, 2]).
- ${QUIZ_QUALITY_RULE}

SADECE aşağıdaki şemaya uyan geçerli JSON döndür, başka açıklama, markdown işareti ekleme:
{ "capstone": [ { "question": "soru metni", "options": ["seçenek1","seçenek2","seçenek3","seçenek4"], "correct_index": 0, "explanation": "kısa açıklama", "source_indices": [0, 1] } ] }`;

  const capstoneParsed = await callClaudeJSON(capstonePrompt, apiKey, Math.min(48000, Math.max(12000, count * 3500)));
  return (capstoneParsed.capstone || []).map((q: any) => ({
    question: q.question,
    options: q.options,
    correct_index: q.correct_index,
    explanation: q.explanation,
    source_indices: q.source_indices || [],
  }));
}

export type LeagueGenerationParams = {
  // Sadece BU çağrıda üretilecek (yeni) ünitelerin linkleri — resumeContent
  // varsa, önceden üretilmiş ünitelerin linkleri tekrar gönderilmez.
  urls: string[];
  apiKey: string;
  tierIndex: number;
  leagueName: string;
  // Zaten kısmen üretilmiş bir taslağa devam ediliyorsa ("Kalan Üniteleri
  // Ekle") önceki üniteler burada gelir, yeni üretilenler sonuna eklenir.
  // Sıfırdan üretimde undefined/null.
  resumeContent?: LeagueContent | null;
};

export async function runLeagueGeneration(params: LeagueGenerationParams): Promise<void> {
  const { urls, apiKey, tierIndex, leagueName, resumeContent } = params;
  const id = genId();
  const label = leagueName;

  upsertTask({ id, kind: 'league', label, status: 'running', message: 'Başlatılıyor…' });

  // Her ünite ardışık İKİ linkten oluşur (A, B, A, B, …) — tek sayıda link
  // verilirse son ünite tek kaynaklı kalır.
  const newUnitCount = Math.ceil(urls.length / 2);
  const startIndex = resumeContent?.must_reads.length ?? 0;
  const totalUnitCount = startIndex + newUnitCount;
  const accMustReads: MustRead[] = resumeContent ? [...resumeContent.must_reads] : [];
  const accQuiz: QuizQuestion[] = resumeContent ? [...resumeContent.quiz] : [];

  // Üniteler teker teker üretilir ve HER biri bitince hemen taslağa
  // kaydedilir — tek bir dev çağrıda 8 üniteye kadar 10'ar soru aynı anda
  // isteniyordu ve gerçek kullanımda max_tokens'ı aşıp yanıtın kesilmesine,
  // dolayısıyla o ana kadar başarıyla üretilmiş üniteler dahil TÜM emeğin
  // boşa gitmesine yol açtı. Bu şekilde bir ünite başarısız olursa önceki
  // üniteler taslakta kalır ve admin sadece eksik kalanları ("Kalan
  // Üniteleri Ekle") tamamlayabilir.
  for (let u = 0; u < newUnitCount; u++) {
    const unitNumber = startIndex + u;
    const urlA = urls[u * 2];
    const urlB = urls[u * 2 + 1];
    upsertTask({ id, kind: 'league', label, status: 'running', message: `Ünite ${unitNumber + 1}/${totalUnitCount} okunuyor/üretiliyor: ${urlA}` });
    try {
      const { mustRead, quiz } = await generateUnit(urlA, urlB, apiKey);
      accMustReads.push(mustRead);
      for (const q of quiz) accQuiz.push({ ...q, source_index: unitNumber });

      const { error: unitUpdateError } = await sb.from('leagues').update({
        draft_content: { must_reads: accMustReads, quiz: accQuiz, capstone: null },
      }).eq('tier_index', tierIndex);
      if (unitUpdateError) throw new Error('Veritabanına yazılamadı: ' + unitUpdateError.message);

      upsertTask({ id, kind: 'league', label, status: 'running', message: `Ünite ${unitNumber + 1}/${totalUnitCount} kaydedildi.` });
    } catch (unitError: any) {
      upsertTask({
        id,
        kind: 'league',
        label,
        status: 'error',
        message: `${unitNumber}/${totalUnitCount} ünite taslağa kaydedildi, "${urlA}" işlenirken hata oldu: ${unitError.message}. Bu ünitenin (ve varsa sonrakilerin) linklerini "Kalan Üniteleri Ekle" ile tekrar gir.`,
      });
      return;
    }
  }

  upsertTask({ id, kind: 'league', label, status: 'running', message: 'Bitirme sınavı hazırlanıyor…' });
  try {
    const capstone = await generateCapstone(accMustReads, 10, apiKey);
    const { error: capstoneUpdateError } = await sb.from('leagues').update({
      draft_content: { must_reads: accMustReads, quiz: accQuiz, capstone },
    }).eq('tier_index', tierIndex);
    if (capstoneUpdateError) throw new Error('Bitirme sınavı veritabanına yazılamadı: ' + capstoneUpdateError.message);

    upsertTask({
      id,
      kind: 'league',
      label,
      status: 'done',
      message: `${leagueName} rehberi (${totalUnitCount} ünite + bitirme sınavı) taslak olarak kaydedildi. Aşağıdan inceleyip yayınlayabilirsin.`,
    });
  } catch (capstoneError: any) {
    upsertTask({
      id,
      kind: 'league',
      label,
      status: 'done',
      message: `${leagueName} rehberinin ${totalUnitCount} ünitesi taslak olarak kaydedildi, ama bitirme sınavı üretilemedi (${capstoneError.message}). "Bitirme Sınavını Üret" ile tekrar deneyebilirsin.`,
    });
  }
}

export type CapstoneGenerationParams = {
  apiKey: string;
  tierIndex: number;
  leagueName: string;
  mustReads: MustRead[];
  quiz: QuizQuestion[];
};

// Sadece bitirme sınavını (yeniden) üretir — üniteler zaten taslakta/yayında
// olduğunda, tüm rehberi tekrar üretmeye gerek kalmadan sadece bu son parçayı
// tazelemek için. Her zaman draft_content'e yazar — yayınlanmış içerik varsa
// bile doğrudan content'e değil, önce taslağa düşer (incelenip yayınlanana kadar).
export async function runCapstoneGeneration(params: CapstoneGenerationParams): Promise<void> {
  const { apiKey, tierIndex, leagueName, mustReads, quiz } = params;
  const id = genId();
  const label = `${leagueName} · Bitirme Sınavı`;

  upsertTask({ id, kind: 'capstone', label, status: 'running', message: 'Bitirme sınavı hazırlanıyor…' });
  try {
    const capstone = await generateCapstone(mustReads, 10, apiKey);
    const { error } = await sb.from('leagues').update({
      draft_content: { must_reads: mustReads, quiz, capstone },
    }).eq('tier_index', tierIndex);
    if (error) throw new Error('Veritabanına yazılamadı: ' + error.message);

    upsertTask({ id, kind: 'capstone', label, status: 'done', message: `${leagueName} bitirme sınavı taslak olarak kaydedildi. Aşağıdan inceleyip yayınlayabilirsin.` });
  } catch (e: any) {
    upsertTask({ id, kind: 'capstone', label, status: 'error', message: 'Bitirme sınavı üretilirken bir sorun oldu: ' + e.message });
  }
}

export type UnitRegenerationParams = {
  url: string;
  url2?: string;
  apiKey: string;
  tierIndex: number;
  leagueName: string;
  sourceIndex: number;
  unitTitle: string;
  currentContent: LeagueContent;
};

// Surgical alternative to runLeagueGeneration: regenerates exactly ONE unit
// (one source_index) of an already-existing league guide from one new link,
// instead of regenerating the whole tier. Two AI calls:
//   1) always — produce the replacement must_read + its 4 quiz questions for
//      just this unit, reusing the exact per-unit summary/quiz/quality rules
//      already used by full-guide generation.
//   2) only when needed — if any EXISTING capstone question referenced the
//      replaced unit, those are dropped and exactly that many new capstone
//      questions are generated from the FULL updated must_reads (including
//      the just-replaced unit's new summary), so the capstone stays
//      consistent with the guide without regenerating the whole exam. If no
//      capstone question referenced this unit, call 2 is skipped entirely —
//      no point spending a request generating zero questions.
// These are logically distinct concerns (replacing a unit vs. patching the
// capstone that cites it), so keeping them as two separate, conditionally-run
// calls is simpler to reason about and cheaper than always paying for a
// combined mega-call.
export async function runUnitRegeneration(params: UnitRegenerationParams): Promise<void> {
  const { url, url2, apiKey, tierIndex, leagueName, sourceIndex, unitTitle, currentContent } = params;
  const id = genId();
  const label = `${leagueName} · Ünite ${sourceIndex + 1}: ${unitTitle}`;

  upsertTask({ id, kind: 'unit', label, status: 'running', message: 'Başlatılıyor…' });

  try {
    upsertTask({ id, kind: 'unit', label, status: 'running', message: `Kaynak(lar) okunuyor: ${url}` });
    const { mustRead: newMustRead, quiz: newUnitQuizBase } = await generateUnit(url, url2, apiKey);
    const newUnitQuiz: QuizQuestion[] = newUnitQuizBase.map((q) => ({ ...q, source_index: sourceIndex }));

    // Merge must_reads: only the target index's entry changes, order/rest untouched.
    const newMustReads = currentContent.must_reads.map((m, i) => (i === sourceIndex ? newMustRead : m));

    // Merge quiz: drop the old questions for this source_index and splice the
    // 10 new ones in at the same spot, leaving every other unit's questions
    // untouched and in their original order.
    const newQuiz: QuizQuestion[] = [];
    let insertedUnitQuiz = false;
    for (const q of currentContent.quiz) {
      if (q.source_index === sourceIndex) {
        if (!insertedUnitQuiz) {
          newQuiz.push(...newUnitQuiz);
          insertedUnitQuiz = true;
        }
        // skip remaining old questions for this source_index
      } else {
        newQuiz.push(q);
      }
    }
    if (!insertedUnitQuiz) newQuiz.push(...newUnitQuiz); // defensive: unit had no prior quiz questions

    // Determine which existing capstone questions referenced the replaced
    // unit — those get dropped and backfilled; everything else survives as-is.
    const oldCapstone = currentContent.capstone || [];
    const keptCapstone = oldCapstone.filter((q) => !q.source_indices.includes(sourceIndex));
    const removedCount = oldCapstone.length - keptCapstone.length;

    let backfillCapstone: CapstoneQuestion[] = [];
    if (removedCount > 0) {
      upsertTask({ id, kind: 'unit', label, status: 'running', message: 'Bitirme sınavı güncelleniyor…' });
      backfillCapstone = await generateCapstone(newMustReads, removedCount, apiKey);
    }

    const newCapstone: CapstoneQuestion[] = [...keptCapstone, ...backfillCapstone];

    const mergedContent: LeagueContent = {
      must_reads: newMustReads,
      quiz: newQuiz,
      capstone: newCapstone.length > 0 ? newCapstone : null,
    };

    const { error: updateError } = await sb.from('leagues').update({ draft_content: mergedContent }).eq('tier_index', tierIndex);
    if (updateError) throw new Error('Veritabanına yazılamadı: ' + updateError.message);

    upsertTask({
      id,
      kind: 'unit',
      label,
      status: 'done',
      message: `"${unitTitle}" ünitesi yenilendi ve taslak olarak kaydedildi${removedCount > 0 ? ` (${removedCount} bitirme sorusu güncellendi)` : ''}. Aşağıdan inceleyip yayınlayabilirsin.`,
    });
  } catch (e: any) {
    upsertTask({ id, kind: 'unit', label, status: 'error', message: 'Ünite yenilenirken bir sorun oldu: ' + e.message });
  }
}

export { BOSS_EVERY };
