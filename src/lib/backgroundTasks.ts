import { useSyncExternalStore } from 'react';
import { sb } from './supabase';
import type { LeagueContent, MustRead, QuizQuestion, CapstoneQuestion } from './types';

export type TaskKind = 'week' | 'league' | 'unit';
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
- "summary" alanı bir "makale tanıtımı" DEĞİL, doğrudan bilgi aktaran bir ders notu olmalı — kaynağı okumadan da o bilgiye sahip olacak şekilde yaz. "Bu makale ... anlatıyor", "Yazar ... belirtiyor", "Bu yazı ... ele alıyor" gibi meta-anlatım KULLANMA; doğrudan olguyu, kavramı, sonucu ver — sanki okuyucuya konuyu sen öğretiyormuşsun gibi yaz. ODAK NOKTASI SAYILAR/İSTATİSTİKLER DEĞİL, ANLAM olmalı: neden oldu, ne anlama geliyor, sonucu/etkisi ne olacak — bunları öne çıkar. Kaynakta geçen bir rakam gerçekten haberin özüyse elbette geçebilir, ama özeti bir rakam listesine indirgeme; asıl mesaj her zaman "bu gelişme neden önemli ve ne anlama geliyor" olsun.
- Sorular ve özetler gereksiz sektör içi jargon kullanmadan, konuya yeni başlayan sıradan birinin de anlayabileceği şekilde yazılsın — ama bilgiyi basitleştirirken yanlış veya belirsiz hale getirme, doğruluktan ödün verme.
- Her kaynak için quiz'de "source_index" o kaynağın must_reads içindeki index'ine eşit olan tam olarak 4 soru olsun:
  - 2 tanesi "type": "mc", "bonus": false — cevabı summary'den çıkarılabilecek, genel anlama soruları, farklı yönlere odaklansın, 3 seçenekli.
  - 1 tanesi "type": "tf", "bonus": true — Doğru/Yanlış formatında bir ifade, SADECE kaynağın tam metnindeki spesifik bir detaya dayanmalı, summary'den cevaplanamamalı; "options" tam olarak ["Doğru","Yanlış"] olmalı, "correct_index" 0 (Doğru) veya 1 (Yanlış).
  - 1 tanesi "type": "mc", "bonus": true — yine kaynağın tam metnindeki bir detaya dayanmalı, summary'den cevaplanamamalı, 3 seçenekli.
- SORU KALİTESİ — ÇOK ÖNEMLİ, kesinlikle uy: Bu bir bilgi yarışması/trivia sınavı DEĞİL, okuyucunun konuyu gerçekten ANLAYIP ANLAMADIĞINI ölçen bir sınav. Şunları KESİNLİKLE YAPMA:
  - "X ne kadardı/kaçtı?", "Y'nin rakamı neydi?" gibi salt bir sayıyı/istatistiği ezberden sorma soruları YASAK — sayı sorusu SADECE "number_challenge" alanında olur, quiz'de asla tekrar sorulmaz.
  - Birbiriyle ilgisiz 2-3 olguyu yan yana koyup "aşağıdakilerden hangisi doğrudur?" diye sorma — bu şans/ezber sorusu üretir, anlama ölçmez.
  - Bir ismi, tarihi veya terimi salt hatırlamayı test eden soru yazma.
  Bunun yerine şu kalıplarda sorular kur: "Bu gelişme neden önemli/riskli?", "Bu iki bilgi arasındaki ilişki/çelişki nedir?", "Bu durumun en olası sonucu/etkisi nedir?", "Kaynağa göre bu neden böyle oldu/olacak?", "Bu bilgi [ilgili kavram] açısından ne ifade ediyor?" — yani NEDEN, SONUÇ, ÖNEM veya İLİŞKİ soran sorular yaz. Yanlış şıklar rastgele değil, konuyu yüzeysel/yanlış anlayan birinin makul şekilde seçebileceği çeldiriciler olsun.
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
const SUMMARY_QUALITY_RULE = `"summary" alanı bir "makale tanıtımı" DEĞİL, doğrudan bilgi aktaran bir ders notu olmalı — kaynağı okumadan da o bilgiye sahip olacak şekilde yaz. "Bu makale ... anlatıyor", "Yazar ... belirtiyor" gibi meta-anlatım KULLANMA; doğrudan olguyu, kavramı, sonucu ver. ODAK NOKTASI SAYILAR/İSTATİSTİKLER DEĞİL, ANLAM olmalı: bu kavram neden önemli, ne işe yarar, nasıl kullanılır — bunları öne çıkar. Bir rakam gerçekten konunun özüyse geçebilir, ama özeti bir rakam listesine indirgeme.`;

