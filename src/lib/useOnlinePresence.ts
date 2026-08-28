import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { sb } from './supabase';

// Site-wide "who's online right now" count, backed by Supabase Realtime Presence.
//
// supabase-js returns the SAME channel instance for a repeated topic, and calling
// `.on()` on an already-subscribed channel throws. Since this hook is mounted in
// more than one place at once (Nav + the home page), we can't let each consumer
// build its own channel. Instead there is ONE module-level channel with ONE
// subscribe; every hook instance just registers a listener for the count.
const PRESENCE_CHANNEL = 'aitakip-online';

let channel: RealtimeChannel | null = null;
let activeUserId: string | null = null;
let currentCount = 0;
const listeners = new Set<(n: number) => void>();

function emit() {
  for (const l of listeners) l(currentCount);
}

function start(userId: string) {
  if (channel && activeUserId === userId) return;
  stop();
  activeUserId = userId;
  const ch = sb.channel(PRESENCE_CHANNEL, { config: { presence: { key: userId } } });
  channel = ch;
  ch.on('presence', { event: 'sync' }, () => {
    currentCount = Object.keys(ch.presenceState()).length;
    emit();
  }).subscribe((status) => {
    if (status === 'SUBSCRIBED') ch.track({ online_at: new Date().toISOString() });
  });
}

function stop() {
  if (channel) {
    sb.removeChannel(channel);
    channel = null;
  }
  activeUserId = null;
  currentCount = 0;
}

export function useOnlinePresence(userId: string | null): number {
  const [count, setCount] = useState(currentCount);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    const listener = (n: number) => setCount(n);
    listeners.add(listener);
    start(userId);
    setCount(currentCount);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) stop();
    };
  }, [userId]);

  return userId ? count : 0;
}
