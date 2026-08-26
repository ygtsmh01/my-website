import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from '../lib/supabase';
import type { League } from '../lib/types';
import ContentReviewEditor, { keyMustReads, keyQuiz, keyCapstone, stripKeys } from '../components/ContentReviewEditor';
import type { ReviewDraft } from '../components/ContentReviewEditor';
import AdminGuard from '../components/AdminGuard';
import { APIKEY_SESSION_KEY } from './Admin';
import { runLeagueGeneration, runUnitRegeneration, useBackgroundTasks } from '../lib/backgroundTasks';

function leagueContentToDraft(c: { must_reads: any[]; quiz: any[]; capstone?: any[] | null } | null): ReviewDraft {
  return {
    must_reads: keyMustReads(c?.must_reads || []),
    quiz: keyQuiz(c?.quiz || []),
    capstone: keyCapstone(c?.capstone || []),
  };
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

  // Kademeler: per-tier expand (settings form)
  const [expandedTierSettings, setExpandedTierSettings] = useState<number | null>(null);

  // Rehberler: per-tier expand
  const [expandedTier, setExpandedTier] = useState<number | null>(null);
  const [leagueLinksText, setLeagueLinksText] = useState('');
  const [leagueError, setLeagueError] = useState('');
  const [leagueOk, setLeagueOk] = useState('');
  const bgTasks = useBackgroundTasks();
  const leagueTasks = bgTasks.filter((t) => t.kind === 'league');
  const anyLeagueRunning = leagueTasks.some((t) => t.status === 'running');

  // Tek Ünite Yenile: per-tier selected unit index + single URL input.
  const unitTasks = bgTasks.filter((t) => t.kind === 'unit');
  const anyUnitRunning = unitTasks.some((t) => t.status === 'running');
  const [unitSourceIndex, setUnitSourceIndex] = useState<Record<number, number>>({});
  const [unitUrlText, setUnitUrlText] = useState<Record<number, string>>({});
  const [unitUrl2Text, setUnitUrl2Text] = useState<Record<number, string>>({});
  const [unitError, setUnitError] = useState<Record<number, string>>({});

  const [editMode, setEditMode] = useState<'draft_content' | 'content' | null>(null);
  const [editDraft, setEditDraft] = useState<ReviewDraft | null>(null);
  const [editorError, setEditorError] = useState('');
  const [editorBusy, setEditorBusy] = useState(false);

  useEffect(() => {
    sb.from('leagues').select('*').order('tier_index', { ascending: true }).then(({ data }) => setLeagues((data as League[]) || []));
  }, [leagueOk, leaguesVersion]);

  // Refetch the leagues list whenever a league generation task reaches
  // 'done', so the new draft content shows up without a manual refresh if
  // the admin happens to be on this page when it finishes. Tracked by id so
  // we don't refetch repeatedly for the same finished task on every render.
  const refetchedForLeagueTask = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const t of leagueTasks) {
      if (t.status === 'done' && !refetchedForLeagueTask.current.has(t.id)) {
        refetchedForLeagueTask.current.add(t.id);
        setLeaguesVersion((v) => v + 1);
      }
    }
  }, [leagueTasks]);

  // Same refetch-on-completion pattern for single-unit regeneration tasks.
  const refetchedForUnitTask = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const t of unitTasks) {
      if (t.status === 'done' && !refetchedForUnitTask.current.has(t.id)) {
        refetchedForUnitTask.current.add(t.id);
        setLeaguesVersion((v) => v + 1);
      }
    }
  }, [unitTasks]);

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

  function buildLeagueContent(l: League) {
    const urls = leagueLinksText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0 || !apiKey) return;
    if (urls.length > 16) { setLeagueError('En fazla 8 ünite (16 link) ekleyebilirsin.'); return; }
    setLeagueError('');
    // Fire-and-forget: runs in the shared background-task store, independent
    // of this component's lifecycle, so it keeps going if the admin navigates
    // away. We just hand it off and clear the input since the request has
    // been successfully handed off.
    void runLeagueGeneration({ urls, apiKey, tierIndex: l.tier_index, leagueName: l.name });
    setLeagueLinksText('');
  }

  // The tier's "current" content for purposes of picking a unit to regenerate:
  // draft_content is preferred when both exist (matches how the rest of this
  // admin surface already treats a draft as the in-progress/current state).
  function authoritativeContent(l: League) {
    return l.draft_content || l.content;
  }

  function regenerateUnit(l: League) {
    const content = authoritativeContent(l);
    const sourceIndex = unitSourceIndex[l.tier_index] ?? 0;
    const url = (unitUrlText[l.tier_index] || '').trim();
    const url2 = (unitUrl2Text[l.tier_index] || '').trim();
    setUnitError((prev) => ({ ...prev, [l.tier_index]: '' }));
    if (!content || !content.must_reads[sourceIndex]) {
      setUnitError((prev) => ({ ...prev, [l.tier_index]: 'Geçerli bir ünite seçilmedi.' }));
      return;
    }
    if (!url) {
      setUnitError((prev) => ({ ...prev, [l.tier_index]: 'Yeni kaynak linki gerekli.' }));
      return;
    }
    if (!apiKey) return;
    // Fire-and-forget, same pattern as buildLeagueContent — survives navigation
    // via the shared background-task store.
    void runUnitRegeneration({
      url,
      url2: url2 || undefined,
      apiKey,
      tierIndex: l.tier_index,
      leagueName: l.name,
      sourceIndex,
      unitTitle: content.must_reads[sourceIndex].title,
      currentContent: content,
    });
    setUnitUrlText((prev) => ({ ...prev, [l.tier_index]: '' }));
    setUnitUrl2Text((prev) => ({ ...prev, [l.tier_index]: '' }));
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
            const isOpen = expandedTierSettings === l.tier_index;
            return (
              <div key={l.tier_index} style={{ marginBottom: 10 }}>
                <div className="week-row" style={{ cursor: 'pointer' }} onClick={() => setExpandedTierSettings(isOpen ? null : l.tier_index)}>
                  <span>{isOpen ? '▾' : '▸'} Kademe {l.tier_index} — {l.name}{l.tagline ? ' — ' + l.tagline : ''}</span>
                </div>
                {isOpen && (
                  <div style={{ border: '1px solid var(--hairline)', padding: 12, marginTop: 8 }}>
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
                )}
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
                    <label className="field-label">Kaynak Linkleri — her ünite için ardışık İKİ link (A, B, A, B, …), en fazla 8 ünite (16 link)</label>
                    <textarea value={leagueLinksText} onChange={(e) => setLeagueLinksText(e.target.value)} placeholder={'https://... (ünite 1 - kaynak A)\nhttps://... (ünite 1 - kaynak B)\nhttps://... (ünite 2 - kaynak A)\nhttps://... (ünite 2 - kaynak B)'} />
                    <button className="btn" onClick={() => buildLeagueContent(l)} disabled={anyLeagueRunning || !leagueLinksText.trim() || !apiKey}>
                      {anyLeagueRunning ? 'İşleniyor…' : 'Rehber Oluştur'}
                    </button>
                    {leagueError && <div className="error-box">{leagueError}</div>}
                    {leagueOk && <div className="ok-box">{leagueOk}</div>}
                    {leagueTasks.filter((t) => t.label === l.name).map((t) => (
                      t.status === 'running'
                        ? <div key={t.id} className="loading-line">{t.message}</div>
                        : t.status === 'error'
                        ? <div key={t.id} className="error-box">{t.message}</div>
                        : <div key={t.id} className="ok-box">{t.message}</div>
                    ))}

                    {authoritativeContent(l) && authoritativeContent(l)!.must_reads.length > 0 && (
                      <div style={{ marginTop: 20 }}>
                        <p className="panel-title" style={{ fontSize: 15 }}>Tek Ünite Yenile</p>
                        <p className="panel-sub">Mevcut rehberdeki tek bir üniteyi, tek bir yeni link ile yenile — diğer üniteler ve bitirme sınavının kalan soruları aynen kalır, sadece bu üniteyi referans alan bitirme soruları yenisiyle değiştirilir.</p>
                        <label className="field-label">Yenilenecek Ünite</label>
                        <select
                          value={unitSourceIndex[l.tier_index] ?? 0}
                          onChange={(e) => setUnitSourceIndex((prev) => ({ ...prev, [l.tier_index]: Number(e.target.value) }))}
                          style={{ width: '100%', background: 'var(--ink)', border: '1px solid var(--hairline)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '12.5px', padding: '12px', marginBottom: 10 }}
                        >
                          {authoritativeContent(l)!.must_reads.map((m, i) => (
                            <option key={i} value={i}>{i}. {m.title || '(başlıksız)'}</option>
                          ))}
                        </select>
                        <label className="field-label">Yeni Kaynak Linki (A)</label>
                        <input
                          type="text"
                          value={unitUrlText[l.tier_index] || ''}
                          onChange={(e) => setUnitUrlText((prev) => ({ ...prev, [l.tier_index]: e.target.value }))}
                          placeholder="https://..."
                        />
                        <label className="field-label">İkinci Kaynak Linki (B, opsiyonel)</label>
                        <input
                          type="text"
                          value={unitUrl2Text[l.tier_index] || ''}
                          onChange={(e) => setUnitUrl2Text((prev) => ({ ...prev, [l.tier_index]: e.target.value }))}
                          placeholder="https://..."
                        />
                        <button className="btn" onClick={() => regenerateUnit(l)} disabled={anyUnitRunning || !(unitUrlText[l.tier_index] || '').trim() || !apiKey}>
                          {anyUnitRunning ? 'İşleniyor…' : 'Üniteyi Yenile'}
                        </button>
                        {unitError[l.tier_index] && <div className="error-box">{unitError[l.tier_index]}</div>}
                        {unitTasks.filter((t) => t.label.startsWith(l.name + ' ·')).map((t) => (
                          t.status === 'running'
                            ? <div key={t.id} className="loading-line">{t.message}</div>
                            : t.status === 'error'
                            ? <div key={t.id} className="error-box">{t.message}</div>
                            : <div key={t.id} className="ok-box">{t.message}</div>
                        ))}
                      </div>
                    )}

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
