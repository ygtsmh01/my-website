import { sb } from './supabase';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type LiveQuestion = { question: string; options: string[]; correct_index: number; explanation: string };

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

// Mixed pool of weekly + league questions for the given tier, shuffled.
export async function fetchQuestionPool(leagueTier: number): Promise<LiveQuestion[]> {
  // Cap how many past weeks we pull from — the pool (and payload) would otherwise
  // grow without bound as weeks accumulate.
  const { data } = await sb.from('weeks').select('quiz').eq('status', 'published')
    .order('week_number', { ascending: false }).limit(26);
  const all: LiveQuestion[] = [];
  (data || []).forEach((w: any) => {
    (w.quiz || []).forEach((q: any) => {
      all.push({ question: q.question, options: q.options, correct_index: q.correct_index, explanation: q.explanation });
    });
  });
  const { data: league } = await sb.from('leagues').select('content').eq('tier_index', leagueTier).single();
  const leagueContent = (league as any)?.content;
  if (leagueContent && leagueContent.quiz) {
    (leagueContent.quiz || []).forEach((q: any) => {
      all.push({ question: q.question, options: q.options, correct_index: q.correct_index, explanation: q.explanation });
    });
  }
  return shuffle(all);
}

// Creates a live_rooms row, retrying on the rare unique-code collision.
export async function createLiveRoom(opts: {
  mode: 'room' | 'duel';
  hostId: string;
  questions: LiveQuestion[];
  betAmount: number;
  leagueTier: number;
}) {
  let lastError: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    const { data, error } = await sb.from('live_rooms')
      .insert({
        code, mode: opts.mode, host_id: opts.hostId, questions: opts.questions,
        status: 'waiting', bet_amount: opts.betAmount, league_tier: opts.leagueTier,
      })
      .select().single();
    if (!error && data) return { data, error: null as any };
    lastError = error;
    if (error && !String(error.message).toLowerCase().includes('duplicate')) break;
  }
  return { data: null as any, error: lastError };
}
