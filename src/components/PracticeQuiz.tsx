import { useState } from 'react';
import type { LeagueContent, QuizQuestion, CapstoneQuestion } from '../lib/types';

// Deliberately self-contained: no Supabase writes, no XP/progress side effects
// anywhere in this file. Lets a player revisit a league they've already passed
// and re-answer its questions purely for personal practice.
function groupBySource(quiz: QuizQuestion[]): QuizQuestion[][] {
  const map = new Map<number, QuizQuestion[]>();
  for (const q of quiz) {
    if (!map.has(q.source_index)) map.set(q.source_index, []);
    map.get(q.source_index)!.push(q);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, questions]) => questions);
}

type Stage = { label: string; questions: (QuizQuestion | CapstoneQuestion)[] };

export default function PracticeQuiz({ leagueName, content, onClose }: { leagueName: string; content: LeagueContent; onClose: () => void }) {
  const [stages] = useState<Stage[]>(() => [
    ...groupBySource(content.quiz).map((questions, i) => ({ label: `Ünite ${i + 1}`, questions })),
    ...(content.capstone && content.capstone.length > 0 ? [{ label: 'Bitirme Sınavı', questions: content.capstone }] : []),
  ]);
  const [stageIndex, setStageIndex] = useState(0);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});

  const finished = stageIndex >= stages.length;

  if (finished) {
    return (
      <div className="onboarding-overlay">
        <div className="onboarding-card">
          <div className="onboarding-emoji">🎯</div>
          <p className="onboarding-title">Pratik Tamamlandı</p>
          <p className="onboarding-text">{leagueName} rehberini pratik olarak baştan sona çözdün. Bu, XP veya lig ilerlemene hiçbir etki yapmadı — sadece kişisel tekrar içindi.</p>
          <button className="btn secondary" style={{ width: '100%' }} onClick={onClose}>Kapat</button>
        </div>
      </div>
    );
  }

  const stage = stages[stageIndex];
  const q = stage.questions[qIndex];
  const answered = answers[qIndex] !== undefined;
  const isLastQuestionEver = qIndex + 1 >= stage.questions.length && stageIndex + 1 >= stages.length;

  function select(oi: number) {
    if (answered) return;
    setAnswers((prev) => ({ ...prev, [qIndex]: oi }));
  }

  function next() {
    if (qIndex + 1 < stage.questions.length) {
      setQIndex((i) => i + 1);
    } else {
      setStageIndex((i) => i + 1);
      setQIndex(0);
      setAnswers({});
    }
  }

  return (
    <div className="speed-overlay">
      <button className="overlay-close-btn" onClick={onClose}>✕ Pratikten Çık</button>
      <div className="speed-overlay-panel">
        <div className="panel quiz-stage">
          <span className="tag static">🎯 PRATİK MODU · XP KAZANDIRMAZ</span>
          <p className="panel-title" style={{ textAlign: 'center' }}>{leagueName} · {stage.label}</p>
          <div className="quiz-progress">Soru {qIndex + 1} / {stage.questions.length}</div>
          {answered && (
            <div className={'feedback-banner ' + (answers[qIndex] === q.correct_index ? 'correct' : 'wrong')}>
              {answers[qIndex] === q.correct_index ? '🎉 Harika, doğru bildin!' : '💥 Olmadı, bir dahakine!'}
            </div>
          )}
          <div className="quiz-card">
            <div className="quiz-q">{q.question}</div>
            {q.options.map((opt, oi) => {
              let cls = 'quiz-opt opt-' + oi;
              if (answered && oi === q.correct_index) cls += ' correct';
              else if (answered && oi === answers[qIndex]) cls += ' wrong';
              return <button key={oi} className={cls} disabled={answered} onClick={() => select(oi)}>{opt}</button>;
            })}
            {answered && <div className="quiz-explain">{q.explanation}</div>}
          </div>
          {answered && (
            <button className="btn secondary" onClick={next}>{isLastQuestionEver ? 'Pratiği Bitir' : 'Sonraki Soru'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
