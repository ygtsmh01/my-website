import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { sb } from './supabase';
import { createLiveRoom, fetchQuestionPool } from './liveQuestions';
import type { LiveRoom, Profile } from './types';

// Public "Hızlı Eşleş" queue for Canlı Yarışma. No friend code: anyone who taps
// join lands in a shared Realtime Presence channel; once at least MIN players are
// waiting the game auto-starts (immediately at TARGET, otherwise after a short
// grace window so latecomers can still get in). One player — deterministically
// the earliest to join — acts as the matcher: creates the room, broadcasts it,
// and flips it to active. Everyone else just waits for that broadcast. No table,
// no migration; it rides the realtime infra that's already in place.
const CHANNEL = 'aitakip-matchmaking';
const MIN_PLAYERS = 2;
const TARGET_PLAYERS = 4;
const GRACE_MS = 18000;
const ROOM_CAP = 8;
const START_DELAY_MS = 5000;

type Member = { id: string; username: string; avatar: string; league_tier: number; joined_at: number };

export type QuickMatchStatus = 'idle' | 'queued' | 'starting' | 'matched' | 'error';

export interface QuickMatch {
  status: QuickMatchStatus;
  waiting: number;
  startsInMs: number | null;
  room: LiveRoom | null;
  error: string;
  join: () => void;
  cancel: () => void;
}

