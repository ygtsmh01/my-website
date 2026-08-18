export default function Guide() {
  return (
    <div className="root toppad" id="root">
      <div className="eyebrow" style={{ textAlign: 'center' }}>AI Takip Defteri</div>
      <h1 style={{ textAlign: 'center' }}>📖 Kılavuz</h1>

      <div className="panel">
        <div className="emoji">🎮</div>
        <h2>Oyun (Ana Sayfa)</h2>
        <p className="panel-sub">Her hafta admin yeni kaynaklar yayınlar. Kaynakları okuyup işaretle, sonra soru soru ilerleyen sınavı çöz. Doğru cevap yeşil, yanlış kırmızı yanar.</p>
        <ul>
          <li><strong>🔢 Sayı Tahmini</strong> — kaynaktaki bir sayıyı tahmin et, tolerans içindeyse doğru sayılır.</li>
          <li><strong>🔗 Eşleştirme</strong> — önce kaynağa, sonra doğru detaya tıkla. Anında yeşil/kırmızı yanar ve XP hemen işlenir.</li>
          <li><strong>👑 Boss Haftası</strong> — her 5 haftada bir, daha zor ve daha ödüllü.</li>
          <li><strong>🎲 Çift Yap ya da Kaybet</strong> — XP'nin yarısını bahse yatır, bir soruya bağlı.</li>
          <li><strong>⏱ Hız Turu</strong> — süre dolmadan tüm soruları bitirirsen bonus XP.</li>
          <li><strong>❄ Dondurma</strong> — meşgul bir hafta, seriyi bozmadan atlamanı sağlar (her 3 haftalık seride 1 hak).</li>
        </ul>
      </div>

      <div className="panel">
        <div className="emoji">🏅</div>
        <h2>Lig Sistemi</h2>
        <p className="panel-sub">6 lig var: Bronz → Gümüş → Altın → Elmas → Usta → Şampiyonlar Ligi. Her ligin sabit bir müfredatı (özet + quiz) var, bir kere tamamlanır. Haftalık quiz de lig puanı verir — üst liglerde çarpanı daha yüksek. Yeterli lig puanına ulaşınca otomatik terfi edersin.</p>
        <p className="panel-sub">Ana sayfadaki "Tüm Lig Müfredatları" bölümünden her ligin kaynak başlıklarını görebilirsin, ama sadece kendi liginin müfredatını açıp tamamlayabilirsin.</p>
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
        <p className="panel-sub" style={{ margin: 0 }}>☰ simgesine her zaman tıklayıp bu sayfalar arasında geçiş yapabilirsin. Kafan karıştığında yine buraya dönebilirsin.</p>
      </div>
    </div>
  );
}
