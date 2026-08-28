import { useEffect, useState } from 'react';
import { sb } from './supabase';

// Site-wide "who's online right now" count, backed by Supabase Realtime Presence.
// Every signed-in tab that mounts this hook joins the same channel and tracks itself;
// presenceState() then gives every joined tab the full member list, so the count stays
// in sync across all connected clients without any extra table/writes.
const PRESENCE_CHANNEL = 'aitakip-online';

export function useOnlinePresence(userId: string | null): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) { setCount(0); return; }
    const channel = sb.channel(PRESENCE_CHANNEL, { config: { presence: { key: userId } } });
    channel
      .on('presence', { event: 'sync' }, () => {
        setCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({ online_at: new Date().toISOString() });
      });
    return () => { sb.removeChannel(channel); };
  }, [userId]);

  return count;
}
