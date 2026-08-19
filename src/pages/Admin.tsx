import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from '../lib/supabase';
import type { League, Profile, Week } from '../lib/types';
import ContentReviewEditor, { keyMustReads, keyQuiz, stripKeys } from '../components/ContentReviewEditor';
import type { ReviewDraft } from '../components/ContentReviewEditor';

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
function formatWeekRange(createdAt?: string | null) {
  if (!createdAt) return '';
  const start = new Date(createdAt);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const sd = start.getDate(), ed = end.getDate();
  const sm = TR_MONTHS[start.getMonth()], em = TR_MONTHS[end.getMonth()];
  return sm === em ? `${sd}-${ed} ${sm}` : `${sd} ${sm} - ${ed} ${em}`;
}
const MODEL = 'claude-sonnet-5';
const BOSS_EVERY = 5;
const APIKEY_SESSION_KEY = 'aitakip_admin_apikey';

async function fetchReadable(url: string) {
  const readerUrl = 'https://r.jina.ai/' + url;
  const res = await fetch(readerUrl);
  if (!res.ok) throw new Error('reader-failed:' + url);
  const text = await res.text();
  return text.slice(0, 6000);
}

function demoWeekPayload(weekNumber: number, isBossWeek: boolean) {
  return {
    week_number: weekNumber,
    week_theme: 'Bu hafta yapay zeka ajanları ve kurumsal iş akışları öne çıktı (DEMO VERİ)',
    must_reads: [
      { title: '[Demo] Kurumsal AI Ajanları Nasıl Çalışır', url: 'https://example.com/demo-1',
        summary: 'Bu demo özet, gerçek bir API çağrısı yapılmadan test amaçlı üretildi. AI ajanları, çok adımlı görevleri araçlar kullanarak otonom şekilde tamamlayabiliyor. Kurumsal kullanımda en büyük risk, yetki sınırlarının net olmamasından kaynaklanıyor. Doğru gözetim mekanizmalarıyla verimlilik belirgin şekilde artıyor. Pilot uygulamalar genelde önce düşük riskli süreçlerde başlatılıyor. Sonuçlar olumluysa kapsam kademeli olarak genişletiliyor.' },
      { title: '[Demo] Üretkenlik Araçlarında AI Entegrasyonu', url: 'https://example.com/demo-2',
        summary: 'İkinci demo kaynak da gerçek veri değildir, sadece arayüzü test etmen için var. Ekipler AI destekli araçları benimsedikçe tekrarlayan işler azalıyor, ama eğitim eksikliği benimsemeyi yavaşlatıyor. Başarılı şirketler küçük pilot gruplarla başlayıp kademeli genişliyor. Orta vadede rol tanımları da bu araçlara göre yeniden şekilleniyor.' },
    ],
    quiz: [
      { source_index: 0, type: 'mc', bonus: false, question: '[Demo] Metne göre AI ajanlarının kurumsal kullanımdaki en büyük riski nedir?', options: ['Maliyet', 'Yetki sınırlarının net olmaması', 'Yavaş çalışması'], correct_index: 1, explanation: 'Demo açıklama: özet metninde bu doğrudan belirtiliyor.' },
      { source_index: 0, type: 'mc', bonus: false, question: '[Demo] Doğru gözetim mekanizmalarının etkisi nedir?', options: ['Verimliliği azaltır', 'Verimliliği belirgin artırır', 'Hiçbir etkisi yok'], correct_index: 1, explanation: 'Demo açıklama: özet metninde bu doğrudan belirtiliyor.' },
      { source_index: 0, type: 'tf', bonus: true, question: '[Demo-BONUS] Bu ifade gerçek bir kaynakta olsaydı, sadece linke tıklayıp okuyarak doğrulanabilirdi: "Ajanlar hiçbir gözetim olmadan güvenli çalışır."', options: ['Doğru', 'Yanlış'], correct_index: 1, explanation: 'Demo açıklama: bonus sorular özetten değil, kaynağın tam metninden çıkar.' },
      { source_index: 0, type: 'mc', bonus: true, question: '[Demo-BONUS] Pilot uygulamalar genelde ilk olarak nerede başlatılıyor?', options: ['Yüksek riskli süreçlerde', 'Düşük riskli süreçlerde', 'Hiç pilot yapılmıyor'], correct_index: 1, explanation: 'Demo açıklama: bu bonus soru kaynağın tam metnine dayanır.' },
      { source_index: 1, type: 'mc', bonus: false, question: '[Demo] İkinci kaynağa göre benimsemeyi ne yavaşlatıyor?', options: ['Bütçe', 'Eğitim eksikliği', 'Donanım'], correct_index: 1, explanation: 'Demo açıklama: özet metninde bu doğrudan belirtiliyor.' },
      { source_index: 1, type: 'mc', bonus: false, question: '[Demo] AI destekli araçları benimsedikçe ne azalıyor?', options: ['Tekrarlayan işler', 'Yaratıcı işler', 'Toplantılar'], correct_index: 0, explanation: 'Demo açıklama: özet metninde bu doğrudan belirtiliyor.' },
      { source_index: 1, type: 'tf', bonus: true, question: '[Demo-BONUS] "Başarılı şirketler tek seferde büyük ölçekli geçiş yapıyor." ifadesi doğru mu?', options: ['Doğru', 'Yanlış'], correct_index: 1, explanation: 'Demo açıklama: bu bonus soru gerçek senaryoda detaylı okuma gerektirir.' },
      { source_index: 1, type: 'mc', bonus: true, question: '[Demo-BONUS] Orta vadede rol tanımlarına ne oluyor?', options: ['Hiç değişmiyor', 'Araçlara göre yeniden şekilleniyor', 'Kaldırılıyor'], correct_index: 1, explanation: 'Demo açıklama: bu bonus soru kaynağın tam metnine dayanır.' },
    ],
    number_challenge: { source_index: 0, question: '[Demo] Kaynakta örnek olarak verilen verimlilik artışı yüzde kaçtır?', correct_value: 35, tolerance: 5, explanation: 'Demo açıklama: gerçek kaynakta geçen sayı burada sorulur.' },
    matching: { pairs: [ { source_index: 0, detail: 'Yetki sınırı belirsizliği riski' }, { source_index: 1, detail: 'Eğitim eksikliği nedeniyle yavaş benimseme' } ] },
    risk_question: { question: '[Demo-RİSK] Bu hafta hangi yaklaşım daha çok önerildi?', options: ['Büyük patlama geçişi', 'Kademeli pilot yaklaşımı', 'Hiç AI kullanmamak'], correct_index: 1, explanation: 'Demo açıklama: risk sorusu bahis mekaniği için örnek.' },
    boss_question: isBossWeek ? { question: '[Demo-BOSS] İki kaynağı birlikte düşünürsek, en güvenli benimseme stratejisi nedir?', options: ['Hızlı ve büyük ölçekli geçiş', 'Gözetimli, kademeli pilot yaklaşımı', 'Hiç eğitim vermeden yaygınlaştırma'], correct_index: 1, explanation: 'Demo açıklama: boss soruları birden fazla kaynağı birleştirir.' } : null,
    is_boss: isBossWeek,
  };
}

