import type { MustRead, QuizQuestion, NumberChallenge, Matching, RiskOrBossQuestion } from '../lib/types';

// Client-only editing shapes — same fields as the DB types plus a synthetic `_key`
// used for stable React list keys while editing. Strip `_key` before writing back.
export type EditableMustRead = MustRead & { _key: string };
export type EditableQuizQuestion = QuizQuestion & { _key: string };

export interface ReviewDraft {
  must_reads: EditableMustRead[];
  quiz: EditableQuizQuestion[];
  week_theme?: string | null;
  week_label?: string | null;
  number_challenge?: NumberChallenge | null;
  matching?: Matching | null;
  risk_question?: RiskOrBossQuestion | null;
  boss_question?: RiskOrBossQuestion | null;
}

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return 'k' + Date.now() + '_' + keySeq;
}

export function keyMustReads(list: MustRead[]): EditableMustRead[] {
  return list.map((m) => ({ ...m, _key: newKey() }));
}
export function keyQuiz(list: QuizQuestion[]): EditableQuizQuestion[] {
  return list.map((q) => ({ ...q, _key: newKey() }));
}
export function stripKeys(draft: ReviewDraft) {
  return {
    must_reads: draft.must_reads.map(({ _key, ...rest }) => rest),
    quiz: draft.quiz.map(({ _key, ...rest }) => rest),
  };
}

interface Props {
  draft: ReviewDraft;
  onChange: (draft: ReviewDraft) => void;
  showWeekFields?: boolean;
  isBoss?: boolean;
}