export function useQuickMatch(profile: Profile | null): QuickMatch {
  const [status, setStatus] = useState<QuickMatchStatus>('idle');
  const [waiting, setWaiting] = useState(0);
  const [startsInMs, setStartsInMs] = useState<number | null>(null);
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [error, setError] = useState('');

  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const membersRef = useRef<Member[]>([]);
  const firedRef = useRef(false);
  const handledMatchRef = useRef(false);
  const joinedAtRef = useRef(0);

  const teardown = useCallback(() => {
    if (channelRef.current) {
      sb.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    membersRef.current = [];
    firedRef.current = false;
  }, []);

  const cancel = useCallback(() => {
    teardown();
    handledMatchRef.current = false;
    setStatus('idle');
    setWaiting(0);
    setStartsInMs(null);
    setRoom(null);
    setError('');
  }, [teardown]);

  useEffect(() => () => teardown(), [teardown]);

  // Once a match broadcast names us, join the room as our own participant row
  // (RLS only lets each user insert their own) and surface the room.
  const onMatched = useCallback(async (roomId: string) => {
    if (handledMatchRef.current) return;
    handledMatchRef.current = true;
    const p = profileRef.current;
    if (!p) return;
    const { data: r } = await sb.from('live_rooms').select('*').eq('id', roomId).single();
    if (!r) { handledMatchRef.current = false; return; }
    const { error: joinErr } = await sb.from('live_participants').insert({
      room_id: roomId, user_id: p.id, username: p.username, avatar: p.avatar, league_tier: p.league_tier,
    });
    if (joinErr && !String(joinErr.message).toLowerCase().includes('duplicate')) {
      setError('Odaya katılınamadı: ' + joinErr.message);
      setStatus('error');
      teardown();
      return;
    }
    teardown();
    setRoom(r as LiveRoom);
    setStatus('matched');
  }, [teardown]);

  // Matcher only: build the room, tell everyone, then start it.
  const runMatch = useCallback(async (chosen: Member[]) => {
    const p = profileRef.current;
    const channel = channelRef.current;
    if (!p || !channel) return;
    const pool = await fetchQuestionPool(p.league_tier);
    if (pool.length < 4) {
      channel.send({ type: 'broadcast', event: 'qm-abort', payload: { reason: 'Yeterli soru havuzu yok.' } });
      setError('Yeterli soru havuzu yok, birkaç hafta yayınlanmış olmalı.');
      setStatus('error');
      teardown();
      return;
    }
    if (!channelRef.current) return; // user bailed out of the queue while we were fetching
    const questions = pool.slice(0, Math.min(12, pool.length));
    const { data: newRoom, error: roomErr } = await createLiveRoom({
      mode: 'room', hostId: p.id, questions, betAmount: 0, leagueTier: p.league_tier,
    });
    if (roomErr || !newRoom) {
      channel.send({ type: 'broadcast', event: 'qm-abort', payload: { reason: 'Oda oluşturulamadı.' } });
      setError('Oda oluşturulamadı: ' + (roomErr?.message || 'bilinmeyen hata'));
      setStatus('error');
      teardown();
      return;
    }
    const memberIds = chosen.map((m) => m.id);
    channel.send({ type: 'broadcast', event: 'qm-matched', payload: { roomId: newRoom.id, memberIds } });
    // Also stamp it into presence so a client that missed the broadcast still finds it on the next sync.
    channel.track({ ...myPresence(p), room_id: newRoom.id });
    await onMatched(newRoom.id);

    // Give the others a moment to insert their participant rows, then start —
    // or abandon the room if nobody else actually made it in.
    setTimeout(async () => {
      const { count } = await sb.from('live_participants').select('*', { count: 'exact', head: true }).eq('room_id', newRoom.id);
      if ((count || 0) >= MIN_PLAYERS) {
        await sb.from('live_rooms').update({
          status: 'active', current_question_index: 0, question_started_at: new Date().toISOString(),
        }).eq('id', newRoom.id).eq('status', 'waiting');
      } else {
        await sb.from('live_rooms').update({ status: 'finished' }).eq('id', newRoom.id);
      }
    }, START_DELAY_MS);
  }, [onMatched, teardown]);

  const join = useCallback(() => {
    const p = profileRef.current;
    if (!p || channelRef.current) return;
    handledMatchRef.current = false;
    firedRef.current = false;
    joinedAtRef.current = Date.now();
    setError('');
    setRoom(null);
    setStatus('queued');
    setWaiting(1);

    const channel = sb.channel(CHANNEL, { config: { presence: { key: p.id }, broadcast: { self: true } } });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, any[]>;
        const members: Member[] = [];
        for (const key of Object.keys(state)) {
          const meta = state[key][0] || {};
          members.push({
            id: key,
            username: meta.username || '?',
            avatar: meta.avatar || '🙂',
            league_tier: meta.league_tier ?? 0,
            joined_at: meta.joined_at || Date.now(),
          });
          if (meta.room_id && key === p.id) onMatched(meta.room_id);
        }
        members.sort((a, b) => a.joined_at - b.joined_at || (a.id < b.id ? -1 : 1));
        membersRef.current = members;
        setWaiting(members.length);
      })
      .on('broadcast', { event: 'qm-matched' }, ({ payload }) => {
        if (payload?.memberIds?.includes(p.id)) onMatched(payload.roomId);
      })
      .on('broadcast', { event: 'qm-abort' }, ({ payload }) => {
        if (handledMatchRef.current) return;
        setError(payload?.reason || 'Eşleşme iptal edildi.');
        setStatus('error');
        teardown();
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') channel.track(myPresence(p));
      });
  }, [onMatched, teardown]);

  // Drives the countdown and fires the matcher when the window elapses.
  useEffect(() => {
    if (status !== 'queued' && status !== 'starting') return;
    const iv = setInterval(() => {
      const p = profileRef.current;
      if (!p) return;
      const members = membersRef.current;
      const n = members.length;
      if (n < MIN_PLAYERS) {
        setStatus('queued');
        setStartsInMs(null);
        return;
      }
      const oldest = members[0]?.joined_at ?? joinedAtRef.current;
      const fireAt = n >= TARGET_PLAYERS ? Date.now() : oldest + GRACE_MS;
      const remaining = Math.max(0, fireAt - Date.now());
      setStatus('starting');
      setStartsInMs(remaining);
      if (remaining <= 0 && !firedRef.current && members[0]?.id === p.id) {
        firedRef.current = true;
        runMatch(members.slice(0, ROOM_CAP));
      }
    }, 250);
    return () => clearInterval(iv);
  }, [status, runMatch]);

  return { status, waiting, startsInMs, room, error, join, cancel };
}

function myPresence(p: Profile) {
  return { username: p.username, avatar: p.avatar, league_tier: p.league_tier, joined_at: Date.now() };
}
