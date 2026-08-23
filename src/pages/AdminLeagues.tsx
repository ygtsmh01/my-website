import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from '../lib/supabase';
import type { League } from '../lib/types';
import ContentReviewEditor, { keyMustReads, keyQuiz, stripKeys } from '../components/ContentReviewEditor';
import type { ReviewDraft } from '../components/ContentReviewEditor';
import AdminGuard from '../components/AdminGuard';
import { APIKEY_SESSION_KEY } from './Admin';

const MODEL = 'claude-sonnet-5';

async function fetchReadable(url: string) {
  const readerUrl = 'https://r.jina.ai/' + url;
  const res = await fetch(readerUrl);
  if (!res.ok) throw new Error('reader-failed:' + url);
  const text = await res.text();
  return text.slice(0, 6000);
}

function leagueContentToDraft(c: { must_reads: any[]; quiz: any[] } | null): ReviewDraft {
  return { must_reads: keyMustReads(c?.must_reads || []), quiz: keyQuiz(c?.quiz || []) };
}

type SubTab = 'tiers' | 'guides';

function AdminLeaguesContent() {
  const [apiKey] = useState(() => sessionStorage.getItem(APIKEY_SESSION_KEY) || '');
  const [subTab, setSubTab] = useState<SubTab>('tiers');
  const [leagues, setLeagues] = useState<League[]>([]);
  const [leaguesVersion, setLeaguesVersion] = useState(0);

  // Lig kademeleri (tier) yönetimi
  const [tierDrafts, setTierDrafts] = useState<Record<number, { name: string; tagline: string; promote_threshold: string; weekly_multiplier: string }>>({});
  const [tierSaving, setTierSaving] = useState<number | null>(null);
  const [tierError, setTierError] = useState('');
  const [tierOk, setTierOk] = useState('');
  const [newTierName, setNewTierName] = useState('');
  const [newTierTagline, setNewTierTagline] = useState('');
  const [newTierPromote, setNewTierPromote] = useState('');
  const [newTierMultiplier, setNewTierMultiplier] = useState('1');
  const [newTierAdding, setNewTierAdding] = useState(false);

  // Rehberler: per-tier expand
  const [expandedTier, setExpandedTier] = useState<number | null>(null);
  const [leagueLinksText, setLeagueLinksText] = useState('');
  const [leagueBuilding, setLeagueBuilding] = useState(false);
  const [leagueStatus, setLeagueStatus] = useState('');
  const [leagueError, setLeagueError] = useState('');
  const [leagueOk, setLeagueOk] = useState('');

  const [editMode, setEditMode] = useState<'draft_content' | 'content' | null>(null);
  const [editDraft, setEditDraft] = useState<ReviewDraft | null>(null);
  const [editorError, setEditorError] = useState('');
  const [editorBusy, setEditorBusy] = useState(false);

  useEffect(() => {
    sb.from('leagues').select('*').order('tier_index', { ascending: true }).then(({ data }) => setLeagues((data as League[]) || []));
  }, [leagueOk, leaguesVersion]);

  useEffect(() => {
    setTierDrafts((prev) => {
      const next = { ...prev };
      for (const l of leagues) {
        if (!next[l.tier_index]) {
          next[l.tier_index] = {
            name: l.name,
            tagline: l.tagline || '',
            promote_threshold: l.promote_threshold === null || l.promote_threshold === undefined ? '' : String(l.promote_threshold),
            weekly_multiplier: String(l.weekly_multiplier),
          };
        }
      }
      return next;
    });
  }, [leagues]);

  function updateTierDraftField(tierIndex: number, field: 'name' | 'tagline' | 'promote_threshold' | 'weekly_multiplier', value: string) {
    setTierDrafts((prev) => ({ ...prev, [tierIndex]: { ...prev[tierIndex], [field]: value } }));
  }

  async function saveTier(tierIndex: number) {
    const draft = tierDrafts[tierIndex];
    if (!draft) return;
    setTierError(''); setTierOk('');
    if (!draft.name.trim()) { setTierError('Kademe adı boş olamaz.'); return; }
    const multiplier = Number(draft.weekly_multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) { setTierError('Haftalık çarpan geçerli bir sayı olmalı.'); return; }
    let promoteThreshold: number | null = null;
    if (draft.promote_threshold.trim() !== '') {
      const n = Number(draft.promote_threshold);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) { setTierError('Yükselme eşiği boş bırakılabilir ya da geçerli bir tam sayı olmalı.'); return; }
      promoteThreshold = n;
    }
    setTierSaving(tierIndex);
    const { error } = await sb.from('leagues').update({
      name: draft.name.trim(),
      tagline: draft.tagline.trim() || null,
      promote_threshold: promoteThreshold,
      weekly_multiplier: multiplier,
    }).eq('tier_index', tierIndex);
    setTierSaving(null);
    if (error) { setTierError('Kaydedilemedi: ' + error.message); return; }
    setTierOk(`${draft.name} kaydedildi.`);
    setLeaguesVersion((v) => v + 1);
  }

  async function addTier() {
    setTierError(''); setTierOk('');
    if (!newTierName.trim()) { setTierError('Yeni kademe için isim gerekli.'); return; }
    const multiplier = Number(newTierMultiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) { setTierError('Haftalık çarpan geçerli bir sayı olmalı.'); return; }
    let promoteThreshold: number | null = null;
    if (newTierPromote.trim() !== '') {
      const n = Number(newTierPromote);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) { setTierError('Yükselme eşiği boş bırakılabilir ya da geçerli bir tam sayı olmalı.'); return; }
      promoteThreshold = n;
    }
    const nextTierIndex = leagues.length > 0 ? Math.max(...leagues.map((l) => l.tier_index)) + 1 : 0;
    setNewTierAdding(true);
    const { error } = await sb.from('leagues').insert({
      tier_index: nextTierIndex,
      name: newTierName.trim(),
      tagline: newTierTagline.trim() || null,
      promote_threshold: promoteThreshold,
      weekly_multiplier: multiplier,
      content: null,
      draft_content: null,
    });
    setNewTierAdding(false);
    if (error) { setTierError('Kademe eklenemedi: ' + error.message); return; }
    setTierOk(`"${newTierName.trim()}" kademesi eklendi (kademe sırası ${nextTierIndex}).`);
    setNewTierName(''); setNewTierTagline(''); setNewTierPromote(''); setNewTierMultiplier('1');
    setLeaguesVersion((v) => v + 1);
  }

  function toggleTier(l: League) {
    if (expandedTier === l.tier_index) {
      setExpandedTier(null);
      setEditMode(null);
      setEditDraft(null);
      return;
    }
    setExpandedTier(l.tier_index);
    setLeagueLinksText('');
    setLeagueError(''); setLeagueOk('');
    setEditorError('');
    if (l.draft_content) {
      setEditMode('draft_content');
      setEditDraft(leagueContentToDraft(l.draft_content));
    } else if (l.content) {
      setEditMode('content');
      setEditDraft(leagueContentToDraft(l.content));
    } else {
      setEditMode(null);
      setEditDraft(null);
    }
  }

  async function buildLeagueContent(l: League) {
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

    const leagueName = l.name;
    setLeagueStatus('Rehber hazırlanıyor…');
    try {
      const prompt = `Aşağıda "${leagueName}" ligi için TEMEL/SABİT bir rehber oluşturacak kaynakların ham metni var, her biri "--- Kaynak N: url ---" başlığıyla ayrılmış. Bu içerik bir kere oluşturulacak ve değişmeyecek (haftalık değil). Bunları işleyip SADECE aşağıdaki şemaya uyan geçerli JSON döndür, başka açıklama, markdown işareti ekleme:

{
  "must_reads": [ { "title": "başlık", "url": "kaynağın orijinal linki", "summary": "4-6 cümlelik, doğrudan bilgi aktaran ders notu" } ],
  "quiz": [ { "source_index": 0, "type": "mc", "bonus": false, "question": "soru metni", "options": ["seçenek1","seçenek2","seçenek3"], "correct_index": 0, "explanation": "kısa açıklama" } ]
}

Kurallar:
- Her kaynak için bir must_reads öğesi oluştur (sırasıyla index 0,1,2,...).
- "summary" alanı bir "makale tanıtımı" DEĞİL, doğrudan bilgi aktaran bir ders notu olmalı — kaynağı okumadan da o bilgiye sahip olacak şekilde yaz. "Bu makale ... anlatıyor", "Yazar ... belirtiyor" gibi meta-anlatım KULLANMA; doğrudan olguyu, kavramı, sonucu ver. ODAK NOKTASI SAYILAR/İSTATİSTİKLER DEĞİL, ANLAM olmalı: bu kavram neden önemli, ne işe yarar, nasıl kullanılır — bunları öne çıkar. Bir rakam gerçekten konunun özüyse geçebilir, ama özeti bir rakam listesine indirgeme.
- Her kaynak için quiz'de "source_index" o kaynağın must_reads içindeki index'ine eşit olan tam olarak 4 soru olsun:
  - 2 tanesi "type": "mc", "bonus": false — cevabı summary'den çıkarılabilecek, genel anlama soruları, farklı yönlere odaklansın, 3 seçenekli.
  - 1 tanesi "type": "tf", "bonus": true — Doğru/Yanlış formatında bir ifade, SADECE kaynağın tam metnindeki spesifik bir detaya dayanmalı, summary'den cevaplanamamalı; "options" tam olarak ["Doğru","Yanlış"] olmalı, "correct_index" 0 (Doğru) veya 1 (Yanlış).
  - 1 tanesi "type": "mc", "bonus": true — yine kaynağın tam metnindeki bir detaya dayanmalı, summary'den cevaplanamamalı, 3 seçenekli.
- SORU KALİTESİ — ÇOK ÖNEMLİ, kesinlikle uy: Bu bir bilgi yarışması/trivia sınavı DEĞİL, okuyucunun konuyu gerçekten ANLAYIP ANLAMADIĞINI ölçen bir sınav. Şunları KESİNLİKLE YAPMA:
  - Bir sayıyı/istatistiği/ismi/tarihi ezberden sorma (örn. "X ne kadardı?", "Y kaç kişiydi?") — bu bir kalıcı rehber, güncel bir sayıya dayanmak zaten yanlış olur.
  - Birbiriyle ilgisiz 2-3 olguyu yan yana koyup "aşağıdakilerden hangisi doğrudur?" diye sorma — bu şans/ezber sorusu üretir, anlama ölçmez.
  Bunun yerine şu kalıplarda sorular kur: "Bu neden önemli?", "Bu iki kavram arasındaki ilişki/fark nedir?", "Bu, [ilgili kavram] açısından ne ifade eder?", "Bu bilgiye göre en olası sonuç/uygulama nedir?" — yani NEDEN, SONUÇ, ÖNEM veya İLİŞKİ soran, o seviyeye özgü kavramsal anlayışı test eden sorular. Yanlış şıklar rastgele değil, konuyu yüzeysel anlayan birinin makul şekilde seçebileceği çeldiriciler olsun.
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

      const { error: updateError } = await sb.from('leagues').update({ draft_content: parsed }).eq('tier_index', l.tier_index);
      if (updateError) throw new Error('Veritabanına yazılamadı: ' + updateError.message);

      setLeagueOk(`${leagueName} rehberi taslak olarak kaydedildi. Aşağıdan inceleyip yayınlayabilirsin.`);
      setLeagueLinksText('');
      setLeaguesVersion((v) => v + 1);
      setEditMode('draft_content');
      setEditDraft(leagueContentToDraft(parsed));
    } catch (e: any) {
      setLeagueError('Rehber işlenirken bir sorun oldu: ' + e.message);
    } finally {
      setLeagueBuilding(false);
      setLeagueStatus('');
    }
  }

  async function saveLeagueEditor(l: League, publish: boolean) {
    if (!editDraft || !editMode) return;
    setEditorBusy(true);
    setEditorError('');
    const clean = stripKeys(editDraft);
    if (publish) {
      const { error } = await sb.from('leagues').update({ content: clean, draft_content: null }).eq('tier_index', l.tier_index);
      setEditorBusy(false);
      if (error) { setEditorError('Yayınlanamadı: ' + error.message); return; }
    } else {
      const field = editMode === 'draft_content' ? 'draft_content' : 'content';
      const { error } = await sb.from('leagues').update({ [field]: clean }).eq('tier_index', l.tier_index);
      setEditorBusy(false);
      if (error) { setEditorError('Kaydedilemedi: ' + error.message); return; }
    }
    setExpandedTier(null);
    setEditMode(null);
    setEditDraft(null);
    setLeagueOk('Lig içeriği güncellendi.');
    setLeaguesVersion((v) => v + 1);
  }

  async function discardLeagueDraft(l: League) {
    if (!confirm(`${l.name} taslağını silmek istediğine emin misin?`)) return;
    setEditorBusy(true);
    setEditorError('');
    const { error } = await sb.from('leagues').update({ draft_content: null }).eq('tier_index', l.tier_index);
    setEditorBusy(false);
    if (error) { setEditorError('Silinemedi: ' + error.message); return; }
    setEditMode(null);
    setEditDraft(null);
    setLeagueOk('Lig taslağı silindi.');
    setLeaguesVersion((v) => v + 1);
  }

  function tierStatusBadge(l: League) {
    if (l.content) return ' — dolu (üzerine yazılır)';
    if (l.draft_content) return ' — taslak bekliyor';
    return ' — boş';
  }

  return (
    <div className="root wide">
      <div className="eyebrow" style={{ paddingLeft: 46 }}>AI Takip Defteri</div>
      <h1 style={{ paddingLeft: 46 }}>Lig Yönetimi</h1>

      <div className="tabs">
        <button className={subTab === 'tiers' ? 'btn secondary' : 'btn ghost'} onClick={() => setSubTab('tiers')}>Kademeler</button>
        <button className={subTab === 'guides' ? 'btn secondary' : 'btn ghost'} onClick={() => setSubTab('guides')}>Rehberler</button>
      </div>

      {subTab === 'tiers' && (
        <div className="panel">
          <p className="panel-title">Lig Kademeleri</p>
          <p className="panel-sub">Mevcut kademelerin adını, alt başlığını, yükselme eşiğini ve haftalık çarpanını düzenle, ya da en üste yeni bir kademe ekle. Sıralamayı bozmamak için kademe silinemez/yeniden sıralanamaz — sadece yeniden adlandırma ve ekleme yapılabilir.</p>
          {leagues.map((l) => {
            const d = tierDrafts[l.tier_index] || { name: l.name, tagline: l.tagline || '', promote_threshold: l.promote_threshold === null ? '' : String(l.promote_threshold), weekly_multiplier: String(l.weekly_multiplier) };
            return (
              <div key={l.tier_index} style={{ border: '1px solid var(--hairline)', padding: 12, marginBottom: 10 }}>
                <p className="field-label">Kademe {l.tier_index} — {l.name}</p>
                <label className="field-label">Ad</label>
                <input type="text" value={d.name} onChange={(e) => updateTierDraftField(l.tier_index, 'name', e.target.value)} />
                <label className="field-label">Alt Başlık (tagline)</label>
                <input type="text" value={d.tagline} onChange={(e) => updateTierDraftField(l.tier_index, 'tagline', e.target.value)} placeholder="Örn: AI gündemini sıkı takip eden" />
                <label className="field-label">Yükselme Eşiği (boş = en üst kademe)</label>
                <input type="text" inputMode="numeric" value={d.promote_threshold} onChange={(e) => updateTierDraftField(l.tier_index, 'promote_threshold', e.target.value)} placeholder="Örn: 500" />
                <label className="field-label">Haftalık Çarpan</label>
                <input type="text" inputMode="decimal" value={d.weekly_multiplier} onChange={(e) => updateTierDraftField(l.tier_index, 'weekly_multiplier', e.target.value)} />
                <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => saveTier(l.tier_index)} disabled={tierSaving === l.tier_index}>
                  {tierSaving === l.tier_index ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
              </div>
            );
          })}

          <p className="field-label" style={{ marginTop: 18 }}>Yeni Kademe Ekle (kademe sırası {leagues.length > 0 ? Math.max(...leagues.map((l) => l.tier_index)) + 1 : 0})</p>
          <label className="field-label">Ad</label>
          <input type="text" value={newTierName} onChange={(e) => setNewTierName(e.target.value)} placeholder="Örn: Efsane Ligi" />
          <label className="field-label">Alt Başlık (tagline)</label>
          <input type="text" value={newTierTagline} onChange={(e) => setNewTierTagline(e.target.value)} placeholder="Örn: AI gündemini sıkı takip eden" />
          <label className="field-label">Yükselme Eşiği (boş = en üst kademe)</label>
          <input type="text" inputMode="numeric" value={newTierPromote} onChange={(e) => setNewTierPromote(e.target.value)} placeholder="Örn: 500" />
          <label className="field-label">Haftalık Çarpan</label>
          <input type="text" inputMode="decimal" value={newTierMultiplier} onChange={(e) => setNewTierMultiplier(e.target.value)} />
          <button className="btn" style={{ marginTop: 10 }} onClick={addTier} disabled={newTierAdding || !newTierName.trim()}>
            {newTierAdding ? 'Ekleniyor…' : 'Kademe Ekle'}
          </button>
          {tierError && <div className="error-box">{tierError}</div>}
          {tierOk && <div className="ok-box">{tierOk}</div>}
        </div>
      )}

      {subTab === 'guides' && (
        <div className="panel">
          <p className="panel-title">Lig Rehberleri</p>
          <p className="panel-sub">Her lig için bir kere oluşturulan, haftalık değişmeyen sabit içerik. Bir kademeye tıklayınca kaynak linklerini girip rehberi doğrudan o kademe için oluşturabilir, ardından inceleyip yayınlayabilirsin.</p>
          {!apiKey && (
            <p className="panel-sub">API anahtarını önce <Link to="/admin">Admin Paneli sayfasından</Link> gir — anahtar yoksa yeni rehber oluşturulamaz, ama mevcut içerik/taslak yine düzenlenebilir.</p>
          )}
          {leagues.length === 0 && <p className="panel-sub">Lig yok.</p>}
          {leagues.map((l) => {
            const isOpen = expandedTier === l.tier_index;
            return (
              <div key={l.tier_index} style={{ marginBottom: 10 }}>
                <div className="week-row" style={{ cursor: 'pointer' }} onClick={() => toggleTier(l)}>
                  <span>{isOpen ? '▾' : '▸'} {l.name}{l.tagline ? ' — ' + l.tagline : ''}</span>
                  <span>{tierStatusBadge(l)}</span>
                </div>
                {isOpen && (
                  <div className="panel" style={{ marginTop: 8 }}>
                    <p className="panel-title" style={{ fontSize: 15 }}>Rehber Oluştur</p>
                    <label className="field-label">Kaynak Linkleri (en fazla 6)</label>
                    <textarea value={leagueLinksText} onChange={(e) => setLeagueLinksText(e.target.value)} placeholder={'https://...\nhttps://...\nhttps://...'} />
                    <button className="btn" onClick={() => buildLeagueContent(l)} disabled={leagueBuilding || !leagueLinksText.trim() || !apiKey}>
                      {leagueBuilding ? 'İşleniyor…' : 'Rehber Oluştur'}
                    </button>
                    {leagueBuilding && <div className="loading-line">{leagueStatus}</div>}
                    {leagueError && <div className="error-box">{leagueError}</div>}
                    {leagueOk && <div className="ok-box">{leagueOk}</div>}

                    {editDraft && editMode && (
                      <>
                        <p className="panel-title" style={{ fontSize: 15, marginTop: 20 }}>
                          {editMode === 'draft_content' ? 'Taslak İnceleme' : 'Yayınlanan İçerik'}
                        </p>
                        <ContentReviewEditor draft={editDraft} onChange={setEditDraft} />
                        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                          <button className="btn" onClick={() => saveLeagueEditor(l, false)} disabled={editorBusy}>Kaydet</button>
                          {editMode === 'draft_content' && (
                            <>
                              <button className="btn secondary" onClick={() => saveLeagueEditor(l, true)} disabled={editorBusy}>Yayınla</button>
                              <button className="btn danger" onClick={() => discardLeagueDraft(l)} disabled={editorBusy}>Sil Taslağı</button>
                            </>
                          )}
                        </div>
                        {editorError && <div className="error-box">{editorError}</div>}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminLeagues() {
  return (
    <AdminGuard>
      <AdminLeaguesContent />
    </AdminGuard>
  );
}
