import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { League, Profile } from '../lib/types';

export default function Guide() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [expandedTier, setExpandedTier] = useState<number | null>(null);

  const [feedbackCategory, setFeedbackCategory] = useState<'general' | 'content_suggestion'>('general');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    sb.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data));
    sb.from('leagues').select('*').order('tier_index', { ascending: true })
      .then(({ data }) => setLeagues(data || []));
  }, [session]);

  async function submitFeedback() {
    if (!profile || !feedbackMessage.trim()) return;
    setFeedbackBusy(true);
    setFeedbackError('');
    const { error } = await sb.from('feedback').insert({
      user_id: profile.id,
      category: feedbackCategory,
      message: feedbackMessage.trim(),
    });
    if (error) {
      setFeedbackError('Gönderilemedi: ' + error.message);
    } else {
      setFeedbackMessage('');
      setFeedbackSent(true);
      setTimeout(() => setFeedbackSent(false), 4000);
    }
    setFeedbackBusy(false);
  }

  return (
    <div className="root toppad" id="root">
      <div className="eyebrow" style={{ textAlign: 'center' }}>AI Takip Defteri</div>
      <h1 style={{ textAlign: 'center' }}>📖 Kılavuz</h1>

      <div className="panel">
        <div className="emoji">🎮</div>
        <h2>Oyun (Ana Sayfa)</h2>
        <p className="panel-sub">Her hafta admin yeni kaynaklar yayınlar. Kaynakları okuyup işaretle, sonra soru soru ilerleyen sınavı çöz. Doğru cevap yeşil, yanlış kırmızı yanar. "Bu Hafta" sekmesinde o haftanın quiz'i ve ek soruları, kendi liginin adını taşıyan sekmede ise ligine ait sabit rehber var.</p>
        <ul>
          <li><strong>🔢 Sayı Tahmini</strong> — kaynaktaki bir sayıyı tahmin et, tolerans içindeyse doğru sayılır.</li>
          <li><strong>👑 Boss Haftası</strong> — her 5 haftada bir, daha zor ve daha ödüllü.</li>
          <li><strong>🎲 Çift Yap ya da Kaybet</strong> — XP'nin yarısını bahse yatır, bir soruya bağlı.</li>
          <li><strong>⏱ Hız Turu</strong> — süre dolmadan tüm soruları bitirirsen bonus XP.</li>
          <li><strong>❄ Dondurma</strong> — meşgul bir hafta, seriyi bozmadan atlamanı sağlar (her 3 haftalık seride 1 hak).</li>
        </ul>
      </div>

      <div className="panel">
        <div className="emoji">🏅</div>
        <h2>Lig Sistemi</h2>
        <p className="panel-sub">Her ligin sabit bir rehberi (özet + quiz) var, bir kere tamamlanır. Haftalık quiz de lig puanı verir — üst liglerde çarpanı daha yüksek. Yeterli lig puanına ulaşınca otomatik terfi edersin. Aşağıda tüm liglerin rehberlerini görebilirsin, ama sadece kendi liginin rehberini oyun sayfasında açıp tamamlayabilirsin.</p>
      </div>

      <div className="panel">
        <div className="emoji">📚</div>
        <h2>Tüm Lig Rehberleri</h2>
        <p className="panel-sub">Her ligin kaynak başlıklarını ve özetlerini burada inceleyebilirsin. Quiz çözmek için kendi liginin rehberine oyun sayfasından girmen gerekir.</p>
        {leagues.length === 0 && <p className="empty-hint">Yükleniyor…</p>}
        {leagues.map((l) => {
          const isMine = !!profile && l.tier_index === profile.league_tier;
          const reads = l.content && l.content.must_reads ? l.content.must_reads : [];
          const isOpen = expandedTier === l.tier_index;
          return (
            <div key={l.tier_index} style={{ marginBottom: 12 }}>
              <button className="btn ghost" style={{ width: '100%', textAlign: 'left' }}
                onClick={() => setExpandedTier(isOpen ? null : l.tier_index)}>
                {isOpen ? '▾' : '▸'} {isMine ? '▶ ' : ''}{l.name}{isMine ? ' (senin ligin)' : ''}
              </button>
              {l.tagline && <div className="one-liner" style={{ marginTop: 4 }}>{l.tagline}</div>}
              {isOpen && (
                <div style={{ marginTop: 8 }}>
                  {reads.length === 0 ? (
                    <p className="empty-hint">Henüz içerik yok.</p>
                  ) : (
                    reads.map((mr, i) => (
                      <div className="read-row" key={i}>
                        <div>
                          {mr.url ? <a href={mr.url} target="_blank" rel="noopener noreferrer">{mr.title}</a> : <strong>{mr.title}</strong>}
                          <div className="one-liner">{mr.summary}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div className="emoji">⚡</div>
        <h2>Canlı Yarışma</h2>
        <p className="panel-sub">Hamburger menüden "Canlı Yarışma"ya girip <strong>Oda Aç</strong> (herkese açık) ya da <strong>Düello Başlat</strong> (1'e 1, bahisli olabilir) diyerek bir kod oluşturursun. Arkadaşların o kodla katılır. Herkes cevaplayınca otomatik sıradaki soruya geçilir, ilk doğru cevaba ekstra puan var. Kazanan lig puanı da kazanır — odadaki en düşük ligli kişinin liginin çarpanına göre hesaplanır.</p>
      </div>

      <div className="panel">
        <div className="emoji">👤</div>
        <h2>Profil</h2>
        <p className="panel-sub">Avatarını ve kullanıcı adını buradan değiştirebilirsin. Toplam XP, seri, dondurma hakkı ve rozet duvarın da burada.</p>
      </div>

      <div className="panel">
        <div className="emoji">🏆</div>
        <h2>Sıralama ve Geçmiş</h2>
        <p className="panel-sub">Sıralama sayfası herkesin XP'sine göre canlı tabloyu gösterir. Geçmiş sayfasında ise tamamladığın haftaların tarih aralığını ve o haftanın kaynaklarını tekrar görebilirsin.</p>
      </div>

      <div className="panel">
        <div className="emoji">✍️</div>
        <h2>Geri Bildirim</h2>
        {!profile ? (
          <p className="panel-sub">Geri bildirim gönderebilmek için önce giriş yapman gerekiyor.</p>
        ) : (
          <>
            <p className="panel-sub">Bir şey mi aksadı, ya da eklenmesini istediğin bir kaynak mı var? Aşağıdan iletebilirsin.</p>
            <div className="tabs">
              <button className={feedbackCategory === 'general' ? 'btn secondary' : 'btn ghost'} onClick={() => setFeedbackCategory('general')}>Genel Geri Bildirim</button>
              <button className={feedbackCategory === 'content_suggestion' ? 'btn secondary' : 'btn ghost'} onClick={() => setFeedbackCategory('content_suggestion')}>Kaynak veya Rehber Önerisi</button>
            </div>
            <textarea rows={4} value={feedbackMessage} onChange={(e) => setFeedbackMessage(e.target.value)}
              placeholder={feedbackCategory === 'general' ? 'Aklındakini yaz…' : 'Hangi kaynağı veya rehberi eklememizi istersin?'}
              style={{ width: '100%', resize: 'vertical', fontFamily: 'var(--sans)' }} />
            <button className="btn secondary" onClick={submitFeedback} disabled={feedbackBusy || !feedbackMessage.trim()}>
              {feedbackBusy ? 'Gönderiliyor…' : 'Gönder'}
            </button>
            {feedbackError && <div className="error-box">{feedbackError}</div>}
            {feedbackSent && <div className="ok-box">Teşekkürler, geri bildirimin bize ulaştı!</div>}
          </>
        )}
      </div>

      <div className="panel">
        <p className="panel-sub" style={{ margin: 0 }}>☰ simgesine her zaman tıklayıp bu sayfalar arasında geçiş yapabilirsin. Kafan karıştığında yine buraya dönebilirsin.</p>
      </div>
    </div>
  );
}
