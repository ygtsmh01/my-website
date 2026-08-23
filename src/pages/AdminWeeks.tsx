import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from '../lib/supabase';
import type { Week } from '../lib/types';
import ContentReviewEditor, { keyMustReads, keyQuiz, stripKeys } from '../components/ContentReviewEditor';
import type { ReviewDraft } from '../components/ContentReviewEditor';
import AdminGuard from '../components/AdminGuard';
import { APIKEY_SESSION_KEY } from './Admin';

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

async function fetchReadable(url: string) {
  const readerUrl = 'https://r.jina.ai/' + url;
  const res = await fetch(readerUrl);
  if (!res.ok) throw new Error('reader-failed:' + url);
  const text = await res.text();
  return text.slice(0, 6000);
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

type SubTab = 'create' | 'drafts' | 'published';

function AdminWeeksContent() {
  const [apiKey] = useState(() => sessionStorage.getItem(APIKEY_SESSION_KEY) || '');
  const [subTab, setSubTab] = useState<SubTab>('create');

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

  // Inline expand-in-place editor state, keyed by week_number.
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ReviewDraft | null>(null);
  const [editorError, setEditorError] = useState('');
  const [editorBusy, setEditorBusy] = useState(false);

  useEffect(() => {
    sb.from('weeks').select('*').order('week_number', { ascending: false })
      .then(({ data }) => {
        const all = (data as Week[]) || [];
        setPastWeeks(all.filter((w) => w.status === 'published'));
        setDraftWeeks(all.filter((w) => w.status === 'draft'));
        setNextWeekNumber(all.length > 0 ? Math.max(...all.map((w) => w.week_number)) + 1 : 1);
      });
  }, [buildOk, weeksVersion]);

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

  function toggleWeek(w: Week) {
    if (expandedWeek === w.week_number) {
      setExpandedWeek(null);
      setEditDraft(null);
      return;
    }
    setEditorError('');
    setExpandedWeek(w.week_number);
    setEditDraft(weekToDraft(w));
  }

  async function saveWeekEditor(w: Week, publish: boolean) {
    if (!editDraft) return;
    setEditorBusy(true);
    setEditorError('');
    const clean = stripKeys(editDraft);
    const payload: any = {
      week_theme: editDraft.week_theme ?? null,
      week_label: editDraft.week_label ?? null,
      must_reads: clean.must_reads,
      quiz: clean.quiz,
      number_challenge: editDraft.number_challenge ?? null,
      matching: editDraft.matching ?? null,
      risk_question: editDraft.risk_question ?? null,
      boss_question: editDraft.boss_question ?? null,
    };
    if (publish) payload.status = 'published';
    const { error } = await sb.from('weeks').update(payload).eq('week_number', w.week_number);
    setEditorBusy(false);
    if (error) { setEditorError('Kaydedilemedi: ' + error.message); return; }
    setExpandedWeek(null);
    setEditDraft(null);
    setWeeksVersion((v) => v + 1);
  }

  async function deleteWeekDraft(w: Week) {
    if (!confirm(`Hafta ${w.week_number} taslağını silmek istediğine emin misin?`)) return;
    setEditorBusy(true);
    setEditorError('');
    const { error } = await sb.from('weeks').delete().eq('week_number', w.week_number).eq('status', 'draft');
    setEditorBusy(false);
    if (error) { setEditorError('Silinemedi: ' + error.message); return; }
    setExpandedWeek(null);
    setEditDraft(null);
    setWeeksVersion((v) => v + 1);
  }

  function renderWeekRow(w: Week, mode: 'draft' | 'published') {
    const isOpen = expandedWeek === w.week_number;
    return (
      <div key={w.week_number} style={{ marginBottom: 10 }}>
        <div className="week-row" style={{ cursor: 'pointer' }} onClick={() => toggleWeek(w)}>
          <span>{isOpen ? '▾' : '▸'} {w.week_label || formatWeekRange(w.created_at)} (Hafta {w.week_number}){w.is_boss ? ' 👑' : ''} · {w.week_theme}</span>
          {mode === 'published' && <span>{new Date(w.created_at).toLocaleDateString('tr-TR')}</span>}
        </div>
        {isOpen && editDraft && (
          <div className="panel" style={{ marginTop: 8 }}>
            <ContentReviewEditor
              draft={editDraft}
              onChange={setEditDraft}
              showWeekFields
              isBoss={w.is_boss}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => saveWeekEditor(w, false)} disabled={editorBusy}>Kaydet</button>
              {mode === 'draft' && (
                <>
                  <button className="btn secondary" onClick={() => saveWeekEditor(w, true)} disabled={editorBusy}>Yayınla</button>
                  <button className="btn danger" onClick={() => deleteWeekDraft(w)} disabled={editorBusy}>Sil</button>
                </>
              )}
              <button className="btn ghost" onClick={() => { setExpandedWeek(null); setEditDraft(null); }} disabled={editorBusy}>Vazgeç</button>
            </div>
            {editorError && <div className="error-box">{editorError}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="root wide">
      <div className="eyebrow" style={{ paddingLeft: 46 }}>AI Takip Defteri</div>
      <h1 style={{ paddingLeft: 46 }}>Haftalık İçerik</h1>

      <div className="tabs">
        <button className={subTab === 'create' ? 'btn secondary' : 'btn ghost'} onClick={() => setSubTab('create')}>Hafta Oluştur</button>
        <button className={subTab === 'drafts' ? 'btn secondary' : 'btn ghost'} onClick={() => setSubTab('drafts')}>Taslaklar</button>
        <button className={subTab === 'published' ? 'btn secondary' : 'btn ghost'} onClick={() => setSubTab('published')}>Yayınlanan Haftalar</button>
      </div>

      {subTab === 'create' && (
        <>
          {!apiKey && (
            <div className="panel">
              <p className="panel-sub">API anahtarını önce <Link to="/admin">Admin Paneli sayfasından</Link> gir.</p>
            </div>
          )}
          <div className="panel">
            <p className="panel-title">Hafta {nextWeekNumber} Oluştur{nextWeekNumber % BOSS_EVERY === 0 ? ' — 👑 BOSS HAFTASI' : ''}</p>
            <p className="panel-sub">Bu haftanın linklerini alt alta yapıştır.</p>
            <label className="field-label">Hafta İsmi</label>
            <input type="text" value={weekLabelDraft} onChange={(e) => setWeekLabelDraft(e.target.value)} placeholder="17-24 Ağustos 2026" />
            <textarea value={linksText} onChange={(e) => setLinksText(e.target.value)} placeholder={'https://...\nhttps://...\nhttps://...'} />
            <button className="btn" onClick={buildWeek} disabled={building || !linksText.trim() || !apiKey}>
              {building ? 'İşleniyor…' : `Hafta ${nextWeekNumber}'yi Yayınla`}
            </button>
            {building && <div className="loading-line">{buildStatus}</div>}
            {buildError && <div className="error-box">{buildError}</div>}
            {buildOk && <div className="ok-box">{buildOk}</div>}
          </div>
        </>
      )}

      {subTab === 'drafts' && (
        <div className="panel">
          <p className="panel-title">Taslaklar</p>
          <p className="panel-sub">AI tarafından üretilen ama henüz yayınlanmamış haftalar. İnceleyip düzenledikten sonra yayınla.</p>
          {draftWeeks.length === 0 && <p className="panel-sub">Taslak yok.</p>}
          {draftWeeks.map((w) => renderWeekRow(w, 'draft'))}
        </div>
      )}

      {subTab === 'published' && (
        <div className="panel">
          <p className="panel-title">Yayınlanan Haftalar</p>
          {pastWeeks.length === 0 && <p className="panel-sub">Henüz hafta yok.</p>}
          {pastWeeks.map((w) => renderWeekRow(w, 'published'))}
        </div>
      )}
    </div>
  );
}

export default function AdminWeeks() {
  return (
    <AdminGuard>
      <AdminWeeksContent />
    </AdminGuard>
  );
}
