import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from '../lib/supabase';
import type { Week } from '../lib/types';
import ContentReviewEditor, { keyMustReads, keyQuiz, stripKeys } from '../components/ContentReviewEditor';
import type { ReviewDraft } from '../components/ContentReviewEditor';
import AdminGuard from '../components/AdminGuard';
import { APIKEY_SESSION_KEY } from './Admin';
import { runWeekGeneration, useBackgroundTasks } from '../lib/backgroundTasks';

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
const BOSS_EVERY = 5;

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
  const [buildError, setBuildError] = useState('');
  const bgTasks = useBackgroundTasks();
  const weekTasks = bgTasks.filter((t) => t.kind === 'week');
  const anyWeekRunning = weekTasks.some((t) => t.status === 'running');
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
  }, [weeksVersion]);

  // Refetch the drafts/published lists whenever a week generation task that
  // was previously running (or unseen) reaches 'done', so the new draft
  // shows up without a manual refresh if the admin happens to be on this
  // page when it finishes. Tracked by id so we don't refetch repeatedly for
  // the same finished task on every render.
  const refetchedForTask = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const t of weekTasks) {
      if (t.status === 'done' && !refetchedForTask.current.has(t.id)) {
        refetchedForTask.current.add(t.id);
        setWeeksVersion((v) => v + 1);
      }
    }
  }, [weekTasks]);

  function buildWeek() {
    const urls = linksText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0 || !apiKey) return;
    if (urls.length > 10) {
      setBuildError(`En fazla 10 link ekleyebilirsin (şu an ${urls.length} tane var).`);
      return;
    }
    setBuildError('');
    const isBossWeek = nextWeekNumber % BOSS_EVERY === 0;
    // Fire-and-forget: the generation runs in the shared background-task
    // store, independent of this component's lifecycle, so it keeps going
    // even if the admin navigates away. We just hand it off and clear the
    // inputs since the request has been successfully handed off.
    void runWeekGeneration({ urls, apiKey, weekLabel: weekLabelDraft, nextWeekNumber, isBossWeek });
    setLinksText('');
    setWeekLabelDraft('');
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
            <button className="btn" onClick={buildWeek} disabled={anyWeekRunning || !linksText.trim() || !apiKey}>
              {anyWeekRunning ? 'İşleniyor…' : `Hafta ${nextWeekNumber}'yi Yayınla`}
            </button>
            {buildError && <div className="error-box">{buildError}</div>}
            {weekTasks.map((t) => (
              t.status === 'running'
                ? <div key={t.id} className="loading-line">{t.label}: {t.message}</div>
                : t.status === 'error'
                ? <div key={t.id} className="error-box">{t.label}: {t.message}</div>
                : <div key={t.id} className="ok-box">{t.label}: {t.message}</div>
            ))}
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