const PER_UNIT_QUIZ_RULE = `Tam olarak 4 soru üret:
  - 2 tanesi "type": "mc", "bonus": false — cevabı summary'den çıkarılabilecek, genel anlama soruları, farklı yönlere odaklansın, 3 seçenekli.
  - 1 tanesi "type": "tf", "bonus": true — Doğru/Yanlış formatında bir ifade, SADECE kaynağın tam metnindeki spesifik bir detaya dayanmalı, summary'den cevaplanamamalı; "options" tam olarak ["Doğru","Yanlış"] olmalı, "correct_index" 0 (Doğru) veya 1 (Yanlış).
  - 1 tanesi "type": "mc", "bonus": true — yine kaynağın tam metnindeki bir detaya dayanmalı, summary'den cevaplanamamalı, 3 seçenekli.`;

const QUIZ_QUALITY_RULE = `SORU KALİTESİ — ÇOK ÖNEMLİ, kesinlikle uy (quiz VE capstone için geçerli): Bu bir bilgi yarışması/trivia sınavı DEĞİL, okuyucunun konuyu gerçekten ANLAYIP ANLAMADIĞINI ölçen bir sınav. Şunları KESİNLİKLE YAPMA:
  - Bir sayıyı/istatistiği/ismi/tarihi ezberden sorma (örn. "X ne kadardı?", "Y kaç kişiydi?") — bu bir kalıcı rehber, güncel bir sayıya dayanmak zaten yanlış olur.
  - Birbiriyle ilgisiz 2-3 olguyu yan yana koyup "aşağıdakilerden hangisi doğrudur?" diye sorma — bu şans/ezber sorusu üretir, anlama ölçmez.
  Bunun yerine şu kalıplarda sorular kur: "Bu neden önemli?", "Bu iki kavram arasındaki ilişki/fark nedir?", "Bu, [ilgili kavram] açısından ne ifade eder?", "Bu bilgiye göre en olası sonuç/uygulama nedir?" — yani NEDEN, SONUÇ, ÖNEM veya İLİŞKİ soran, o seviyeye özgü kavramsal anlayışı test eden sorular. Yanlış şıklar rastgele değil, konuyu yüzeysel anlayan birinin makul şekilde seçebileceği çeldiriciler olsun.`;

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

export type LeagueGenerationParams = {
  urls: string[];
  apiKey: string;
  tierIndex: number;
  leagueName: string;
};