function demoLeagueContent(tierName: string) {
  const must_reads = [];
  for (let i = 1; i <= 10; i++) {
    must_reads.push({
      title: `${i}. [Demo] ${tierName} Kaynağı`,
      url: `https://example.com/league-demo-${i}`,
      summary: `Bu ${i}. demo kaynağın özeti — gerçek bir API çağrısı yapılmadan test amaçlı üretildi. ${tierName} seviyesine uygun bir AI/kurumsal dönüşüm konusunu özetliyor. Gerçek müfredat admin panelinden linkler girilerek oluşturulduğunda bu metnin yerini kaynağın tam özeti alacak.`,
    });
  }
  const quiz = [];
  for (let i = 0; i < 4; i++) {
    quiz.push({ source_index: i, type: 'mc', bonus: false, question: `[Demo] ${i + 1}. kaynağın ana fikri nedir?`, options: ['Seçenek A', 'Seçenek B (doğru)', 'Seçenek C'], correct_index: 1, explanation: 'Demo açıklama.' });
    quiz.push({ source_index: i, type: 'tf', bonus: false, question: `[Demo] Bu ifade doğru mu: "${i + 1}. kaynak temel bir kavramı anlatıyor."`, options: ['Doğru', 'Yanlış'], correct_index: 0, explanation: 'Demo açıklama.' });
  }
  return { must_reads, quiz };
}

