// Pragmatic hand-written types for Supabase rows. Loosely typed on purpose —
// JSONB payload shapes (quiz, must_reads, etc.) mirror admin.html's generation schema.

export interface MustRead {
  title: string;
  url?: string;
  // Second source for a unit built from two combined sources (curriculum
  // guides only — weekly must_reads never set this). Absent on older,
  // single-source content.
  url2?: string;
  summary: string;
}

export interface QuizQuestion {
  source_index: number;
  type: 'mc' | 'tf';
  bonus: boolean;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface NumberChallenge {
  source_index: number;
  question: string;
  correct_value: number;
  tolerance: number;
  explanation: string;
}

export interface MatchingPair {
  source_index: number;
  detail: string;
}

export interface Matching {
  pairs: MatchingPair[];
}

export interface RiskOrBossQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface CapstoneQuestion extends RiskOrBossQuestion {
  // Which units (source_index values into the league's must_reads/quiz) this
  // synthesis question draws on — lets the admin panel show, and lets a
  // single-unit regeneration surgically drop only the capstone questions that
  // reference the unit being replaced, without touching the rest.
  source_indices: number[];
}

export interface Week {
  week_number: number;
  week_theme: string | null;
  week_label: string | null;
  must_reads: MustRead[];
  quiz: QuizQuestion[];
  number_challenge: NumberChallenge | null;
  matching: Matching | null;
  risk_question: RiskOrBossQuestion | null;
  boss_question: RiskOrBossQuestion | null;
  is_boss: boolean;
  created_at: string;
  status: 'draft' | 'published';
}

export interface Profile {
  id: string;
  username: string;
  total_xp: number;
  streak: number;
  freezes: number;
  last_week_number: number;
  is_admin: boolean;
  avatar: string;
  marketing_consent?: boolean;
  league_tier: number;
  league_success_streak: number;
  league_miss_streak: number;
  league_streak_week_number: number;
  created_at: string;
}

export interface LeagueContent {
  must_reads: MustRead[];
  quiz: QuizQuestion[];
  // Synthesis questions spanning multiple sources, for the capstone exam that
  // finishes the tier's "academy" lesson path. Absent/null on older content
  // generated before this field existed — the player-side flow must fall back
  // gracefully (e.g. a mixed-question capstone) when this is missing.
  capstone: CapstoneQuestion[] | null;
}

export interface League {
  tier_index: number;
  name: string;
  tagline: string | null;
  promote_threshold: number | null;
  weekly_multiplier: number;
  content: LeagueContent | null;
  draft_content: LeagueContent | null;
  created_at: string;
}

export interface LeagueProgress {
  user_id: string;
  tier_index: number;
  completed: boolean;
  quiz_score: number;
  quiz_total: number;
  completed_at: string | null;
}

export interface HistoryRow {
  id: number;
  user_id: string;
  week_number: number;
  date: string;
  xp_earned: number;
  quiz_score: number;
  quiz_total: number;
  week_theme: string | null;
  critical: boolean;
  risk_won: boolean | null;
  boss_cleared: boolean;
  frozen: boolean;
  created_at: string;
}

export interface LiveRoom {
  id: string;
  code: string;
  mode: 'room' | 'duel';
  host_id: string;
  status: 'waiting' | 'active' | 'finished';
  questions: Array<{ question: string; options: string[]; correct_index: number; explanation: string }>;
  current_question_index: number;
  question_started_at: string | null;
  bet_amount: number;
  league_tier: number;
  created_at: string;
}

export interface LiveParticipant {
  id: number;
  room_id: string;
  user_id: string;
  username: string;
  avatar: string;
  score: number;
  xp_awarded: boolean;
  league_tier: number;
  joined_at: string;
}

export interface Feedback {
  id: number;
  user_id: string;
  category: 'general' | 'content_suggestion';
  message: string;
  status: 'new' | 'reviewed' | 'resolved';
  created_at: string;
}