export async function runLeagueGeneration(params: LeagueGenerationParams): Promise<void> {
  const { urls, apiKey, tierIndex, leagueName } = params;
  const id = genId();
  const label = leagueName;

  upsertTask({ id, kind: 'league', label, status: 'running', message: 'Başlatılıyor…' });

  let combined = '';
  for (let i = 0; i < urls.length; i++) {
    upsertTask({ id, kind: 'league', label, status: 'running', message: `${i + 1}/${urls.length} okunuyor: ${urls[i]}` });
    try {
      const text = await fetchReadable(urls[i]);
      combined += `\n\n--- Kaynak ${i}: ${urls[i]} ---\n${text}`;
    } catch (e) {
      combined += `\n\n--- Kaynak ${i}: ${urls[i]} (içerik okunamadı, sadece link olarak dahil et) ---`;
    }
  }

  upsertTask({ id, kind: 'league', label, status: 'running', message: 'Rehber hazırlanıyor…' });
  try {
    const prompt = `Aşağıda "${leagueName}" ligi için TEMEL/SABİT bir rehber oluşturacak kaynakların ham metni var, her biri "--- Kaynak N: url ---" başlığıyla ayrılmış. Bu içerik bir kere oluşturulacak ve değişmeyecek (haftalık değil). Bunları işleyip SADECE aşağıdaki şemaya uyan geçerli JSON döndür, başka açıklama, markdown işareti ekleme:

{
  "must_reads": [ { "title": "başlık", "url": "kaynağın orijinal linki", "summary": "4-6 cümlelik, doğrudan bilgi aktaran ders notu" } ],
  "quiz": [ { "source_index": 0, "type": "mc", "bonus": false, "question": "soru metni", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama" } ],
  "capstone": [ { "question": "soru metni", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama", "source_indices": [0, 1] } ]
}

Kurallar:
- Her kaynak için bir must_reads öğesi oluştur (sırasıyla index 0,1,2,...).
- ${SUMMARY_QUALITY_RULE}
- Her kaynak için quiz'de "source_index" o kaynağın must_reads içindeki index'ine eşit olan ${PER_UNIT_QUIZ_RULE}
- "capstone": bu ligin TÜM rehberini kapatan final sınavı, tam olarak 3 soru üret:
  - En az 2 kaynak varsa, HER capstone sorusu en az İKİ FARKLI kaynaktaki bilgiyi birbirine bağlamayı gerektirmeli — tek bir kaynağın özetinden cevaplanamamalı. Örnek kalıplar: "Kaynak A'daki X kavramı ile Kaynak B'deki Y arasındaki ilişki nedir?", "Bu iki kaynaktaki bilgiler birlikte değerlendirildiğinde en olası sonuç nedir?", "Kaynak A ve Kaynak B'deki yaklaşımlar birleştirilirse ortaya çıkan çıkarım nedir?".
  - Kaynak sayısı 1-2 gibi çok azsa (gerçek bir "birden fazla kaynağı birleştirme" sorusu kurulamıyorsa) yine de tam 3 soru üret, ama bu durumda sorular mevcut tek kaynaktaki EN DERİN/EN ÖNEMLİ kavramı test etsin (kaynaklar arası sentez zaten mümkün değil).
  - Bu, ligin final sınavı olduğu için rehberdeki EN ZOR sorular bunlar olmalı — quiz'deki bonus sorulardan bile daha zor.
  - Aşağıdaki SORU KALİTESİ kuralına (trivia/ezber/sayı sorusu yasak, rastgele olgu yan yana koyma yasak) capstone için de aynen uy.
  - Her capstone sorusu için, o soruyu cevaplamak amacıyla kullandığın kaynakların (must_reads) index'lerini "source_indices" dizisinde belirt (örn. iki kaynağı birleştiren bir soru için [0, 2]).
- ${QUIZ_QUALITY_RULE}
- Bu ligin seviyesine uygun zorlukta sorular üret ("${leagueName}" ne kadar üst seviyeyse o kadar zor olsun). Bu rehber kalıcı ve temel bir referans olacağı için sorular haftalık değil, o seviyeye özgü genel/kalıcı bilgiyi ölçmeli.

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
      body: JSON.stringify({ model: MODEL, max_tokens: 48000, messages: [{ role: 'user', content: prompt }] }),
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

    const { error: updateError } = await sb.from('leagues').update({
      draft_content: {
        must_reads: parsed.must_reads,
        quiz: parsed.quiz,
        capstone: parsed.capstone || null,
      },
    }).eq('tier_index', tierIndex);
    if (updateError) throw new Error('Veritabanına yazılamadı: ' + updateError.message);

    upsertTask({
      id,
      kind: 'league',
      label,
      status: 'done',
      message: `${leagueName} rehberi taslak olarak kaydedildi. Aşağıdan inceleyip yayınlayabilirsin.`,
    });
  } catch (e: any) {
    upsertTask({ id, kind: 'league', label, status: 'error', message: 'Rehber işlenirken bir sorun oldu: ' + e.message });
  }
}

export type UnitRegenerationParams = {
  url: string;
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
  const { url, apiKey, tierIndex, leagueName, sourceIndex, unitTitle, currentContent } = params;
  const id = genId();
  const label = `${leagueName} · Ünite ${sourceIndex + 1}: ${unitTitle}`;

  upsertTask({ id, kind: 'unit', label, status: 'running', message: 'Başlatılıyor…' });

  try {
    upsertTask({ id, kind: 'unit', label, status: 'running', message: `Kaynak okunuyor: ${url}` });
    let sourceText: string;
    try {
      sourceText = await fetchReadable(url);
    } catch (e) {
      throw new Error('Kaynak okunamadı: ' + url);
    }

    upsertTask({ id, kind: 'unit', label, status: 'running', message: 'Ünite hazırlanıyor…' });
    const unitPrompt = `Aşağıda bir lig rehberindeki TEK BİR ünitenin YENİ kaynağının ham metni var. Bu ünite mevcut rehberdeki "${unitTitle}" ünitesinin yerini alacak. Bunu işleyip SADECE aşağıdaki şemaya uyan geçerli JSON döndür, başka açıklama, markdown işareti ekleme:

{
  "title": "başlık",
  "url": "kaynağın orijinal linki",
  "summary": "4-6 cümlelik, doğrudan bilgi aktaran ders notu",
  "quiz": [ { "type": "mc", "bonus": false, "question": "soru metni", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama" } ]
}

Kurallar:
- ${SUMMARY_QUALITY_RULE}
- "quiz" alanında ${PER_UNIT_QUIZ_RULE}
- ${QUIZ_QUALITY_RULE}

Ham içerik:
${sourceText}`;

    const unitParsed = await callClaudeJSON(unitPrompt, apiKey, 16000);
    const newMustRead: MustRead = {
      title: unitParsed.title,
      url: unitParsed.url || url,
      summary: unitParsed.summary,
    };
    const newUnitQuiz: QuizQuestion[] = (unitParsed.quiz || []).map((q: any) => ({
      source_index: sourceIndex,
      type: q.type,
      bonus: q.bonus,
      question: q.question,
      options: q.options,
      correct_index: q.correct_index,
      explanation: q.explanation,
    }));

    // Merge must_reads: only the target index's entry changes, order/rest untouched.
    const newMustReads = currentContent.must_reads.map((m, i) => (i === sourceIndex ? newMustRead : m));

    // Merge quiz: drop the old questions for this source_index and splice the
    // 4 new ones in at the same spot, leaving every other unit's questions
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
      const mustReadsList = newMustReads.map((m, i) => `Ünite ${i}: ${m.title}\n${m.summary}`).join('\n\n');
      const capstonePrompt = `İşte şu an mevcut olan tüm ünitelerin özetleri:

${mustReadsList}

Aşağıdaki sayıda YENİ bitirme sınavı sorusu üret: ${removedCount}. Bu sorular önceki bitirme sınavı sorularının silinen kısmının yerini alacak, aynı kalite kurallarına uy (en az 2 farklı üniteyi birleştiren sentez soruları, ezber/trivia yasak), her soru için hangi ünite index'lerini kullandığını "source_indices" dizisi olarak belirt.

SADECE aşağıdaki şemaya uyan geçerli JSON döndür, başka açıklama, markdown işareti ekleme:
{ "capstone": [ { "question": "soru metni", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama", "source_indices": [0, 1] } ] }

- ${QUIZ_QUALITY_RULE}`;

      const capstoneParsed = await callClaudeJSON(capstonePrompt, apiKey, 16000);
      backfillCapstone = (capstoneParsed.capstone || []).map((q: any) => ({
        question: q.question,
        options: q.options,
        correct_index: q.correct_index,
        explanation: q.explanation,
        source_indices: q.source_indices || [],
      }));
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