export default function Admin() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');

  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem(APIKEY_SESSION_KEY) || '');
  const [keyDraft, setKeyDraft] = useState('');
  const [linksText, setLinksText] = useState('');
  const [weekLabelDraft, setWeekLabelDraft] = useState('');
  const [building, setBuilding] = useState(false);
  const [buildStatus, setBuildStatus] = useState('');
  const [buildError, setBuildError] = useState('');
  const [buildOk, setBuildOk] = useState('');
  const [pastWeeks, setPastWeeks] = useState<Week[]>([]);
  const [draftWeeks, setDraftWeeks] = useState<Week[]>([]);
  const [nextWeekNumber, setNextWeekNumber] = useState(1);
  const [weeksVersion, setWeeksVersion] = useState(0);

  const [leagues, setLeagues] = useState<League[]>([]);
  const [leagueTierChoice, setLeagueTierChoice] = useState(0);
  const [leagueLinksText, setLeagueLinksText] = useState('');
  const [leagueBuilding, setLeagueBuilding] = useState(false);
  const [leagueStatus, setLeagueStatus] = useState('');
  const [leagueError, setLeagueError] = useState('');
  const [leagueOk, setLeagueOk] = useState('');
  const [leaguesVersion, setLeaguesVersion] = useState(0);

  // Review/edit state — a week being reviewed (draft or already-published) or a league being reviewed.
  const [editingWeek, setEditingWeek] = useState<{ week: Week; mode: 'draft' | 'published'; draft: ReviewDraft } | null>(null);
  const [editingLeague, setEditingLeague] = useState<{ league: League; mode: 'draft_content' | 'content'; draft: ReviewDraft } | null>(null);
  const [editorError, setEditorError] = useState('');
  const [editorBusy, setEditorBusy] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingAuth(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    sb.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data));
  }, [session]);

  useEffect(() => {
    if (!profile || !profile.is_admin) return;
    sb.from('weeks').select('*').order('week_number', { ascending: false })
      .then(({ data }) => {
        const all = (data as Week[]) || [];
        setPastWeeks(all.filter((w) => w.status === 'published'));
        setDraftWeeks(all.filter((w) => w.status === 'draft'));
        setNextWeekNumber(all.length > 0 ? Math.max(...all.map((w) => w.week_number)) + 1 : 1);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, buildOk, weeksVersion]);

  useEffect(() => {
    if (!profile || !profile.is_admin) return;
    sb.from('leagues').select('*').order('tier_index', { ascending: true }).then(({ data }) => setLeagues((data as League[]) || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, leagueOk, leaguesVersion]);

  async function login() {
    setAuthError('');
    if (!loginIdentifier.trim() || !passwordInput) { setAuthError('Kullanıcı adı/e-posta ve şifre gerekli.'); return; }
    const { data: resolvedEmail, error: lookupError } = await sb.rpc('email_for_login', { identifier: loginIdentifier.trim() });
    if (lookupError || !resolvedEmail) { setAuthError('Kullanıcı bulunamadı.'); return; }
    const { error } = await sb.auth.signInWithPassword({ email: resolvedEmail, password: passwordInput });
    if (error) setAuthError('Giriş başarısız: ' + error.message);
  }

  async function logout() {
    await sb.auth.signOut();
  }

  function saveKey() {
    if (!keyDraft.trim()) return;
    sessionStorage.setItem(APIKEY_SESSION_KEY, keyDraft.trim());
    setApiKey(keyDraft.trim());
    setKeyDraft('');
  }

  async function buildWeek() {
    const urls = linksText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0 || !apiKey) return;
    if (urls.length > 10) {
      setBuildError(`En fazla 10 link ekleyebilirsin (şu an ${urls.length} tane var).`);
      return;
    }
    const isBossWeek = nextWeekNumber % BOSS_EVERY === 0;
    setBuilding(true);
    setBuildError('');
    setBuildOk('');

    let combined = '';
    for (let i = 0; i < urls.length; i++) {
      setBuildStatus(`${i + 1}/${urls.length} okunuyor: ${urls[i]}`);
      try {
        const text = await fetchReadable(urls[i]);
        combined += `\n\n--- Kaynak ${i}: ${urls[i]} ---\n${text}`;
      } catch (e) {
        combined += `\n\n--- Kaynak ${i}: ${urls[i]} (içerik okunamadı, sadece link olarak dahil et) ---`;
      }
    }

    setBuildStatus('Quiz ve özet hazırlanıyor…');
    try {
      const prompt = `Aşağıda bu haftaki AI/kurumsal dönüşüm kaynaklarının ham metni var (makale, blog, podcast/video sayfası), her biri "--- Kaynak N: url ---" başlığıyla ayrılmış. Bunları işleyip SADECE aşağıdaki şemaya uyan geçerli JSON döndür, başka açıklama, markdown işareti ekleme:

{
  "week_theme": "haftanın öne çıkan temasını özetleyen tek kısa cümle",
  "must_reads": [ { "title": "başlık", "url": "kaynağın orijinal linki", "summary": "4-6 cümlelik doyurucu bir özet, kaynağı okumadan da ana fikri ve önemli detayları anlat" } ],
  "quiz": [ { "source_index": 0, "type": "mc", "bonus": false, "question": "soru metni", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama" } ],
  "number_challenge": { "source_index": 0, "question": "kaynakta geçen bir sayıyı soran soru metni", "correct_value": 42, "tolerance": 5, "explanation": "kısa açıklama" },
  "matching": { "pairs": [ { "source_index": 0, "detail": "o kaynağa özgü kısa, ayırt edici bir detay/olgu cümlesi" } ] },
  "risk_question": { "question": "orta-zor bir soru", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama" }${isBossWeek ? ',\n  "boss_question": { "question": "birden fazla kaynaktaki bilgiyi birleştirmeyi gerektiren zor bir sentez sorusu", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama" }' : ''}
}

Kurallar:
- Her kaynak için bir must_reads öğesi oluştur (sırasıyla index 0,1,2,...).
- Her kaynak için quiz'de "source_index" o kaynağın must_reads içindeki index'ine eşit olan tam olarak 4 soru olsun:
  - 2 tanesi "type": "mc", "bonus": false — cevabı summary'den çıkarılabilecek, genel anlama soruları, farklı yönlere odaklansın, 3 seçenekli.
  - 1 tanesi "type": "tf", "bonus": true — Doğru/Yanlış formatında bir ifade, SADECE kaynağın tam metnindeki spesifik bir detaya dayanmalı, summary'den cevaplanamamalı; "options" tam olarak ["Doğru","Yanlış"] olmalı, "correct_index" 0 (Doğru) veya 1 (Yanlış).
  - 1 tanesi "type": "mc", "bonus": true — yine kaynağın tam metnindeki bir detaya dayanmalı, summary'den cevaplanamamalı, 3 seçenekli.
- "number_challenge": haftada sadece 1 tane, kaynaklardan birinde geçen somut bir sayıyı/istatistiği sorsun, makul bir "tolerance" belirle.
- "matching": kaynak sayısı 2 veya daha fazlaysa doldur, "pairs" uzunluğu kaynak sayısına eşit olsun, her "detail" sadece o kaynağa ait, kısa ve ayırt edici olsun. Kaynak sayısı 1 ise "pairs": [] olarak boş bırak.
- "risk_question": kaynaklardan herhangi birine dayanan, normal sorulardan biraz daha zor, 3 seçenekli tek bir soru.
${isBossWeek ? '- "boss_question": bu bir BOSS HAFTASI, birden fazla kaynaktaki bilgiyi birlikte kullanmayı gerektiren en zor soruyu üret.' : ''}

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
        week_label: weekLabelDraft.trim() || null,
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

      setBuildOk(`Hafta ${nextWeekNumber} taslak olarak oluşturuldu${isBossWeek ? ' (BOSS HAFTASI)' : ''}. "Taslaklar" bölümünden inceleyip yayınlayabilirsin.`);
      setLinksText('');
      setWeekLabelDraft('');
    } catch (e: any) {
      setBuildError('Hafta işlenirken bir sorun oldu: ' + e.message);
    } finally {
      setBuilding(false);
      setBuildStatus('');
    }
  }

  async function publishDemoWeek() {
    setBuildError(''); setBuildOk('');
    const isBossWeek = nextWeekNumber % BOSS_EVERY === 0;
    const demo = demoWeekPayload(nextWeekNumber, isBossWeek);
    const label = weekLabelDraft.trim() || `Demo Hafta ${nextWeekNumber}`;
    const { error: insertError } = await sb.from('weeks').insert({ ...demo, week_label: label });
    if (insertError) { setBuildError('Veritabanına yazılamadı: ' + insertError.message); return; }
    setBuildOk(`Hafta ${nextWeekNumber} demo veriyle yayınlandı (token harcanmadı).`);
    setWeekLabelDraft('');
  }

  async function publishDemoLeagues() {
    setLeagueError(''); setLeagueOk('');
    for (const l of leagues) {
      const content = demoLeagueContent(l.name);
      await sb.from('leagues').update({ content }).eq('tier_index', l.tier_index);
    }
    setLeagueOk('Tüm liglere demo müfredat yayınlandı (token harcanmadı).');
  }

  async function buildLeagueContent() {
    const urls = leagueLinksText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0 || !apiKey) return;
    if (urls.length > 6) { setLeagueError('En fazla 6 link ekleyebilirsin.'); return; }
    setLeagueBuilding(true);
    setLeagueError('');
    setLeagueOk('');

    let combined = '';
    for (let i = 0; i < urls.length; i++) {
      setLeagueStatus(`${i + 1}/${urls.length} okunuyor: ${urls[i]}`);
      try {
        const text = await fetchReadable(urls[i]);
        combined += `\n\n--- Kaynak ${i}: ${urls[i]} ---\n${text}`;
      } catch (e) {
        combined += `\n\n--- Kaynak ${i}: ${urls[i]} (içerik okunamadı, sadece link olarak dahil et) ---`;
      }
    }

    const leagueName = leagues.find((l) => l.tier_index === leagueTierChoice)?.name || ('Lig ' + leagueTierChoice);
    setLeagueStatus('Müfredat hazırlanıyor…');
    try {
      const prompt = `Aşağıda "${leagueName}" ligi için TEMEL/SABİT bir müfredat oluşturacak kaynakların ham metni var, her biri "--- Kaynak N: url ---" başlığıyla ayrılmış. Bu içerik bir kere oluşturulacak ve değişmeyecek (haftalık değil). Bunları işleyip SADECE aşağıdaki şemaya uyan geçerli JSON döndür, başka açıklama, markdown işareti ekleme:

{
  "must_reads": [ { "title": "başlık", "url": "kaynağın orijinal linki", "summary": "4-6 cümlelik doyurucu bir özet" } ],
  "quiz": [ { "source_index": 0, "type": "mc", "bonus": false, "question": "soru metni", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama" } ]
}

Kurallar:
- Her kaynak için bir must_reads öğesi oluştur (sırasıyla index 0,1,2,...).
- Her kaynak için quiz'de tam olarak 2 soru olsun: 1 "type":"mc" (3 seçenekli, genel anlama), 1 "type":"tf" (Doğru/Yanlış, "options" tam olarak ["Doğru","Yanlış"], "correct_index" 0 veya 1, kaynağın tam metnindeki bir detaya dayanmalı).
- Bu ligin seviyesine uygun zorlukta sorular üret ("${leagueName}" ne kadar üst seviyeyse o kadar zor olsun).

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
        body: JSON.stringify({ model: MODEL, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }),
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

      const { error: updateError } = await sb.from('leagues').update({ draft_content: parsed }).eq('tier_index', leagueTierChoice);
      if (updateError) throw new Error('Veritabanına yazılamadı: ' + updateError.message);

      setLeagueOk(`${leagueName} müfredatı taslak olarak kaydedildi. Aşağıdan inceleyip yayınlayabilirsin.`);
      setLeagueLinksText('');
    } catch (e: any) {
      setLeagueError('Müfredat işlenirken bir sorun oldu: ' + e.message);
    } finally {
      setLeagueBuilding(false);
      setLeagueStatus('');
    }
  }

  function weekToDraft(w: Week): ReviewDraft {
    return {
      must_reads: keyMustReads(w.must_reads || []),
      quiz: keyQuiz(w.quiz || []),
      week_theme: w.week_theme,
      week_label: w.week_label,
      number_challenge: w.number_challenge,
      matching: w.matching,
      risk_question: w.risk_question,
      boss_question: w.boss_question,
    };
  }

  function leagueContentToDraft(c: { must_reads: any[]; quiz: any[] } | null): ReviewDraft {
    return { must_reads: keyMustReads(c?.must_reads || []), quiz: keyQuiz(c?.quiz || []) };
  }

  function openWeekEditor(week: Week, mode: 'draft' | 'published') {
    setEditorError('');
    setEditingWeek({ week, mode, draft: weekToDraft(week) });
  }

  async function saveWeekEditor(publish: boolean) {
    if (!editingWeek) return;
    setEditorBusy(true);
    setEditorError('');
    const clean = stripKeys(editingWeek.draft);
    const payload: any = {
      week_theme: editingWeek.draft.week_theme ?? null,
      week_label: editingWeek.draft.week_label ?? null,
      must_reads: clean.must_reads,
      quiz: clean.quiz,
      number_challenge: editingWeek.draft.number_challenge ?? null,
      matching: editingWeek.draft.matching ?? null,
      risk_question: editingWeek.draft.risk_question ?? null,
      boss_question: editingWeek.draft.boss_question ?? null,
    };
    if (publish) payload.status = 'published';
    const { error } = await sb.from('weeks').update(payload).eq('week_number', editingWeek.week.week_number);
    setEditorBusy(false);
    if (error) { setEditorError('Kaydedilemedi: ' + error.message); return; }
    setEditingWeek(null);
    setWeeksVersion((v) => v + 1);
  }

  async function deleteWeekDraft() {
    if (!editingWeek || editingWeek.mode !== 'draft') return;
    if (!confirm(`Hafta ${editingWeek.week.week_number} taslağını silmek istediğine emin misin?`)) return;
    setEditorBusy(true);
    setEditorError('');
    const { error } = await sb.from('weeks').delete().eq('week_number', editingWeek.week.week_number).eq('status', 'draft');
    setEditorBusy(false);
    if (error) { setEditorError('Silinemedi: ' + error.message); return; }
    setEditingWeek(null);
    setWeeksVersion((v) => v + 1);
  }

  function openLeagueEditor(league: League, mode: 'draft_content' | 'content') {
    setEditorError('');
    const source = mode === 'draft_content' ? league.draft_content : league.content;
    setEditingLeague({ league, mode, draft: leagueContentToDraft(source) });
  }

  async function saveLeagueEditor(publish: boolean) {
    if (!editingLeague) return;
    setEditorBusy(true);
    setEditorError('');
    const clean = stripKeys(editingLeague.draft);
    if (publish) {
      const { error } = await sb.from('leagues').update({ content: clean, draft_content: null }).eq('tier_index', editingLeague.league.tier_index);
      setEditorBusy(false);
      if (error) { setEditorError('Yayınlanamadı: ' + error.message); return; }
    } else {
      const field = editingLeague.mode === 'draft_content' ? 'draft_content' : 'content';
      const { error } = await sb.from('leagues').update({ [field]: clean }).eq('tier_index', editingLeague.league.tier_index);
      setEditorBusy(false);
      if (error) { setEditorError('Kaydedilemedi: ' + error.message); return; }
    }
    setEditingLeague(null);
    setLeagueOk('Lig içeriği güncellendi.');
    setLeaguesVersion((v) => v + 1);
  }

  async function discardLeagueDraft() {
    if (!editingLeague || editingLeague.mode !== 'draft_content') return;
    if (!confirm(`${editingLeague.league.name} taslağını silmek istediğine emin misin?`)) return;
    setEditorBusy(true);
    setEditorError('');
    const { error } = await sb.from('leagues').update({ draft_content: null }).eq('tier_index', editingLeague.league.tier_index);
    setEditorBusy(false);
    if (error) { setEditorError('Silinemedi: ' + error.message); return; }
    setEditingLeague(null);
    setLeagueOk('Lig taslağı silindi.');
  }

  if (loadingAuth) return <div className="root wide"><p className="panel-sub">Yükleniyor…</p></div>;

  if (!session) {
    return (
      <div className="root wide">
        <div className="eyebrow">AI Takip Defteri</div>
        <h1>Admin Girişi</h1>
        <div className="panel">
          <label className="field-label">Kullanıcı Adı veya E-posta</label>
          <input type="text" value={loginIdentifier} onChange={(e) => setLoginIdentifier(e.target.value)} />
          <label className="field-label">Şifre</label>
          <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} />
          <button className="btn" onClick={login}>Giriş Yap</button>
          {authError && <div className="error-box">{authError}</div>}
          <p className="panel-sub" style={{ marginTop: 14 }}>Hesabın yoksa önce <Link to="/">ana sayfadan</Link> kayıt ol.</p>
        </div>
      </div>
    );
  }

  if (!profile) return <div className="root wide"><p className="panel-sub">Profil yükleniyor…</p></div>;

  if (!profile.is_admin) {
    return (
      <div className="root wide">
        <div className="eyebrow">AI Takip Defteri</div>
        <h1>Admin Girişi</h1>
        <div className="panel">
          <p className="panel-sub">Bu hesap ({profile.username}) admin yetkisine sahip değil.</p>
          <button className="btn ghost" onClick={logout}>Çıkış Yap</button>
        </div>
      </div>
    );
  }

  return (
    <div className="root wide">
      <div className="eyebrow" style={{ paddingLeft: 46 }}>AI Takip Defteri · {profile.username}</div>
      <h1 style={{ paddingLeft: 46 }}>Admin Paneli</h1>

      <div className="panel">
        <p className="panel-title">Demo ile Test Et</p>
        <p className="panel-sub">Hafta {nextWeekNumber}'yi gerçek link işlemeden, token harcamadan sahte veriyle yayınlar. Kullanıcı panelindeki tüm mekanikleri (quiz, eşleştirme, sayı tahmini, risk, boss) test etmek için kullan.</p>
        <button className="btn ghost" onClick={publishDemoWeek}>Demo Verisiyle Yayınla (token harcamaz)</button>
      </div>

      {!apiKey ? (
        <div className="panel">
          <p className="panel-title">Anthropic API Anahtarı</p>
          <p className="panel-sub">Bu anahtar sadece bu tarayıcı sekmesinde, sayfa kapanana kadar bellekte tutulur (sessionStorage). Veritabanına hiç gitmez.</p>
          <input type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="sk-ant-..." />
          <button className="btn" onClick={saveKey} disabled={!keyDraft.trim()}>Kaydet</button>
        </div>
      ) : (
        <div className="panel">
          <p className="panel-title">Hafta {nextWeekNumber} Oluştur{nextWeekNumber % BOSS_EVERY === 0 ? ' — 👑 BOSS HAFTASI' : ''}</p>
          <p className="panel-sub">Bu haftanın linklerini alt alta yapıştır.</p>
          <label className="field-label">Hafta İsmi</label>
          <input type="text" value={weekLabelDraft} onChange={(e) => setWeekLabelDraft(e.target.value)} placeholder="17-24 Ağustos 2026" />
          <textarea value={linksText} onChange={(e) => setLinksText(e.target.value)} placeholder={'https://...\nhttps://...\nhttps://...'} />
          <button className="btn" onClick={buildWeek} disabled={building || !linksText.trim()}>
            {building ? 'İşleniyor…' : `Hafta ${nextWeekNumber}'yi Yayınla`}
          </button>
          <button className="btn ghost" style={{ marginLeft: 10 }} onClick={() => { sessionStorage.removeItem(APIKEY_SESSION_KEY); setApiKey(''); }}>Anahtarı Kaldır</button>
          {building && <div className="loading-line">{buildStatus}</div>}
          {buildError && <div className="error-box">{buildError}</div>}
          {buildOk && <div className="ok-box">{buildOk}</div>}
        </div>
      )}

      <div className="panel">
        <p className="panel-title">Taslaklar</p>
        <p className="panel-sub">AI tarafından üretilen ama henüz yayınlanmamış haftalar. İnceleyip düzenledikten sonra yayınla.</p>
        {draftWeeks.length === 0 && <p className="panel-sub">Taslak yok.</p>}
        {draftWeeks.map((w) => (
          <div className="week-row" key={w.week_number}>
            <span>{w.week_label || formatWeekRange(w.created_at)} (Hafta {w.week_number}){w.is_boss ? ' 👑' : ''} · {w.week_theme}</span>
            <button className="btn ghost" onClick={() => openWeekEditor(w, 'draft')}>İncele / Düzenle</button>
          </div>
        ))}
      </div>

      <div className="panel">
        <p className="panel-title">Yayınlanan Haftalar</p>
        {pastWeeks.length === 0 && <p className="panel-sub">Henüz hafta yok.</p>}
        {pastWeeks.map((w) => (
          <div className="week-row" key={w.week_number}>
            <span>{w.week_label || formatWeekRange(w.created_at)} (Hafta {w.week_number}){w.is_boss ? ' 👑' : ''} · {w.week_theme}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {new Date(w.created_at).toLocaleDateString('tr-TR')}
              <button className="btn ghost" onClick={() => openWeekEditor(w, 'published')}>Düzenle</button>
            </span>
          </div>
        ))}
      </div>

      {editingWeek && (
        <div className="panel">
          <p className="panel-title">Hafta {editingWeek.week.week_number} {editingWeek.mode === 'draft' ? '(Taslak)' : '(Yayınlandı)'}</p>
          <ContentReviewEditor
            draft={editingWeek.draft}
            onChange={(draft) => setEditingWeek({ ...editingWeek, draft })}
            showWeekFields
            isBoss={editingWeek.week.is_boss}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => saveWeekEditor(false)} disabled={editorBusy}>Kaydet</button>
            {editingWeek.mode === 'draft' && (
              <>
                <button className="btn secondary" onClick={() => saveWeekEditor(true)} disabled={editorBusy}>Yayınla</button>
                <button className="btn danger" onClick={deleteWeekDraft} disabled={editorBusy}>Sil</button>
              </>
            )}
            <button className="btn ghost" onClick={() => setEditingWeek(null)} disabled={editorBusy}>Vazgeç</button>
          </div>
          {editorError && <div className="error-box">{editorError}</div>}
        </div>
      )}

      <div className="panel">
        <p className="panel-title">Demo Ligler</p>
        <p className="panel-sub">Tüm ligler için sahte müfredat yayınlar, token harcamaz — kullanıcı panelindeki lig akışını hemen test etmek için.</p>
        <button className="btn ghost" onClick={publishDemoLeagues} disabled={leagues.length === 0}>Tüm Liglere Demo Müfredat Yayınla</button>
        {leagueError && <div className="error-box">{leagueError}</div>}
        {leagueOk && <div className="ok-box">{leagueOk}</div>}
      </div>

      {apiKey && (
        <div className="panel">
          <p className="panel-title">Lig Müfredatı Oluştur</p>
          <p className="panel-sub">Her lig için bir kere oluşturulan, haftalık değişmeyen sabit içerik. AI çıktısı önce taslak olarak kaydedilir, aşağıdan inceleyip yayınlarsın.</p>
          <label className="field-label">Lig Seç</label>
          <select value={leagueTierChoice} onChange={(e) => setLeagueTierChoice(Number(e.target.value))}
            style={{ width: '100%', background: 'var(--ink)', border: '1px solid var(--hairline)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '12.5px', padding: '12px', marginBottom: 10 }}>
            {leagues.map((l) => (
              <option key={l.tier_index} value={l.tier_index}>{l.name}{l.content ? ' (dolu — üzerine yazılır)' : ' (boş)'}{l.draft_content ? ' [taslak bekliyor]' : ''}</option>
            ))}
          </select>
          <textarea value={leagueLinksText} onChange={(e) => setLeagueLinksText(e.target.value)} placeholder={'https://...\nhttps://...\nhttps://...'} />
          <button className="btn" onClick={buildLeagueContent} disabled={leagueBuilding || !leagueLinksText.trim()}>
            {leagueBuilding ? 'İşleniyor…' : 'Lig Müfredatını Oluştur'}
          </button>
          {leagueBuilding && <div className="loading-line">{leagueStatus}</div>}
          {leagueError && <div className="error-box">{leagueError}</div>}
          {leagueOk && <div className="ok-box">{leagueOk}</div>}
        </div>
      )}

      <div className="panel">
        <p className="panel-title">Lig İçerikleri</p>
        {leagues.length === 0 && <p className="panel-sub">Lig yok.</p>}
        {leagues.map((l) => (
          <div className="week-row" key={l.tier_index}>
            <span>{l.name}{l.content ? ' — dolu' : ' — boş'}{l.draft_content ? ' — taslak bekliyor' : ''}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {l.draft_content && <button className="btn ghost" onClick={() => openLeagueEditor(l, 'draft_content')}>Taslağı İncele</button>}
              {l.content && <button className="btn ghost" onClick={() => openLeagueEditor(l, 'content')}>Düzenle</button>}
            </span>
          </div>
        ))}
      </div>

      {editingLeague && (
        <div className="panel">
          <p className="panel-title">{editingLeague.league.name} {editingLeague.mode === 'draft_content' ? '(Taslak)' : '(Yayınlanan İçerik)'}</p>
          <ContentReviewEditor
            draft={editingLeague.draft}
            onChange={(draft) => setEditingLeague({ ...editingLeague, draft })}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => saveLeagueEditor(false)} disabled={editorBusy}>Kaydet</button>
            {editingLeague.mode === 'draft_content' && (
              <>
                <button className="btn secondary" onClick={() => saveLeagueEditor(true)} disabled={editorBusy}>Yayınla</button>
                <button className="btn danger" onClick={discardLeagueDraft} disabled={editorBusy}>Sil Taslağı</button>
              </>
            )}
            <button className="btn ghost" onClick={() => setEditingLeague(null)} disabled={editorBusy}>Vazgeç</button>
          </div>
          {editorError && <div className="error-box">{editorError}</div>}
        </div>
      )}
    </div>
  );
}
