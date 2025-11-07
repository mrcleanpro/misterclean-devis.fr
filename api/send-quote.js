// api/send-quote.js
// Fonction serveur Vercel : reçoit les données du formulaire et envoie un e-mail via Mailjet (API v3.1).

export default async function handler(req, res) {
  // --- CORS (qui a le droit d'appeler l'API) ---
  const allowOrigin = process.env.CORS_ALLOW_ORIGIN || '*'; // ex: 'https://misterclean.contactpro'
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // --- Méthode autorisée ---
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // --- Lecture du corps JSON ---
    const {
      // obligatoire
      client_email,

      // facultatifs
      subject,
      summary,        // version texte simple si tu ne fournis pas html
      html,           // version HTML (si fournie, elle sera utilisée)
      action_type = 'devis', // 'devis' | 'creneau'

      // données optionnelles de ton simulateur
      spaces = [],
      days_per_week,
      hours_per_day,
      postal_city,
      totals = {}
    } = req.body || {};

    // --- Validation e-mail client ---
    const emailOk = typeof client_email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email);
    if (!emailOk) {
      return res.status(400).json({ ok: false, error: 'Adresse e-mail client invalide.' });
    }

    // --- Variables d'environnement (Vercel -> Settings -> Environment Variables) ---
    const MJ_API_KEY      = process.env.MJ_API_KEY;      // Clé API publique (sous-compte Mailjet)
    const MJ_API_SECRET   = process.env.MJ_API_SECRET;   // Clé API secrète (sous-compte Mailjet)
    const MAIL_FROM_EMAIL = process.env.MAIL_FROM_EMAIL; // Expéditeur vérifié dans Mailjet (ex: no-reply@tondomaine)
    const MAIL_FROM_NAME  = process.env.MAIL_FROM_NAME || 'MrClean';
    const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL; // Tu recevras une copie ici
    const REPLY_TO        = process.env.REPLY_TO;        // Où le client peut répondre (optionnel)

    if (!MJ_API_KEY || !MJ_API_SECRET || !MAIL_FROM_EMAIL) {
      return res.status(500).json({
        ok: false,
        error: 'Configuration Mailjet manquante (MJ_API_KEY, MJ_API_SECRET, MAIL_FROM_EMAIL).'
      });
    }

    // --- Construction du contenu ---
    const estimate = safeText(totals?.estimate_eur_text);
    const week     = safeText(totals?.week_eur_text);
    const month    = safeText(totals?.month_eur_text);

    const finalSubject =
      subject ||
      (action_type === 'creneau' ? 'Confirmation de réservation — MrClean' : 'Confirmation de devis — MrClean');

    const textPart = (summary && String(summary).trim()) || [
      'Bonjour,',
      '',
      `Merci pour votre ${action_type === 'creneau' ? 'réservation de créneau' : 'demande de devis'}.`,
      'Voici votre récapitulatif :',
      '',
      `Espaces : ${arrOrDash(spaces)}`,
      `Jours/semaine : ${valOrDash(days_per_week)}`,
      `Heures/jour : ${valOrDash(hours_per_day)}`,
      `Ville/CP : ${valOrDash(postal_city)}`,
      '',
      `Montant estimé : ${valOrDash(estimate)}`,
      `Total TTC / semaine : ${valOrDash(week)}`,
      `Total TTC / mois : ${valOrDash(month)}`,
      '',
      '—',
      'Cet e-mail a été envoyé automatiquement par notre simulateur.'
    ].join('\n');

    const htmlPart = (typeof html === 'string' && html.trim())
      ? html
      : `<!doctype html>
<html lang="fr"><meta charset="utf-8">
<body style="margin:0;padding:0;background:#0b0c10;">
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.6;color:#0f172a;background:#ffffff;padding:24px;">
    <h2 style="margin:0 0 12px">${escapeHtml(finalSubject)}</h2>
    <p style="margin:0 0 8px">Bonjour,</p>
    <p style="margin:0 0 12px">
      Merci pour votre ${action_type === 'creneau' ? 'réservation de créneau' : 'demande de devis'}. Voici votre récapitulatif :
    </p>
    <ul style="margin:0 0 12px;padding-left:20px">
      <li><strong>Espaces :</strong> ${escapeHtml(arrOrDash(spaces))}</li>
      <li><strong>Jours / semaine :</strong> ${escapeHtml(valOrDash(days_per_week))}</li>
      <li><strong>Heures / jour :</strong> ${escapeHtml(valOrDash(hours_per_day))}</li>
      <li><strong>Ville / CP :</strong> ${escapeHtml(valOrDash(postal_city))}</li>
    </ul>
    <p style="margin:12px 0 4px"><strong>Montants estimés</strong></p>
    <ul style="margin:0 0 12px;padding-left:20px">
      <li>Montant estimé : <strong>${escapeHtml(valOrDash(estimate))}</strong></li>
      <li>Total TTC / semaine : <strong>${escapeHtml(valOrDash(week))}</strong></li>
      <li>Total TTC / mois : <strong>${escapeHtml(valOrDash(month))}</strong></li>
    </ul>
    <p style="color:#64748b;font-size:13px;margin:16px 0 0">Cet e-mail a été envoyé automatiquement par notre simulateur.</p>
  </div>
</body></html>`;

    // --- Préparation de l'appel Mailjet (v3.1) ---
    const authHeader = 'Basic ' + Buffer.from(`${MJ_API_KEY}:${MJ_API_SECRET}`).toString('base64');

    const toList = [{ Email: client_email }];
    const ccList = RECIPIENT_EMAIL ? [{ Email: RECIPIENT_EMAIL }] : [];

    const payload = {
      Messages: [
        {
          From: { Email: MAIL_FROM_EMAIL, Name: MAIL_FROM_NAME },
          To: toList,
          Cc: ccList,
          Subject: finalSubject,
          TextPart: textPart,
          HTMLPart: htmlPart,
          ...(REPLY_TO ? { ReplyTo: { Email: REPLY_TO } } : {})
        }
      ]
    };

    const mjResp = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const mjData = await mjResp.json().catch(() => null);
    const status  = mjData?.Messages?.[0]?.Status;
    const mjError = mjData?.Messages?.[0]?.Errors?.[0]?.ErrorMessage;

    if (!mjResp.ok || status !== 'success') {
      return res.status(502).json({ ok: false, error: mjError || 'Échec Mailjet', detail: mjData });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('send-quote error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Erreur serveur' });
  }
}

/* ------------------ Helpers ------------------ */
function safeText(v) {
  if (v == null) return '—';
  const s = String(v).trim();
  return s ? s : '—';
}
function valOrDash(v) {
  return v == null || String(v).trim() === '' ? '—' : String(v).trim();
}
function arrOrDash(arr) {
  try {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return '—';
    return arr.map(x => String(x).trim()).filter(Boolean).join(', ');
  } catch { return '—'; }
}
function escapeHtml(s) {
  return String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