export default function ContentReviewEditor({ draft, onChange, showWeekFields, isBoss }: Props) {
  function update(patch: Partial<ReviewDraft>) {
    onChange({ ...draft, ...patch });
  }

  function updateMustRead(key: string, patch: Partial<MustRead>) {
    update({ must_reads: draft.must_reads.map((m) => (m._key === key ? { ...m, ...patch } : m)) });
  }

  function addMustRead() {
    update({ must_reads: [...draft.must_reads, { _key: newKey(), title: '', url: '', summary: '' }] });
  }

  function removeMustRead(key: string) {
    const idx = draft.must_reads.findIndex((m) => m._key === key);
    if (idx === -1) return;
    const must_reads = draft.must_reads.filter((m) => m._key !== key);
    const reindex = (i: number) => (i > idx ? i - 1 : i);
    const quiz = draft.quiz
      .filter((q) => q.source_index !== idx)
      .map((q) => ({ ...q, source_index: reindex(q.source_index) }));
    const matching = draft.matching
      ? {
          pairs: draft.matching.pairs
            .filter((p) => p.source_index !== idx)
            .map((p) => ({ ...p, source_index: reindex(p.source_index) })),
        }
      : draft.matching;
    let number_challenge = draft.number_challenge;
    if (number_challenge) {
      if (number_challenge.source_index === idx) number_challenge = null;
      else number_challenge = { ...number_challenge, source_index: reindex(number_challenge.source_index) };
    }
    update({ must_reads, quiz, matching, number_challenge });
  }

  function updateQuiz(key: string, patch: Partial<QuizQuestion>) {
    update({ quiz: draft.quiz.map((q) => (q._key === key ? { ...q, ...patch } : q)) });
  }

  function updateQuizOption(key: string, optIdx: number, value: string) {
    const q = draft.quiz.find((qq) => qq._key === key);
    if (!q) return;
    const options = q.options.slice();
    options[optIdx] = value;
    updateQuiz(key, { options });
  }

  function addQuizOption(key: string) {
    const q = draft.quiz.find((qq) => qq._key === key);
    if (!q) return;
    updateQuiz(key, { options: [...q.options, ''] });
  }

  function removeQuizOption(key: string, optIdx: number) {
    const q = draft.quiz.find((qq) => qq._key === key);
    if (!q) return;
    const options = q.options.filter((_, i) => i !== optIdx);
    const correct_index = q.correct_index >= options.length ? 0 : q.correct_index === optIdx ? 0 : q.correct_index > optIdx ? q.correct_index - 1 : q.correct_index;
    updateQuiz(key, { options, correct_index });
  }

  function addQuiz() {
    update({
      quiz: [
        ...draft.quiz,
        { _key: newKey(), source_index: 0, type: 'mc', bonus: false, question: '', options: ['', '', ''], correct_index: 0, explanation: '' },
      ],
    });
  }

  function removeQuiz(key: string) {
    update({ quiz: draft.quiz.filter((q) => q._key !== key) });
  }

  return (
    <div>
      <details className="editor-group">
        <summary className="editor-group-summary">📚 Özetler / Kaynaklar</summary>
        <div className="editor-group-body">
      {draft.must_reads.map((m, i) => (
        <div className="editor-subrow" key={m._key}>
          <div className="editor-subrow-head">
            <span className="tag">Kaynak {i}</span>
            <button className="btn ghost" onClick={() => removeMustRead(m._key)}>Kaynağı Sil</button>
          </div>
          <label className="field-label">Başlık</label>
          <input type="text" value={m.title} onChange={(e) => updateMustRead(m._key, { title: e.target.value })} />
          <label className="field-label">URL</label>
          <input type="text" value={m.url || ''} onChange={(e) => updateMustRead(m._key, { url: e.target.value })} />
          <label className="field-label">Özet</label>
          <textarea value={m.summary} onChange={(e) => updateMustRead(m._key, { summary: e.target.value })} />
        </div>
      ))}
      <button className="btn ghost" onClick={addMustRead}>+ Kaynak Ekle</button>
        </div>
      </details>

      <details className="editor-group">
        <summary className="editor-group-summary">❓ Quiz Soruları</summary>
        <div className="editor-group-body">
      {draft.quiz.map((q) => (
        <div className="editor-subrow" key={q._key}>
          <div className="editor-subrow-head">
            <span>
              <span className="tag">Kaynak {q.source_index}</span>
              {q.bonus && <span className="tag bonus">Bonus</span>}
              {q.type === 'tf' && <span className="tag tf">D/Y</span>}
            </span>
            <button className="btn ghost" onClick={() => removeQuiz(q._key)}>Soruyu Sil</button>
          </div>
          <label className="field-label">Kaynak İndeksi</label>
          <select value={q.source_index} onChange={(e) => updateQuiz(q._key, { source_index: Number(e.target.value) })}
            style={{ width: '100%', background: 'var(--ink)', border: '1px solid var(--hairline)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '12.5px', padding: '12px', marginBottom: 10 }}>
            {draft.must_reads.map((m, i) => <option key={m._key} value={i}>{i}. {m.title || '(başlıksız)'}</option>)}
          </select>
          <label className="field-label">Tür</label>
          <select value={q.type} onChange={(e) => updateQuiz(q._key, { type: e.target.value as 'mc' | 'tf' })}
            style={{ width: '100%', background: 'var(--ink)', border: '1px solid var(--hairline)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '12.5px', padding: '12px', marginBottom: 10 }}>
            <option value="mc">Çoktan Seçmeli</option>
            <option value="tf">Doğru/Yanlış</option>
          </select>
          <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={q.bonus} onChange={(e) => updateQuiz(q._key, { bonus: e.target.checked })} style={{ width: 'auto', margin: 0 }} />
            Bonus Soru
          </label>
          <label className="field-label">Soru</label>
          <textarea value={q.question} onChange={(e) => updateQuiz(q._key, { question: e.target.value })} />
          <label className="field-label">Seçenekler (doğru olanı işaretle)</label>
          {q.options.map((opt, oi) => (
            <div key={oi} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input type="radio" name={'correct_' + q._key} checked={q.correct_index === oi} onChange={() => updateQuiz(q._key, { correct_index: oi })} style={{ width: 'auto' }} />
              <input type="text" value={opt} onChange={(e) => updateQuizOption(q._key, oi, e.target.value)} style={{ marginBottom: 0, flex: 1 }} />
              {q.type !== 'tf' && q.options.length > 2 && (
                <button className="btn ghost" onClick={() => removeQuizOption(q._key, oi)}>Sil</button>
              )}
            </div>
          ))}
          {q.type !== 'tf' && <button className="btn ghost" onClick={() => addQuizOption(q._key)}>+ Seçenek</button>}
          <label className="field-label" style={{ marginTop: 10 }}>Açıklama</label>
          <textarea value={q.explanation} onChange={(e) => updateQuiz(q._key, { explanation: e.target.value })} />
        </div>
      ))}
      <button className="btn ghost" onClick={addQuiz}>+ Soru Ekle</button>
        </div>
      </details>

      {showWeekFields && (
        <details className="editor-group">
          <summary className="editor-group-summary">🔢 Ek Sorular</summary>
          <div className="editor-group-body">
          <label className="field-label">Hafta İsmi</label>
          <input type="text" placeholder="17-24 Ağustos 2026" value={draft.week_label || ''} onChange={(e) => update({ week_label: e.target.value })} />
          <label className="field-label">Hafta Teması</label>
          <input type="text" value={draft.week_theme || ''} onChange={(e) => update({ week_theme: e.target.value })} />

          <p className="panel-title" style={{ fontSize: 14, marginTop: 16 }}>Sayı Tahmini</p>
          <div className="editor-subrow">
            <label className="field-label">Kaynak İndeksi</label>
            <select value={draft.number_challenge?.source_index ?? 0}
              onChange={(e) => update({ number_challenge: { ...(draft.number_challenge || { question: '', correct_value: 0, tolerance: 0, explanation: '' }), source_index: Number(e.target.value) } })}
              style={{ width: '100%', background: 'var(--ink)', border: '1px solid var(--hairline)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '12.5px', padding: '12px', marginBottom: 10 }}>
              {draft.must_reads.map((m, i) => <option key={m._key} value={i}>{i}. {m.title || '(başlıksız)'}</option>)}
            </select>
            <label className="field-label">Soru</label>
            <textarea value={draft.number_challenge?.question || ''} onChange={(e) => update({ number_challenge: { ...(draft.number_challenge || { source_index: 0, correct_value: 0, tolerance: 0, explanation: '' }), question: e.target.value } })} />
            <label className="field-label">Doğru Değer</label>
            <input type="number" value={draft.number_challenge?.correct_value ?? 0} onChange={(e) => update({ number_challenge: { ...(draft.number_challenge || { source_index: 0, question: '', tolerance: 0, explanation: '' }), correct_value: Number(e.target.value) } })} />
            <label className="field-label">Tolerans</label>
            <input type="number" value={draft.number_challenge?.tolerance ?? 0} onChange={(e) => update({ number_challenge: { ...(draft.number_challenge || { source_index: 0, question: '', correct_value: 0, explanation: '' }), tolerance: Number(e.target.value) } })} />
            <label className="field-label">Açıklama</label>
            <textarea value={draft.number_challenge?.explanation || ''} onChange={(e) => update({ number_challenge: { ...(draft.number_challenge || { source_index: 0, question: '', correct_value: 0, tolerance: 0 }), explanation: e.target.value } })} />
            <button className="btn ghost" onClick={() => update({ number_challenge: null })}>Sayı Tahminini Kaldır</button>
          </div>

          <p className="panel-title" style={{ fontSize: 14, marginTop: 16 }}>Eşleştirme</p>
          {(draft.matching?.pairs || []).map((p, pi) => (
            <div className="editor-subrow" key={pi}>
              <label className="field-label">Kaynak İndeksi</label>
              <select value={p.source_index} onChange={(e) => {
                const pairs = (draft.matching?.pairs || []).slice();
                pairs[pi] = { ...pairs[pi], source_index: Number(e.target.value) };
                update({ matching: { pairs } });
              }} style={{ width: '100%', background: 'var(--ink)', border: '1px solid var(--hairline)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '12.5px', padding: '12px', marginBottom: 10 }}>
                {draft.must_reads.map((m, i) => <option key={m._key} value={i}>{i}. {m.title || '(başlıksız)'}</option>)}
              </select>
              <label className="field-label">Detay</label>
              <input type="text" value={p.detail} onChange={(e) => {
                const pairs = (draft.matching?.pairs || []).slice();
                pairs[pi] = { ...pairs[pi], detail: e.target.value };
                update({ matching: { pairs } });
              }} />
              <button className="btn ghost" onClick={() => {
                const pairs = (draft.matching?.pairs || []).filter((_, i) => i !== pi);
                update({ matching: { pairs } });
              }}>Eşleştirmeyi Sil</button>
            </div>
          ))}
          <button className="btn ghost" onClick={() => update({ matching: { pairs: [...(draft.matching?.pairs || []), { source_index: 0, detail: '' }] } })}>+ Eşleştirme Ekle</button>

          <p className="panel-title" style={{ fontSize: 14, marginTop: 16 }}>Risk Sorusu</p>
          <RiskEditor value={draft.risk_question || null} onChange={(v) => update({ risk_question: v })} />

          {isBoss && (
            <>
              <p className="panel-title" style={{ fontSize: 14, marginTop: 16 }}>Boss Sorusu</p>
              <RiskEditor value={draft.boss_question || null} onChange={(v) => update({ boss_question: v })} />
            </>
          )}
          </div>
        </details>
      )}
    </div>
  );
}

function RiskEditor({ value, onChange }: { value: RiskOrBossQuestion | null; onChange: (v: RiskOrBossQuestion | null) => void }) {
  const v = value || { question: '', options: ['', '', ''], correct_index: 0, explanation: '' };
  return (
    <div className="editor-subrow">
      <label className="field-label">Soru</label>
      <textarea value={v.question} onChange={(e) => onChange({ ...v, question: e.target.value })} />
      <label className="field-label">Seçenekler (doğru olanı işaretle)</label>
      {v.options.map((opt, oi) => (
        <div key={oi} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input type="radio" name="risk_correct" checked={v.correct_index === oi} onChange={() => onChange({ ...v, correct_index: oi })} style={{ width: 'auto' }} />
          <input type="text" value={opt} onChange={(e) => {
            const options = v.options.slice();
            options[oi] = e.target.value;
            onChange({ ...v, options });
          }} style={{ marginBottom: 0, flex: 1 }} />
          {v.options.length > 2 && (
            <button className="btn ghost" onClick={() => {
              const options = v.options.filter((_, i) => i !== oi);
              const correct_index = v.correct_index === oi ? 0 : v.correct_index > oi ? v.correct_index - 1 : v.correct_index;
              onChange({ ...v, options, correct_index });
            }}>Sil</button>
          )}
        </div>
      ))}
      <button className="btn ghost" onClick={() => onChange({ ...v, options: [...v.options, ''] })}>+ Seçenek</button>
      <label className="field-label" style={{ marginTop: 10 }}>Açıklama</label>
      <textarea value={v.explanation} onChange={(e) => onChange({ ...v, explanation: e.target.value })} />
    </div>
  );
}
